// Rota: GET /api/metrics?clientId=default&start=2026-08-01&end=2026-08-31
// É esta função que o painel chama para buscar os números reais das campanhas.

import { getClient, json, META_API_VERSION, GOOGLE_ADS_API_VERSION } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "default";
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const data = await getClient(env, clientId);
  if (!data || Object.keys(data).length === 0) {
    return json({ error: "Cliente não encontrado. Conecte as contas primeiro." }, 404);
  }

  try {
    const [googleByDay, metaByDay] = await Promise.all([
      data.google && data.google.refresh_token
        ? fetchGoogleAdsData(env, data.google.refresh_token, data.googleCustomerId, start, end)
        : null,
      data.meta && data.meta.access_token
        ? fetchMetaAdsData(data.meta.access_token, data.metaAdAccountId, data.metaIgUserId, start, end)
        : null,
    ]);
    return json({ google: googleByDay, meta: metaByDay });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function getGoogleAccessToken(env, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await res.json();
  if (tokenData.error) throw new Error("Falha ao renovar token do Google: " + tokenData.error_description);
  return tokenData.access_token;
}

async function fetchGoogleAdsData(env, refreshToken, customerId, start, end) {
  if (!customerId) throw new Error("Falta configurar o Customer ID do Google Ads deste cliente.");
  const accessToken = await getGoogleAccessToken(env, refreshToken);

  const query = `
    SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": env.GOOGLE_DEVELOPER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));

  const byDay = {};
  const results = (data[0] && data[0].results) || [];
  results.forEach((r) => {
    const day = r.segments.date;
    byDay[day] = byDay[day] || { invest: 0, impressions: 0, clicks: 0, conversions: 0 };
    byDay[day].invest += Number(r.metrics.costMicros || 0) / 1e6;
    byDay[day].impressions += Number(r.metrics.impressions || 0);
    byDay[day].clicks += Number(r.metrics.clicks || 0);
    byDay[day].conversions += Number(r.metrics.conversions || 0);
  });
  return byDay;
}

async function fetchMetaAdsData(accessToken, adAccountId, igUserId, start, end) {
  if (!adAccountId) throw new Error("Falta configurar o Ad Account ID do Meta Ads deste cliente.");

  const timeRange = encodeURIComponent(JSON.stringify({ since: start, until: end }));
  const insightsUrl =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?time_range=${timeRange}&time_increment=1&level=account` +
    `&fields=spend,impressions,clicks,actions&breakdowns=publisher_platform` +
    `&access_token=${accessToken}`;

  const res = await fetch(insightsUrl);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const byDay = {};
  (data.data || []).forEach((r) => {
    const day = r.date_start;
    byDay[day] = byDay[day] || {
      invest: 0, impressions: 0, clicks: 0, conversions: 0,
      fbClicks: 0, igClicks: 0, profileVisits: 0, newFollowers: 0,
    };
    byDay[day].invest += Number(r.spend || 0);
    byDay[day].impressions += Number(r.impressions || 0);
    byDay[day].clicks += Number(r.clicks || 0);
    if (r.publisher_platform === "facebook") byDay[day].fbClicks += Number(r.clicks || 0);
    if (r.publisher_platform === "instagram") byDay[day].igClicks += Number(r.clicks || 0);

    const conversoes = (r.actions || []).filter(
      (a) => a.action_type.includes("lead") || a.action_type.includes("purchase") || a.action_type.includes("offsite_conversion")
    );
    byDay[day].conversions += conversoes.reduce((soma, a) => soma + Number(a.value || 0), 0);
  });

  if (igUserId) {
    try {
      const igUrl = `https://graph.facebook.com/${META_API_VERSION}/${igUserId}/insights?metric=profile_views&period=day&since=${start}&until=${end}&access_token=${accessToken}`;
      const igRes = await fetch(igUrl);
      const igData = await igRes.json();
      const metric = (igData.data || []).find((m) => m.name === "profile_views");
      (metric && metric.values ? metric.values : []).forEach((v) => {
        const day = v.end_time ? v.end_time.slice(0, 10) : null;
        if (day && byDay[day]) byDay[day].profileVisits = v.value;
      });
    } catch (e) {
      // Se não conseguir buscar visitas ao perfil, segue sem travar o resto
    }
  }

  return byDay;
}
