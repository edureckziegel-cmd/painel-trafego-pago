
// Funções compartilhadas pelos outros arquivos desta pasta.
// Este arquivo não vira uma rota (não fica dentro de /api diretamente
// acessível) — ele só guarda pedaços de código reutilizados.

export async function getClient(env, clientId) {
  const raw = await env.CLIENTS_KV.get(`client:${clientId}`);
  return raw ? JSON.parse(raw) : {};
}

export async function saveClient(env, clientId, patch) {
  const current = await getClient(env, clientId);
  const updated = { ...current, ...patch };
  await env.CLIENTS_KV.put(`client:${clientId}`, JSON.stringify(updated));
  return updated;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const META_API_VERSION = "v21.0";
export const GOOGLE_ADS_API_VERSION = "v17";

export function paginaSucesso(nome) {
  return `<html><body style="font-family:sans-serif;text-align:center;padding-top:80px;">
    <h2>✅ ${nome} conectado com sucesso!</h2>
    <p>Você já pode fechar esta aba e voltar para o painel.</p>
  </body></html>`;
}
