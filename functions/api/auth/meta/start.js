// Rota: GET /api/auth/meta/start
// Abre a tela de login do Facebook para autorizar o acesso ao Meta Ads.

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "default";
  const redirectUri = `${env.APP_BASE_URL}/api/auth/meta/callback`;
  const scope = ["ads_read", "read_insights", "instagram_basic", "pages_read_engagement"].join(",");

  const authUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  authUrl.searchParams.set("client_id", env.META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", clientId);
  authUrl.searchParams.set("scope", scope);

  return Response.redirect(authUrl.toString(), 302);
}
