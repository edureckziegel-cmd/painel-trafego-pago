/**
 * BACKEND — Painel de Tráfego Pago
 * ---------------------------------
 * Este arquivo roda no Firebase Cloud Functions (Node.js).
 * Ele é responsável por:
 *   1) Autenticar (OAuth) com o Google Ads e o Meta Ads (Facebook/Instagram)
 *   2) Guardar os tokens de acesso com segurança no Firestore
 *   3) Buscar os dados reais das campanhas quando o dashboard pedir
 *
 * Nenhuma senha ou token fica exposto no navegador — tudo passa por aqui.
 *
 * Configuração necessária (ver README.md para o passo a passo completo):
 *   firebase functions:config:set ^
 *     google.client_id="SEU_CLIENT_ID" ^
 *     google.client_secret="SEU_CLIENT_SECRET" ^
 *     google.developer_token="SEU_DEVELOPER_TOKEN" ^
 *     meta.app_id="SEU_APP_ID" ^
 *     meta.app_secret="SEU_APP_SECRET" ^
 *     app.base_url="https://SEU-PROJETO.web.app"
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));

const cfg = functions.config();

const GOOGLE_CLIENT_ID = cfg.google && cfg.google.client_id;
const GOOGLE_CLIENT_SECRET = cfg.google && cfg.google.client_secret;
const GOOGLE_DEVELOPER_TOKEN = cfg.google && cfg.google.developer_token;
const META_APP_ID = cfg.meta && cfg.meta.app_id;
const META_APP_SECRET = cfg.meta && cfg.meta.app_secret;
const BASE_URL = (cfg.app && cfg.app.base_url) || "http://localhost:5000";

const GOOGLE_REDIRECT_URI = `${BASE_URL}/auth/google/callback`;
const META_REDIRECT_URI = `${BASE_URL}/auth/meta/callback`;
const META_API_VERSION = "v21.0";
const GOOGLE_ADS_API_VERSION = "v17";

/* ======================================================================
   GOOGLE ADS — OAuth
   ====================================================================== */
function getGoogleOAuthClient() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// Abre a tela de login do Google. Ex: /auth/google/start?clientId=loja-horizonte
app.get("/auth/google/start", (req, res) => {
  const clientId = req.query.clientId || "default";
  const oauth2Client = getGoogleOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/adwords"],
    state: clientId,
  });
  res.redirect(url);
});

// O Google chama esta URL de volta depois do login
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    await db.collection("clients").doc(state || "default").set(
      {
        google: {
          refresh_token: tokens.refresh_token,
          connected_at: Date.now(),
        },
      },
      { merge: true }
    );

    res.send(paginaDeSucesso("Google Ads"));
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao conectar Google Ads: " + err.message);
  }
});

async function getGoogleAccessToken(refreshToken) {
  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2Client.getAccessToken();
  return token;
}

/* ======================================================================
   META ADS (Facebook/Instagram) — OAuth
   ====================================================================== */

