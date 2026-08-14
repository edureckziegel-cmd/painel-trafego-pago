// Rota: GET /api/auth/google/start
// Abre a tela de login do Google para o usuário autorizar o acesso ao Google Ads.

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
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
