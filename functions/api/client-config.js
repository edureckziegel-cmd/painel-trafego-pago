// Rota: POST /api/client-config?clientId=default
// Salva os IDs das contas de anúncio de um cliente específico.
// Corpo esperado: { "googleCustomerId": "...", "metaAdAccountId": "...", "metaIgUserId": "..." }

import { saveClient, json } from "../_utils.js";

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId") || "default";
    const body = await request.json();

    await saveClient(env, clientId, {
      googleCustomerId: body.googleCustomerId,
      metaAdAccountId: body.metaAdAccountId,
      metaIgUserId: body.metaIgUserId,
    });

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
