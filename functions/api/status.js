// Rota: GET /api/status
// Usada pelo painel para mostrar se as contas já estão conectadas.

import { getClient, json } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
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
