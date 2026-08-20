// Worker único do Painel de Tráfego Pago.
//
// A Cloudflare te colocou no modelo "Worker com arquivos estáticos" (o modelo
// mais novo deles), em vez do modelo "Pages". A diferença prática é que,
// nesse modelo, todo o backend precisa estar em UM arquivo só (este aqui),
// que decide o que fazer com base na URL pedida. Se a URL não for uma das
// rotas de API abaixo, ele devolve o site estático normalmente (o painel).

const META_API_VERSION = "v21.0";
const GOOGLE_ADS_API_VERSION = "v17";

// Tipos de ação do Meta que podem representar o "resultado" de uma campanha.
// Em ORDEM DE PRIORIDADE: pegamos o PRIMEIRO que existir nas ações da
// campanha/período, em vez de somar todos — porque várias dessas entradas
// podem coexistir para a MESMA conversão (ex: "conversa iniciada" e
// "primeira resposta" às vezes aparecem juntas), e somar todas infla o
// número de resultados muito além do que o Gerenciador de Anúncios mostra.
const PRIORIDADE_RESULTADO = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
  "onsite_conversion.lead_grouped",
  "complete_registration",
  "onsite_conversion.total_messaging_connection",
  "link_click",
];

function calcularResultado(actions) {
  const lista = actions || [];
  for (const tipo of PRIORIDADE_RESULTADO) {
    const acao = lista.find((a) => a.action_type === tipo);
    if (acao) return Number(acao.value || 0);
  }
  return 0;
}

function calcularLinkClicks(actions) {
  const acao = (actions || []).find((a) => a.action_type === "link_click");
  return acao ? Number(acao.value || 0) : 0;
}

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

/* ---------- Sessão de login (cookie assinado) ----------
   Antes disso o painel usava HTTP Basic Auth (o popup nativo do navegador).
   Trocado porque esse popup guarda a senha em cache no navegador sem
   nenhum controle — trocar a senha na Cloudflare não "esquecia" a antiga
   no navegador, e não existia um jeito de sair/deslogar. Agora é uma tela
   de login própria + cookie de sessão. */

const SESSAO_COOKIE = "pt_session";
const SESSAO_DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