// Abre a tela de login do Facebook. Ex: /auth/meta/start?clientId=loja-horizonte
app.get("/auth/meta/start", (req, res) => {
  const clientId = req.query.clientId || "default";
  const scope = ["ads_read", "read_insights", "instagram_basic", "pages_read_engagement"].join(",");
  const url =
    `https://www.facebook.com/${META_API_VERSION}/dialog/oauth` +
    `?client_id=${META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
    `&state=${clientId}` +
    `&scope=${scope}`;
  res.redirect(url);
});

// O Facebook chama esta URL de volta depois do login
app.get("/auth/meta/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    const tokenUrl =
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token` +
      `?client_id=${META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
      `&client_secret=${META_APP_SECRET}` +
      `&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Troca por um token de longa duração (dura ~60 dias em vez de algumas horas)
    const longLivedUrl =
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${META_APP_ID}` +
      `&client_secret=${META_APP_SECRET}` +
      `&fb_exchange_token=${tokenData.access_token}`;
    const longLivedRes = await fetch(longLivedUrl);
    const longLivedData = await longLivedRes.json();

    await db.collection("clients").doc(state || "default").set(
      {
        meta: {
          access_token: longLivedData.access_token || tokenData.access_token,
          connected_at: Date.now(),
        },
      },
      { merge: true }
    );

    res.send(paginaDeSucesso("Meta Ads"));
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao conectar Meta Ads: " + err.message);
  }
});

function paginaDeSucesso(plataforma) {
  return `
    <html><body style="font-family:sans-serif;text-align:center;padding-top:80px;">
      <h2>✅ ${plataforma} conectado com sucesso!</h2>
      <p>Você já pode fechar esta aba e voltar para o painel.</p>
    </body></html>`;
}

/* ======================================================================
   CONFIGURAÇÃO DO CLIENTE (IDs das contas de anúncio)
   ====================================================================== */

// Salva os IDs das contas de anúncio de um cliente específico
// Body: { googleCustomerId, metaAdAccountId, metaIgUserId }
app.post("/api/client-config", express.json(), async (req, res) => {
  try {
    const clientId = req.query.clientId || "default";
    const { googleCustomerId, metaAdAccountId, metaIgUserId } = req.body;
    await db.collection("clients").doc(clientId).set(
      { googleCustomerId, metaAdAccountId, metaIgUserId },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Devolve o status de conexão (usado pelo dashboard para mostrar os botões)
app.get("/api/status", async (req, res) => {
  const clientId = req.query.clientId || "default";
  const doc = await db.collection("clients").doc(clientId).get();
  const data = doc.exists ? doc.data() : {};
  res.json({
    google: !!(data.google && data.google.refresh_token),
    meta: !!(data.meta && data.meta.access_token),
    googleCustomerId: data.googleCustomerId || null,
    metaAdAccountId: data.metaAdAccountId || null,
    metaIgUserId: data.metaIgUserId || null,
  });
});

/* ======================================================================
   MÉTRICAS REAIS — o dashboard chama este endpoint
   ====================================================================== */
app.get("/api/metrics", async (req, res) => {
  try {
    const clientId = req.query.clientId || "default";
    const start = req.query.start; // formato YYYY-MM-DD
    const end = req.query.end;

    const doc = await db.collection("clients").doc(clientId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Cliente não encontrado. Conecte as contas primeiro." });
    }
    const data = doc.data();

    const [googleByDay, metaByDay] = await Promise.all([
      data.google && data.google.refresh_token
        ? fetchGoogleAdsData(data.google.refresh_token, data.googleCustomerId, start, end)
        : null,
      data.meta && data.meta.access_token
        ? fetchMetaAdsData(data.meta.access_token, data.metaAdAccountId, data.metaIgUserId, start, end)
        : null,
    ]);

    res.json({ google: googleByDay, meta: metaByDay });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function fetchGoogleAdsData(refreshToken, customerId, start, end) {
  if (!customerId) throw new Error("Falta configurar o Customer ID do Google Ads deste cliente.");
  const accessToken = await getGoogleAccessToken(refreshToken);

  const query = `
    SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": GOOGLE_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(JSON.stringify(json.error));

  const byDay = {};
  const results = (json[0] && json[0].results) || [];
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
    `?time_range=${timeRange}` +
    `&time_increment=1` +
    `&level=account` +
    `&fields=spend,impressions,clicks,actions` +
    `&breakdowns=publisher_platform` +
    `&access_token=${accessToken}`;

  const resp = await fetch(insightsUrl);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message);

  const byDay = {};
  (json.data || []).forEach((r) => {
    const day = r.date_start;
    byDay[day] = byDay[day] || {
      invest: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      fbClicks: 0,
      igClicks: 0,
      profileVisits: 0,
      newFollowers: 0,
    };
    byDay[day].invest += Number(r.spend || 0);
    byDay[day].impressions += Number(r.impressions || 0);
    byDay[day].clicks += Number(r.clicks || 0);
    if (r.publisher_platform === "facebook") byDay[day].fbClicks += Number(r.clicks || 0);
    if (r.publisher_platform === "instagram") byDay[day].igClicks += Number(r.clicks || 0);

    const actions = r.actions || [];
    const conversoes = actions.filter(
      (a) => a.action_type.includes("lead") || a.action_type.includes("purchase") || a.action_type.includes("offsite_conversion")
    );
    byDay[day].conversions += conversoes.reduce((soma, a) => soma + Number(a.value || 0), 0);
  });

  // Visitas ao perfil e novos seguidores exigem a conta comercial do Instagram vinculada
  if (igUserId) {
    try {
      const igUrl =
        `https://graph.facebook.com/${META_API_VERSION}/${igUserId}/insights` +
        `?metric=profile_views&period=day&since=${start}&until=${end}&access_token=${accessToken}`;
      const igResp = await fetch(igUrl);
      const igJson = await igResp.json();
      const metric = (igJson.data || []).find((m) => m.name === "profile_views");
      (metric && metric.values ? metric.values : []).forEach((v) => {
        const day = v.end_time ? v.end_time.slice(0, 10) : null;
        if (day && byDay[day]) byDay[day].profileVisits = v.value;
      });
    } catch (e) {
      console.warn("Não foi possível buscar profile_views:", e.message);
    }
  }

  return byDay;
}

exports.api = functions.region("us-central1").https.onRequest(app);
