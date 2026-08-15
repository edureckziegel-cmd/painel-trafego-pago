# Corrigindo o deploy — você caiu no modelo "Worker", não "Pages"

Boas notícias primeiro: **seu site já está no ar** em
`https://painel-trafego-pago.edureckziegel.workers.dev` — isso é o mais
difícil e você já passou! O que falta é ligar o "cérebro" (login com
Google/Meta e busca dos dados reais), que ainda não está conectado.

## O que aconteceu

A Cloudflare tem dois jeitos de publicar um site: **Pages** (o que eu
tinha planejado) e **Worker** (o modelo mais novo deles, que ela escolheu
sozinha pro seu projeto). Nos logs que você mandou, aparece isso:

```
Detected Project Settings:
 - Worker Name: painel-trafego-pago
 - Framework: Static
```

Ou seja: ela publicou como Worker. Nesse modelo, a pasta `functions/` que eu
tinha te passado antes **não funciona sozinha** — preciso te dar um arquivo
único (`src/worker.js`) que faz o mesmo trabalho, só que de um jeito que o
modelo Worker entende.

Já deixei esse arquivo pronto pra você. É só substituir.

---

## Passo 1 — Apagar a pasta `functions/` antiga

No GitHub, dentro do repositório:
1. Clique na pasta `functions`
2. Vá apagando cada arquivo dentro dela (abra o arquivo → ícone da lixeira
   🗑️ → Commit changes). Repita para todos os arquivos dentro de
   `functions/api/...`.

(Isso é só limpeza — eles não fazem mais nada nesse modelo, mas é bom não
deixar arquivo solto por aí.)

## Passo 2 — Adicionar o arquivo `src/worker.js`

1. **Add file → Create new file**
2. No nome do arquivo, digite: `src/worker.js`
3. Cole o conteúdo do arquivo `src/worker.js` que está junto com este guia
4. **Commit changes**

## Passo 3 — Criar o espaço de armazenamento (KV)

1. No menu lateral da Cloudflare, vá em **Compute → Workers e Pages**,
   depois procure a opção **KV** (pode estar em "Storage & Databases" no
   menu, dependendo de como está organizado na sua tela).
2. Clique em **Create namespace**, dê o nome `PAINEL_CLIENTES` e crie.
3. Depois de criado, **copie o ID** do namespace (uma sequência de letras e
   números que aparece do lado do nome).

## Passo 4 — Adicionar o arquivo `wrangler.jsonc`

1. No GitHub, **Add file → Create new file**
2. Nome do arquivo: `wrangler.jsonc` (na raiz do repositório)
3. Cole o conteúdo do arquivo `wrangler.jsonc` que está junto com este guia
4. **Antes de salvar**, troque o texto `COLOQUE_AQUI_O_ID_DO_NAMESPACE_KV`
   pelo ID que você copiou no Passo 3
5. Confira também se a linha `"APP_BASE_URL"` está com o mesmo endereço que
   apareceu pra você (`https://painel-trafego-pago.edureckziegel.workers.dev`)
6. **Commit changes**

## Passo 5 — Colocar as credenciais (Google Ads / Meta Ads)

Assim que você tiver as credenciais do Google Cloud e do Meta for Developers
(os Passos 4 e 5 do guia anterior, que continuam valendo do mesmo jeito),
adicione elas assim:

1. Na Cloudflare, vá até o seu Worker → aba **Settings**
2. Procure **Variables and Secrets** (ou "Variáveis e Secrets")
3. Adicione, uma por uma, marcando como **Secret**:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_DEVELOPER_TOKEN`
   - `META_APP_ID`
   - `META_APP_SECRET`
4. Salve

⚠️ Nos URIs de redirecionamento (lá no Google Cloud e no Meta for
Developers), use:
- `https://painel-trafego-pago.edureckziegel.workers.dev/api/auth/google/callback`
- `https://painel-trafego-pago.edureckziegel.workers.dev/api/auth/meta/callback`

## Passo 6 — Publicar de novo

Depois de fazer os commits acima, vá até a aba **Deployments** do seu
Worker na Cloudflare e clique em **Retry build** (ou espere — ele
costuma disparar sozinho a cada alteração no GitHub).

## Passo 7 — Testar

1. Abra `https://painel-trafego-pago.edureckziegel.workers.dev`
2. A barra de status no topo deve aparecer mostrando "Google Ads não
   conectado" e "Meta Ads não conectado" (em vez de "Backend não publicado")
3. Clique em **Conectar Google Ads** e **Conectar Meta Ads** pra testar o
   login

Se a barra continuar dizendo "Backend não publicado ainda", me manda um
print que a gente resolve juntos.