async function assinarHmac(mensagem, chaveTexto) {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw", enc.encode(chaveTexto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(mensagem));
  return btoa(String.fromCharCode(...new Uint8Array(assinatura)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// O token de sessão é assinado usando a própria senha do painel como
// chave secreta — assim não é preciso configurar mais nenhum Secret na
// Cloudflare, e trocar a senha invalida automaticamente qualquer sessão
// aberta em qualquer aparelho/navegador.
async function criarTokenSessao(env) {
  const expira = Date.now() + SESSAO_DURACAO_MS;
  const assinatura = await assinarHmac(String(expira), env.DASHBOARD_PASSWORD);
  return `${expira}.${assinatura}`;
}

async function tokenSessaoValido(token, env) {
  if (!token) return false;
  const partes = token.split(".");
  if (partes.length !== 2) return false;
  const [expiraStr, assinatura] = partes;
  if (!expiraStr || !assinatura) return false;
  if (Date.now() > Number(expiraStr)) return false;
  const esperado = await assinarHmac(expiraStr, env.DASHBOARD_PASSWORD);
  return safeEqual(assinatura, esperado);
}

function lerCookie(request, nome) {
  const header = request.headers.get("Cookie") || "";
  const parte = header.split(";").map((s) => s.trim()).find((s) => s.startsWith(nome + "="));
  return parte ? decodeURIComponent(parte.slice(nome.length + 1)) : null;
}

async function sessaoValida(request, env) {
  if (!env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) return false;
  return tokenSessaoValido(lerCookie(request, SESSAO_COOKIE), env);
}

function paginaLogin(comErro) {
  return new Response(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar — Painel de Tráfego Pago</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=League+Spartan:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;}
  body{
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:'Aileron','Helvetica Neue',Arial,sans-serif;
    background:
      radial-gradient(circle at 18% 20%, rgba(58,152,174,0.35), transparent 45%),
      radial-gradient(circle at 82% 78%, rgba(58,152,174,0.25), transparent 50%),
      #16242c;
  }
  .card{
    width:340px; max-width:88vw;
    background:rgba(255,255,255,0.07);
    backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
    border:1px solid rgba(255,255,255,0.14);
    border-radius:18px;
    padding:36px 30px;
    box-shadow:0 20px 50px rgba(0,0,0,0.35);
  }
  .eyebrow{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#7fd0e6; margin:0 0 6px; }
  .logo{ font-family:'League Spartan',sans-serif; font-weight:800; font-size:21px; color:#fff; margin:0 0 22px; }
  label{ display:block; font-size:12.5px; color:#cfe4ea; margin:14px 0 6px; }
  input{
    width:100%; padding:11px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.18);
    background:rgba(255,255,255,0.06); color:#fff; font-size:14px; outline:none;
  }
  input:focus{ border-color:#3a98ae; }
  button{
    width:100%; margin-top:22px; padding:12px; border:none; border-radius:10px;
    background:#3a98ae; color:#fff; font-weight:700; font-size:14px; cursor:pointer;
  }
  button:hover{ background:#4aa9bf; }
  .erro{
    margin-top:14px; padding:10px 12px; border-radius:8px; font-size:12.5px;
    background:rgba(201,90,44,0.16); color:#ffb98a; border:1px solid rgba(201,90,44,0.35);
  }
</style>
</head>
<body>
  <form class="card" method="POST" action="/api/login">
    <p class="eyebrow">ER Tráfego Pago</p>
    <h1 class="logo">Painel de Tráfego Pago</h1>
    <label>Usuário</label>
    <input type="text" name="user" autocomplete="username" required autofocus>
    <label>Senha</label>
    <input type="password" name="pass" autocomplete="current-password" required>
    <button type="submit">Entrar</button>
    ${comErro ? `<div class="erro">Usuário ou senha incorretos.</div>` : ""}
  </form>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function apiLogin(request, env) {
  const form = await request.formData();
  const user = String(form.get("user") || "");
  const pass = String(form.get("pass") || "");

  if (
    !env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD ||
    !safeEqual(user, env.DASHBOARD_USER) || !safeEqual(pass, env.DASHBOARD_PASSWORD)
  ) {
    return new Response(null, { status: 302, headers: { Location: "/login?erro=1" } });
  }

  const token = await criarTokenSessao(env);
  const headers = new Headers({ Location: "/" });
  headers.append(
    "Set-Cookie",
    `${SESSAO_COOKIE}=${token}; Path=/; Max-Age=${SESSAO_DURACAO_MS / 1000}; HttpOnly; Secure; SameSite=Lax`
  );
  return new Response(null, { status: 302, headers });
}

function fazerLogout() {
  const headers = new Headers({ Location: "/login" });
  headers.append("Set-Cookie", `${SESSAO_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 302, headers });
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

// O endpoint googleAds:searchStream pode devolver a resposta dividida em
// vários blocos (um array com vários objetos, cada um com seu próprio
// "results") quando o volume de linhas é grande — não é garantido que tudo
// venha em data[0]. Juntamos os resultados de todos os blocos aqui, senão
// contas com muitas campanhas/dias perdem linhas silenciosamente.
function extrairLinhasGoogleAds(data) {
  if (!Array.isArray(data)) return [];
  return data.flatMap((bloco) => (bloco && bloco.results) || []);
}

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
  const results = extrairLinhasGoogleAds(data);
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

// A Graph API do Meta pagina os resultados (normalmente 25-100 por página).
// Períodos longos ou contas com muitas campanhas facilmente ultrapassam uma
// página só — seguir "paging.next" evita perder linhas silenciosamente.
async function fetchMetaTodasPaginas(primeiraUrl) {
  let linhas = [];
  let proximaUrl = primeiraUrl;
  let paginas = 0;
  while (proximaUrl && paginas < 50) {
    const res = await fetch(proximaUrl);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    linhas = linhas.concat(data.data || []);
    proximaUrl = data.paging && data.paging.next ? data.paging.next : null;
    paginas++;
  }
  return linhas;
}

async function fetchMetaAdsData(accessToken, adAccountId, igUserId, start, end) {
  if (!adAccountId) throw new Error("Falta configurar o Ad Account ID do Meta Ads deste cliente.");

  const timeRange = encodeURIComponent(JSON.stringify({ since: start, until: end }));

  // Duas chamadas separadas de propósito:
  //
  // 1) SEM breakdown — dá o total real de investimento/impressões/cliques/
  //    resultados por dia, do jeito que o Gerenciador de Anúncios mostra.
  //
  // 2) COM breakdown=publisher_platform — usada só pra saber a divisão de
  //    cliques entre Facebook e Instagram (pro gráfico "Cliques por rede").
  //
  // Por quê duas: quando se pede "actions" com breakdown por
  // publisher_platform, o Meta às vezes atribui a MESMA conversão (ex: uma
  // conversa de mensagem) às duas linhas (Facebook e Instagram) do mesmo
  // dia — e somar as duas linhas duplica o resultado. Foi exatamente esse
  // bug real encontrado: o card de "Resultados" mostrava 62, enquanto a
  // tabela de campanhas (que não usa breakdown) e o Gerenciador de Anúncios
  // mostravam 32. Usando a chamada sem breakdown pra contar resultados,
  // esse problema não acontece.
  const semBreakdownUrl =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?time_range=${timeRange}&time_increment=1&level=account` +
    `&fields=spend,impressions,clicks,actions,reach` +
    `&limit=100&access_token=${accessToken}`;
  const comBreakdownUrl =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?time_range=${timeRange}&time_increment=1&level=account` +
    `&fields=actions&breakdowns=publisher_platform` +
    `&limit=100&access_token=${accessToken}`;

  const [linhasTotais, linhasPorRede] = await Promise.all([
    fetchMetaTodasPaginas(semBreakdownUrl),
    fetchMetaTodasPaginas(comBreakdownUrl),
  ]);

  const byDay = {};
  linhasTotais.forEach((r) => {
    const day = r.date_start;
    byDay[day] = byDay[day] || {
      invest: 0, impressions: 0, clicks: 0, conversions: 0, reach: 0,
      fbClicks: 0, igClicks: 0, profileVisits: 0, newFollowers: 0,
    };

    // Cliques no link — é essa a métrica que aparece no Gerenciador de
    // Anúncios como "Cliques no link" (mais relevante do que o campo bruto
    // "clicks", que também conta curtidas, comentários e outras interações).
    const linkClicks = calcularLinkClicks(r.actions);

    byDay[day].invest += Number(r.spend || 0);
    byDay[day].impressions += Number(r.impressions || 0);
    byDay[day].clicks += linkClicks;
    byDay[day].conversions += calcularResultado(r.actions);
    // "reach" é alcance ÚNICO (pessoas diferentes), não soma perfeitamente
    // certo entre dias (a mesma pessoa pode ser alcançada em dias
    // diferentes) — somar os dias dá uma estimativa, não o alcance único
    // exato do período inteiro. É a mesma limitação que qualquer painel
    // que soma métricas diárias tem; documentado aqui pra não se assustar
    // se não bater 100% com o alcance "acumulado" que a Meta mostra pro
    // período todo.
    byDay[day].reach += Number(r.reach || 0);
  });

  linhasPorRede.forEach((r) => {
    const day = r.date_start;
    if (!byDay[day]) return;
    const linkClicks = calcularLinkClicks(r.actions);
    if (r.publisher_platform === "facebook") byDay[day].fbClicks += linkClicks;
    if (r.publisher_platform === "instagram") byDay[day].igClicks += linkClicks;
  });

  // Visitas ao perfil e novos seguidores — exige a conta comercial do
  // Instagram vinculada (o campo "Meta Ads — Instagram User ID" na
  // configuração do cliente). Sem esse ID, ficam zerados.
  //
  // O erro (se houver) é devolvido em vez de só engolido — antes, se essa
  // parte falhasse (permissão faltando, ID errado, etc.), o painel mostrava
  // 0 pra sempre sem nenhuma pista do motivo real.
  let igError = null;
  if (igUserId) {
    try {
      // "metric_type=time_series" é obrigatório desde que o Meta separou os
      // insights do Instagram em dois formatos: um valor total agregado
      // (total_value, o padrão se você não pedir nada) e uma série diária
      // (time_series, o que o painel precisa pra plotar por dia). Sem esse
      // parâmetro, a API não dá erro — só devolve os dados no formato
      // errado, sem o array "values" que o código abaixo espera, e o
      // resultado final fica sempre zerado sem nenhum aviso.
      const igUrl =
        `https://graph.facebook.com/${META_API_VERSION}/${igUserId}/insights` +
        `?metric=profile_views,follower_count&period=day&metric_type=time_series` +
        `&since=${start}&until=${end}&access_token=${accessToken}`;
      const igRes = await fetch(igUrl);
      const igData = await igRes.json();

      if (igData.error) {
        igError = igData.error.message;
      } else {
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
      }
    } catch (e) {
      igError = e.message;
    }
  }

  return { byDay, igError };
}

/* ---------- Campanhas individuais (dados reais, para a tabela) ---------- */

// Uma linha por campanha do Google Ads, já somada no período inteiro
// (sem quebrar por dia — é isso que a tabela do painel precisa).
async function fetchGoogleCampaigns(env, refreshToken, customerId, start, end) {
  if (!customerId) return [];
  const accessToken = await getGoogleAccessToken(env, refreshToken);

  // Sem "segments.date" no SELECT: o Google Ads soma automaticamente
  // todo o período do WHERE numa linha só por campanha.
  const query = `
    SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
      AND metrics.impressions > 0
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

  const results = extrairLinhasGoogleAds(data);
  return results.map((r) => ({
    name: r.campaign.name,
    platform: "google",
    invest: Number(r.metrics.costMicros || 0) / 1e6,
    impressions: Number(r.metrics.impressions || 0),
    clicks: Number(r.metrics.clicks || 0),
    results: Number(r.metrics.conversions || 0),
  }));
}

// Uma linha por campanha do Meta Ads, somada no período (Facebook +
// Instagram juntos), na mesma lógica de "resultado" usada no resto do painel.
async function fetchMetaCampaigns(accessToken, adAccountId, start, end) {
  if (!adAccountId) return [];

  const timeRange = encodeURIComponent(JSON.stringify({ since: start, until: end }));
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?level=campaign&time_range=${timeRange}` +
    `&fields=campaign_name,spend,impressions,clicks,actions` +
    `&limit=100&access_token=${accessToken}`;

  const linhas = await fetchMetaTodasPaginas(url);

  return linhas.map((r) => ({
    name: r.campaign_name,
    platform: "meta",
    invest: Number(r.spend || 0),
    impressions: Number(r.impressions || 0),
    clicks: calcularLinkClicks(r.actions),
    results: calcularResultado(r.actions),
  }));
}


// O token de longa duração do Meta dura ~60 dias a partir da conexão e não
// é renovado sozinho — passado esse prazo, as chamadas de API começam a
// falhar (aparecendo como erro em /api/metrics) até o cliente ser
// reconectado. Avisamos com antecedência em vez de deixar o dono da agência
// descobrir só quando o relatório de um cliente parar de atualizar.
const META_TOKEN_DURACAO_DIAS = 60;
const META_TOKEN_AVISO_DIAS = 7;

function calcularStatusTokenMeta(meta) {
  if (!meta || !meta.access_token || !meta.connected_at) return null;
  const expiraEm = meta.connected_at + META_TOKEN_DURACAO_DIAS * 24 * 60 * 60 * 1000;
  const diasRestantes = Math.ceil((expiraEm - Date.now()) / (24 * 60 * 60 * 1000));
  return {
    expiresAt: expiraEm,
    daysLeft: diasRestantes,
    expiringSoon: diasRestantes <= META_TOKEN_AVISO_DIAS,
  };
}

async function apiStatus(url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const data = await getClient(env, clientId);
  return json({
    google: !!(data.google && data.google.refresh_token),
    meta: !!(data.meta && data.meta.access_token),
    googleCustomerId: data.googleCustomerId || null,
    metaAdAccountId: data.metaAdAccountId || null,
    metaIgUserId: data.metaIgUserId || null,
    metaToken: calcularStatusTokenMeta(data.meta),
  });
}

// Lista central de clientes já configurados, guardada no próprio KV (a
// chave de cada cliente é sempre "client:<id>"). Antes disso, a lista só
// existia no localStorage do navegador — trocar de computador ou limpar o
// navegador fazia o dono da agência perder a lista de slugs dos clientes.
async function apiClients(env) {
  const ids = [];
  let cursor;
  do {
    const pagina = await env.CLIENTS_KV.list({ prefix: "client:", cursor });
    pagina.keys.forEach((k) => ids.push(k.name.slice("client:".length)));
    cursor = pagina.list_complete ? undefined : pagina.cursor;
  } while (cursor);

  return json({ clients: ids.sort() });
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

// Guarda a resposta de /api/metrics por alguns minutos no KV. Cada troca de
// filtro de data recarregava tudo direto do Google/Meta — lento, e arrisca
// esbarrar em limite de cota do Google Ads em contas com muitas campanhas.
// A chave inclui os IDs de conta configurados: se o dono reconfigurar as
// contas do cliente, a chave muda sozinha e o cache antigo nunca é lido.
const METRICS_CACHE_TTL_SEGUNDOS = 600;

function chaveCacheMetrics(clientId, start, end, data) {
  const config = [data.googleCustomerId || "", data.metaAdAccountId || "", data.metaIgUserId || ""].join("|");
  return `metrics:${sanitizeClientId(clientId)}:${start}:${end}:${config}`;
}

async function apiMetrics(url, env) {
  const clientId = url.searchParams.get("clientId") || "default";
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const data = await getClient(env, clientId);
  if (!data || Object.keys(data).length === 0) {
    return json({ error: "Cliente não encontrado. Conecte as contas primeiro." }, 404);
  }

  const cacheKey = chaveCacheMetrics(clientId, start, end, data);
  const cacheado = await env.CLIENTS_KV.get(cacheKey);
  if (cacheado) return json(JSON.parse(cacheado));

  // Google e Meta são tratados como independentes: se uma plataforma
  // falhar (token expirado, conta desconectada, erro da API), a outra
  // continua funcionando normalmente. Antes, um erro de qualquer uma das
  // duas derrubava a chamada inteira e o painel caía pro modo demonstração
  // sem avisar que os dados reais pararam de carregar.
  const errors = { google: null, meta: null, instagram: null };

  const [googleByDay, metaResultado, googleCampaigns, metaCampaigns] = await Promise.all([
    data.google && data.google.refresh_token
      ? fetchGoogleAdsData(env, data.google.refresh_token, data.googleCustomerId, start, end)
          .catch((e) => { errors.google = e.message; return null; })
      : null,
    data.meta && data.meta.access_token
      ? fetchMetaAdsData(data.meta.access_token, data.metaAdAccountId, data.metaIgUserId, start, end)
          .catch((e) => { errors.meta = e.message; return null; })
      : null,
    data.google && data.google.refresh_token
      ? fetchGoogleCampaigns(env, data.google.refresh_token, data.googleCustomerId, start, end).catch(() => [])
      : [],
    data.meta && data.meta.access_token
      ? fetchMetaCampaigns(data.meta.access_token, data.metaAdAccountId, start, end).catch(() => [])
      : [],
  ]);

  const metaByDay = metaResultado ? metaResultado.byDay : null;
  if (metaResultado && metaResultado.igError) errors.instagram = metaResultado.igError;

  const campaigns = [...googleCampaigns, ...metaCampaigns].sort((a, b) => b.invest - a.invest);

  const resultado = { google: googleByDay, meta: metaByDay, campaigns, errors };

  // Só guarda em cache quando deu tudo certo — assim, se uma conta falhou
  // (token expirado etc.), a próxima tentativa do usuário bate direto na
  // API de novo em vez de repetir o erro por até 10 minutos.
  if (!errors.google && !errors.meta) {
    await env.CLIENTS_KV.put(cacheKey, JSON.stringify(resultado), { expirationTtl: METRICS_CACHE_TTL_SEGUNDOS });
  }

  return json(resultado);
}

/* ---------- Roteador principal ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Login e logout precisam funcionar mesmo sem sessão válida (senão
    // ninguém consegue entrar).
    if (pathname === "/login" && request.method === "GET") {
      return comHeadersSeguranca(paginaLogin(url.searchParams.get("erro")));
    }
    if (pathname === "/api/login" && request.method === "POST") {
      return comHeadersSeguranca(await apiLogin(request, env));
    }
    if (pathname === "/logout") {
      return comHeadersSeguranca(fazerLogout());
    }

    // Todo o resto do site exige sessão válida (cookie de login). Rotas de
    // API devolvem 401 em JSON; o resto manda pra tela de login.
    if (!(await sessaoValida(request, env))) {
      if (pathname.startsWith("/api/")) {
        return comHeadersSeguranca(json({ error: "Sessão expirada. Faça login novamente." }, 401));
      }
      return comHeadersSeguranca(Response.redirect(`${url.origin}/login`, 302));
    }

    let resposta;
    try {
      if (pathname === "/api/auth/google/start") resposta = await authGoogleStart(url, env);
      else if (pathname === "/api/auth/google/callback") resposta = await authGoogleCallback(url, env);
      else if (pathname === "/api/auth/meta/start") resposta = await authMetaStart(url, env);
      else if (pathname === "/api/auth/meta/callback") resposta = await authMetaCallback(url, env);
      else if (pathname === "/api/status" && request.method === "GET") resposta = await apiStatus(url, env);
      else if (pathname === "/api/clients" && request.method === "GET") resposta = await apiClients(env);
      else if (pathname === "/api/client-config" && request.method === "POST") resposta = await apiClientConfig(request, url, env);
      else if (pathname === "/api/metrics" && request.method === "GET") resposta = await apiMetrics(url, env);
      else resposta = await env.ASSETS.fetch(request);
    } catch (err) {
      resposta = json({ error: err.message }, 500);
    }

    return comHeadersSeguranca(resposta);
  },
};
