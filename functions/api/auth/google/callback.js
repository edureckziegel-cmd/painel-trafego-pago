// Rota: GET /api/auth/google/callback
// O Google chama esta URL de volta depois que o usuário faz login e autoriza.

import { saveClient, paginaSucesso } from "../../../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
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

  return new Response(paginaSucesso("Google Ads"), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
