// Rota: GET /api/auth/meta/callback
// O Facebook chama esta URL de volta depois do login.

import { saveClient, paginaSucesso, META_API_VERSION } from "../../../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
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

  // Troca por um token de longa duração (dura ~60 dias)
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

  return new Response(paginaSucesso("Meta Ads"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
