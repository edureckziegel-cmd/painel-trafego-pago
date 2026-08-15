// Worker único do Painel de Tráfego Pago.
//
// A Cloudflare te colocou no modelo "Worker com arquivos estáticos" (o modelo
// mais novo deles), em vez do modelo "Pages". A diferença prática é que,
// nesse modelo, todo o backend precisa estar em UM arquivo só (este aqui),
// que decide o que fazer com base na URL pedida. Se a URL não for uma das
// rotas de API abaixo, ele devolve o site estático normalmente (o painel).

const META_API_VERSION = "v21.0";
const GOOGLE_ADS_API_VERSION = "v17";

/* ---------- Segurança ---------- */

// Impede que o clientId vindo da URL seja usado para "poluir" ou manipular
// chaves do banco de dados. Só letras, números, hífen e underscore, até 60
// caracteres — qualquer coisa fora disso é cortada/normalizada.
function sanitizeClientId(raw) {
  const cleaned = String(raw || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 60);
  return cleaned || "default";
}

// Comparação de senha em tempo constante, pra dificultar ataques de
// "timing" (adivinhar a senha caractere por caractere medindo a demora
// da resposta). Sempre compara todos os caracteres, não para no primeiro
// que for diferente.
function safeEqual(a, b) {
  const strA = String(a);
  const strB = String(b);
  if (strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

// Confere o login/senha (HTTP Basic Auth) em TODAS as requisições, antes
// de qualquer outra coisa rodar. Sem usuário/senha certos, nada no site
// funciona — nem a página, nem a API.
function checkAuth(request, env) {
  if (!env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) {
    // Se as credenciais não foram configuradas ainda, bloqueia por padrão
    // (mais seguro do que deixar aberto por engano).
    return false;
  }
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;

  let decoded;
  try {
    decoded = atob(header.slice(6));
  } catch (e) {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  return safeEqual(user, env.DASHBOARD_USER) && safeEqual(pass, env.DASHBOARD_PASSWORD);
}

function respostaNaoAutorizada() {
  return new Response("Autenticação necessária.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Painel de Tráfego Pago", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

// Cabeçalhos de segurança aplicados em toda resposta: impedem que o site
// seja carregado dentro de um iframe de outro site (clickjacking), e
// impedem que o navegador tente "adivinhar" tipos de arquivo incorretos.
function comHeadersSeguranca(response) {
  const nova = new Response(response.body, response);
  nova.headers.set("X-Frame-Options", "DENY");
  nova.headers.set("X-Content-Type-Options", "nosniff");
  nova.headers.set("Referrer-Policy", "same-origin");
  nova.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
  return nova;
}

/* ---------- Armazenamento (Workers KV) ---------- */
async function getClient(env, clientId) {
  const raw = await env.CLIENTS_KV.get(`client:${sanitizeClientId(clientId)}`);
  return raw ? JSON.parse(raw) : {};
}
async function saveClient(env, clientId, patch) {
  const id = sanitizeClientId(clientId);
  const current = await getClient(env, id);
  const updated = { ...current, ...patch };
  await env.CLIENTS_KV.put(`client:${id}`, JSON.stringify(updated));
  return updated;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function paginaSucesso(nome) {
  return `<html><body style="font-family:sans-serif;text-align:center;padding-top:80px;">
    <h2>✅ ${nome} conectado com sucesso!</h2>
    <p>Você já pode fechar esta aba e voltar para o painel.</p>
  </body></html>`;
}

/* ---------- Google Ads ---------- */
async function authGoogleStart(url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const redirectUri = `${env.APP_BASE_URL}/api/auth/google/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
  authUrl.searchParams.set("state", clientId);

  return Response.redirect(authUrl.toString(), 302);
}

async function authGoogleCallback(url, env) {
  const code = url.searchParams.get("code");
  const clientId = url.searchParams.get("state") || "default";
  const redirectUri = `${env.APP_BASE_URL}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return new Response("Erro ao conectar Google Ads: " + (tokenData.error_description || tokenData.error), { status: 500 });
  }

  await saveClient(env, clientId, {
    google: { refresh_token: tokenData.refresh_token, connected_at: Date.now() },
  });

  return new Response(paginaSucesso("Google Ads"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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

/* ---------- Meta Ads ---------- */
async function authMetaStart(url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const redirectUri = `${env.APP_BASE_URL}/api/auth/meta/callback`;
  const scope = ["ads_read", "read_insights", "instagram_basic", "pages_read_engagement"].join(",");

  const authUrl = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", env.META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", clientId);
  authUrl.searchParams.set("scope", scope);

  return Response.redirect(authUrl.toString(), 302);
}

async function authMetaCallback(url, env) {
  const code = url.searchParams.get("code");
  const clientId = url.searchParams.get("state") || "default";
  const redirectUri = `${env.APP_BASE_URL}/api/auth/meta/callback`;

  const tokenUrl = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", env.META_APP_ID);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET);
  tokenUrl.searchParams.set("code", code);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return new Response("Erro ao conectar Meta Ads: " + tokenData.error.message, { status: 500 });
  }

  const longUrl = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", env.META_APP_ID);
  longUrl.searchParams.set("client_secret", env.META_APP_SECRET);
  longUrl.searchParams.set("fb_exchange_token", tokenData.access_token);
  const longRes = await fetch(longUrl.toString());
  const longData = await longRes.json();

  await saveClient(env, clientId, {
    meta: { access_token: longData.access_token || tokenData.access_token, connected_at: Date.now() },
  });

  return new Response(paginaSucesso("Meta Ads"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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

  // Tipos de ação que contam como "resultado/conversão". Cobre os objetivos
  // mais comuns: vendas, cadastros e também conversas iniciadas (campanhas
  // de mensagem, muito comuns no Meta Ads de pequenos negócios).
  const TIPOS_CONVERSAO = [
    "lead", "purchase", "offsite_conversion", "onsite_conversion",
    "complete_registration", "messaging_conversation_started",
    "messaging_first_reply",
  ];
  function ehConversao(actionType) {
    return TIPOS_CONVERSAO.some((tipo) => actionType.includes(tipo));
  }

  const byDay = {};
  (data.data || []).forEach((r) => {
    const day = r.date_start;
    byDay[day] = byDay[day] || {
      invest: 0, impressions: 0, clicks: 0, conversions: 0,
      fbClicks: 0, igClicks: 0, profileVisits: 0, newFollowers: 0,
    };

    // Cliques no link — é essa a métrica que aparece no Gerenciador de
    // Anúncios como "Cliques no link" (mais relevante do que o campo bruto
    // "clicks", que também conta curtidas, comentários e outras interações).
    const acoes = r.actions || [];
    const linkClicks = acoes
      .filter((a) => a.action_type === "link_click")
      .reduce((soma, a) => soma + Number(a.value || 0), 0);

    byDay[day].invest += Number(r.spend || 0);
    byDay[day].impressions += Number(r.impressions || 0);
    byDay[day].clicks += linkClicks;
    if (r.publisher_platform === "facebook") byDay[day].fbClicks += linkClicks;
    if (r.publisher_platform === "instagram") byDay[day].igClicks += linkClicks;

    const conversoes = acoes.filter((a) => ehConversao(a.action_type));
    byDay[day].conversions += conversoes.reduce((soma, a) => soma + Number(a.value || 0), 0);
  });

  // Visitas ao perfil e novos seguidores — exige a conta comercial do
  // Instagram vinculada (o campo "Meta Ads — Instagram User ID" na
  // configuração do cliente). Sem esse ID, ficam zerados.
  if (igUserId) {
    try {
      const igUrl =
        `https://graph.facebook.com/${META_API_VERSION}/${igUserId}/insights` +
        `?metric=profile_views,follower_count&period=day&since=${start}&until=${end}&access_token=${accessToken}`;
      const igRes = await fetch(igUrl);
      const igData = await igRes.json();

      const metricaVisitas = (igData.data || []).find((m) => m.name === "profile_views");
      (metricaVisitas && metricaVisitas.values ? metricaVisitas.values : []).forEach((v) => {
        const day = v.end_time ? v.end_time.slice(0, 10) : null;
        if (day && byDay[day]) byDay[day].profileVisits = v.value;
      });

      const metricaSeguidores = (igData.data || []).find((m) => m.name === "follower_count");
      (metricaSeguidores && metricaSeguidores.values ? metricaSeguidores.values : []).forEach((v) => {
        const day = v.end_time ? v.end_time.slice(0, 10) : null;
        if (day && byDay[day]) byDay[day].newFollowers = v.value;
      });
    } catch (e) {
      // opcional — segue sem travar o resto se essa parte falhar
    }
  }

  return byDay;
}

/* ---------- Rotas auxiliares ---------- */
async function apiStatus(url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const data = await getClient(env, clientId);
  return json({
    google: !!(data.google && data.google.refresh_token),
    meta: !!(data.meta && data.meta.access_token),
    googleCustomerId: data.googleCustomerId || null,
    metaAdAccountId: data.metaAdAccountId || null,
    metaIgUserId: data.metaIgUserId || null,
  });
}

async function apiClientConfig(request, url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const body = await request.json();
  await saveClient(env, clientId, {
    googleCustomerId: body.googleCustomerId,
    metaAdAccountId: body.metaAdAccountId,
    metaIgUserId: body.metaIgUserId,
  });
  return json({ ok: true });
}

async function apiMetrics(url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const data = await getClient(env, clientId);
  if (!data || Object.keys(data).length === 0) {
    return json({ error: "Cliente não encontrado. Conecte as contas primeiro." }, 404);
  }

  const [googleByDay, metaByDay] = await Promise.all([
    data.google && data.google.refresh_token
      ? fetchGoogleAdsData(env, data.google.refresh_token, data.googleCustomerId, start, end)
      : null,
    data.meta && data.meta.access_token
      ? fetchMetaAdsData(data.meta.access_token, data.metaAdAccountId, data.metaIgUserId, start, end)
      : null,
  ]);

  return json({ google: googleByDay, meta: metaByDay });
}

/* ---------- Roteador principal ---------- */
export default {
  async fetch(request, env, ctx) {
    // Primeiro de tudo: exige login e senha. Sem isso, nada mais roda —
    // nem a página, nem nenhuma rota de API.
    if (!checkAuth(request, env)) {
      return respostaNaoAutorizada();
    }

    const url = new URL(request.url);
    const { pathname } = url;

    let resposta;
    try {
      if (pathname === "/api/auth/google/start") resposta = await authGoogleStart(url, env);
      else if (pathname === "/api/auth/google/callback") resposta = await authGoogleCallback(url, env);
      else if (pathname === "/api/auth/meta/start") resposta = await authMetaStart(url, env);
      else if (pathname === "/api/auth/meta/callback") resposta = await authMetaCallback(url, env);
      else if (pathname === "/api/status" && request.method === "GET") resposta = await apiStatus(url, env);
      else if (pathname === "/api/client-config" && request.method === "POST") resposta = await apiClientConfig(request, url, env);
      else if (pathname === "/api/metrics" && request.method === "GET") resposta = await apiMetrics(url, env);
      else resposta = await env.ASSETS.fetch(request);
    } catch (err) {
      resposta = json({ error: err.message }, 500);
    }

    return comHeadersSeguranca(resposta);
  },
};
