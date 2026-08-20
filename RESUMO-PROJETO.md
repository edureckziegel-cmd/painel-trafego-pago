# Painel de Tráfego Pago — Resumo do Projeto (para retomar no Claude Code)

Este documento resume tudo que foi decidido e construído até aqui, pra
você (ou eu, via Claude Code) continuar o desenvolvimento sem perder o
contexto.

---

## 1. O que é o projeto

Um **dashboard de relatórios de tráfego pago** para uma agência (ER
Tráfego Pago) acompanhar campanhas de **Google Ads** e **Meta Ads**
(Facebook/Instagram) de múltiplos clientes, com:

- Métricas principais (investimento, impressões, cliques, CTR, CPC,
  resultados, custo por resultado, ROAS)
- Detalhamento exclusivo do Meta Ads (Facebook x Instagram, visitas ao
  perfil, novos seguidores)
- Gráficos (investimento diário, distribuição por plataforma, cliques por
  rede)
- Tabela de campanhas individuais (dados reais, puxados direto da API)
- Análise em texto automática, em linguagem simples para clientes leigos
- Exportação em PDF pronta para enviar ao cliente
- Múltiplos clientes, cada um com seu próprio link e suas próprias contas
  conectadas
- Login/senha protegendo o painel inteiro
- Tema claro/escuro alternável

**Contexto de negócio:** o usuário (dono do projeto) é dono de uma
agência de tráfego pago, não é programador, e está gerenciando isso tudo
sozinho com ajuda passo a passo (incluindo configuração de contas nas
plataformas). Ele quer, no futuro, possivelmente transformar isso num
produto pra revender pra outras agências — mas isso foi identificado
como uma "fase 2", bem depois de validar com os próprios clientes
primeiro.

---

## 2. Stack técnica (e por que chegamos nela)

### Histórico de decisões

1. **Primeira versão:** dashboard estático em HTML/CSS/JS puro, com dados
   fictícios, gráficos via Chart.js, exportação em PDF via
   html2canvas + jsPDF. Sem backend.
2. **Tentativa 1 — Firebase:** planejamos Firebase Hosting + Cloud
   Functions + Firestore para dados reais. **Abandonado** porque o plano
   Blaze (necessário pras Functions acessarem APIs externas) exigia um
   pré-pagamento de identidade de R$200 que o usuário não queria pagar.
3. **Tentativa 2 — Cloudflare Pages:** planejamos migrar pra Cloudflare
   Pages (gratuito, sem cartão) com Pages Functions (roteamento por
   pasta `/functions`) e Workers KV no lugar do Firestore. **Também não
   vingou** — ao conectar o GitHub, a Cloudflare colocou o projeto no
   modelo "Worker com assets estáticos" (o modelo mais novo deles) em vez
   de "Pages" clássico, e as Pages Functions não funcionam nesse modelo.
4. **Versão final — Cloudflare Worker único:** todo o backend foi
   reescrito como **um único arquivo** (`src/worker.js`) que roteia
   manualmente por `pathname`, usando só Web APIs nativas (`fetch`,
   `URL`, `Response`) — sem Express, sem `googleapis`, sem
   `firebase-admin`. Isso é o que está no ar hoje.

### Stack atual (em produção)

- **Hospedagem + backend:** Cloudflare Workers (modelo "Workers com
  assets estáticos"), gratuito, sem necessidade de cartão de crédito
- **Armazenamento:** Cloudflare Workers KV (substituiu o Firestore) —
  guarda os tokens OAuth e as configurações de cada cliente
- **Deploy:** GitHub conectado à Cloudflare (Workers Builds) — publica
  automaticamente a cada `git push` / commit pela interface do GitHub
- **Frontend:** HTML + CSS + JavaScript puro num arquivo só
  (`index.html`), sem framework, sem build step
- **Gráficos:** Chart.js (via CDN)
- **PDF:** html2canvas + jsPDF (via CDN)
- **Fontes:** League Spartan (títulos/destaques) e Aileron (corpo de
  texto), ambas via CDN
- **APIs externas:** Google Ads API (v17) e Meta Marketing API / Graph
  API (v21.0), autenticação via OAuth 2.0 direto (sem SDKs)

### URL em produção

`https://painel-trafego-pago.edureckziegel.workers.dev`

### Repositório

GitHub: `edureckziegel-cmd/painel-trafego-pago`

---

## 3. Estrutura de arquivos atual

```
painel-trafego-pago/
├── index.html          ← todo o frontend (HTML+CSS+JS num arquivo só)
├── wrangler.jsonc       ← configuração do Worker (bindings, vars)
└── src/
    └── worker.js        ← todo o backend (rotas, OAuth, chamadas de API)
```

Não existe mais `functions/`, `firebase.json`, `firestore.rules`,
`.firebaserc`, nem pasta `public/` — foram todos removidos nas migrações
acima.

### `wrangler.jsonc` (estrutura atual)

```jsonc
{
  "name": "painel-trafego-pago",
  "compatibility_date": "2026-08-14",
  "main": "src/worker.js",
  "observability": { "enabled": true },
  "assets": {
    "directory": ".",
    "binding": "ASSETS",
    "run_worker_first": true   // crítico: sem isso, o Worker nunca roda nas rotas /api/*
  },
  "kv_namespaces": [
    { "binding": "CLIENTS_KV", "id": "<ID real do namespace>" }
  ],
  "vars": {
    "APP_BASE_URL": "https://painel-trafego-pago.edureckziegel.workers.dev"
  }
}
```

### Variáveis/Secrets configurados na Cloudflare (Settings → Variables and Secrets)

| Nome | Tipo | Descrição |
|---|---|---|
| `DASHBOARD_USER` | Secret | usuário do login do painel |
| `DASHBOARD_PASSWORD` | Secret | senha do login do painel |
| `GOOGLE_CLIENT_ID` | Secret | credencial OAuth do Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Secret | credencial OAuth do Google Cloud |
| `GOOGLE_DEVELOPER_TOKEN` | Secret | token do Centro de API do Google Ads |
| `META_APP_ID` | Secret | ID do app no Meta for Developers |
| `META_APP_SECRET` | Secret | Secret do app no Meta for Developers |

---

## 4. Backend (`src/worker.js`) — o que ele faz

### Rotas

| Rota | Método | Função |
|---|---|---|
| `/api/auth/google/start` | GET | Inicia login OAuth do Google Ads |
| `/api/auth/google/callback` | GET | Recebe o retorno do Google, salva refresh_token no KV |
| `/api/auth/meta/start` | GET | Inicia login OAuth do Meta (Facebook) |
| `/api/auth/meta/callback` | GET | Recebe o retorno do Meta, troca por token de longa duração, salva no KV |
| `/api/status` | GET | Devolve se Google/Meta estão conectados pra um `clientId` |
| `/api/client-config` | POST | Salva os IDs de conta de anúncio de um cliente (Customer ID, Ad Account ID, IG User ID) |
| `/api/metrics` | GET | Busca os dados reais (diários + campanhas individuais) das duas plataformas |
| qualquer outra rota | — | Serve os arquivos estáticos (o `index.html`) |

### Segurança implementada

- **Login HTTP Basic Auth** obrigatório em TODAS as rotas (checado antes
  de qualquer outra coisa rodar). Sem `DASHBOARD_USER`/`DASHBOARD_PASSWORD`
  configurados, o site fica bloqueado por padrão.
- **Correção de bug crítico:** a decodificação do Base64 do login não
  tratava corretamente acentos/caracteres especiais (UTF-8) — corrigido
  usando `TextDecoder`.
- **Comparação de senha em tempo constante** (`safeEqual`), pra dificultar
  ataques de timing.
- **Sanitização do `clientId`** vindo da URL antes de usar como chave no
  KV (só `a-z0-9_-`, até 60 caracteres) — evita manipulação via URL.
- **Cabeçalhos de segurança** em toda resposta: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
  frame-ancestors 'none'`.

### Lógica de dados — pontos importantes (bugs já corrigidos)

- **Cliques:** usa especificamente `action_type === 'link_click'` das
  `actions` do Meta, não o campo bruto `clicks` (que inclui curtidas,
  comentários etc. e inflava o número).
- **Resultados/conversões:** usa uma **lista de prioridade**
  (`PRIORIDADE_RESULTADO`) que pega o **primeiro** tipo de ação
  correspondente (conversa de mensagem → compra → lead → cadastro →
  clique no link como último recurso) — **não soma todos os tipos
  parecidos**, porque isso causava contagem duplicada/inflada (bug real
  encontrado: 134 resultados calculados vs. 26 reais no Gerenciador de
  Anúncios).
- **Campanhas individuais reais:** `fetchGoogleCampaigns` e
  `fetchMetaCampaigns` buscam campanha por campanha de verdade (antes, a
  tabela usava uma lista fictícia fixa no código — bug real que passou
  despercebido por várias iterações do projeto).
- **Visitas ao perfil / novos seguidores:** vêm do Instagram Graph API
  (`metric=profile_views,follower_count`), e dependem do campo
  "Instagram User ID" estar preenchido na configuração do cliente.
- Google Ads Developer Token começa em nível **"Test Account access"** —
  precisa solicitar upgrade para **"Basic access"** pra funcionar com
  contas reais de cliente (pode levar alguns dias pra aprovar).
- Meta App em **modo de desenvolvimento** só funciona com contas de
  anúncio que a própria conta do Facebook administra — pra outros
  clientes, precisa ser adicionado como admin na Business Manager deles,
  ou passar pela Análise do App (App Review) pedindo `ads_read` e
  `read_insights`.

---

## 5. Frontend (`index.html`) — o que ele faz

### Estrutura geral

Single-file HTML com `<style>` e `<script>` inline. Sem build step —
qualquer edição é direta no arquivo.

### Funcionalidades

- **Filtros:** período (data inicial/final + atalhos rápidos), plataforma
  (Todas/Meta/Google)
- **Multi-cliente:** cada cliente é identificado por `?cliente=slug` na
  URL. Botão no cabeçalho abre um painel pra trocar/criar cliente. A
  lista de clientes já usados fica salva em `localStorage` (por
  navegador, não é uma lista "oficial" no backend).
- **Configuração de contas por cliente:** botão "⚙ Configurar contas
  deste cliente" abre um formulário (Google Customer ID, Meta Ad Account
  ID, Meta IG User ID) que salva via `POST /api/client-config` — sem
  precisar de ferramentas externas.
- **Modo demonstração:** se não há contas conectadas (ou o backend está
  fora do ar), o painel usa dados fictícios gerados localmente
  (`gerarDadosFicticios()`), com um selo visível "Modo demonstração".
- **Tooltips explicativos:** cada métrica tem uma explicação em
  linguagem simples ao passar o mouse (pensado pra clientes leigos).
- **Comparação com período anterior:** os 4 KPIs principais mostram
  "▲/▼ X% vs. período anterior" quando há dados suficientes carregados.
- **Sparklines:** mini-gráficos de tendência dentro dos cards de KPI.
- **Exportação em PDF:** captura **cada bloco da página separadamente**
  (não a página inteira de uma vez) e monta o PDF garantindo que a quebra
  de página nunca corte um card/gráfico/tabela ao meio (bug real
  corrigido — antes fatiava a imagem inteira em pedaços cegos do tamanho
  de uma página A4). Esconde filtros/controles antes de capturar.
- **Tema claro/escuro:** botão de sol/lua no cabeçalho, escolha salva em
  `localStorage`, gráficos Chart.js são redesenhados com as cores certas
  ao trocar (não é só CSS — o canvas precisa ser refeito).

### Design system

- **Cores da marca:** `#3a98ae` (teal), `#264a60` (navy), `#4e4e4e`
  (cinza), `#ffffff` (branco) — vêm da logo da ER Tráfego Pago (círculo
  preto, "er" em branco/teal)
- **Fontes:** League Spartan (títulos/destaques/valores), Aileron (corpo
  de texto)
- **Favicon:** gerado a partir da logo (`er_logo.png` + variações em
  16/32/180/512px)
- **Estética "vidro fosco":** cards com `backdrop-filter: blur()`,
  fundos semitransparentes, bordas suaves, inspirada em referências de
  dashboards modernos que o usuário mandou (mistura de várias UIs com
  glassmorphism)
- **Cabeçalho e painel de análise:** fundo escuro com gradientes radiais
  ("blobs" de brilho teal), mesmo no tema claro — funciona como um
  "tempero" visual sem comprometer a legibilidade/impressão do resto do
  relatório
- **Tema escuro completo:** implementado via classe `body.theme-dark`
  que sobrescreve as variáveis/cores relevantes; todo o CSS escuro está
  escopado sob esse seletor (não é um arquivo separado)

---

## 6. Limitações conhecidas / próximos passos possíveis

- **Multi-cliente é "por navegador":** a lista de clientes conhecidos
  fica no `localStorage`, não existe uma lista central no backend. Se
  o usuário trocar de computador, precisa saber o slug do cliente de
  cor ou ter o link salvo.
- **Blocos muito altos no PDF:** se um bloco sozinho (ex: tabela de
  campanhas com dezenas de linhas) for mais alto que uma página A4
  inteira, ele pode ultrapassar o limite da página. Funciona bem pra
  volumes normais de campanhas.
- **PDF sempre no tema atual:** se o usuário estiver no tema escuro, o
  PDF sai escuro (gasta mais tinta se impresso). Foi cogitado forçar o
  PDF sempre no tema claro, independente do tema ativo na tela — ainda
  não implementado.
- **Prioridade de "resultado" do Meta é heurística:** cobre os objetivos
  mais comuns (mensagens, vendas, leads, cadastro, cliques), mas pode
  precisar de ajuste fino pra tipos de campanha muito específicos.
- **Sem página de "gerenciar clientes"** centralizada — hoje é tudo via
  URL + localStorage.
- **Sem sistema de múltiplos usuários/permissões** — é um usuário só
  (login único) vendo todos os clientes.
- **Ideia de longo prazo (não iniciada):** transformar isso num produto
  multi-tenant pra revender pra outras agências. Exigiria: sistema de
  contas por agência, cobrança recorrente, acesso "Standard" do Google
  Ads (o "Basic" é pensado pra uso próprio), Business Verification e App
  Review mais rigorosos no Meta, termos de uso, etc. — avaliado como uma
  "fase 2" clara, separada do estado atual.

---

## 7. Como o usuário trabalha (contexto importante pro Claude Code)

- **Não é programador.** Todo o desenvolvimento até aqui foi feito com o
  Claude gerando os arquivos e ele aplicando manualmente no GitHub
  (upload/edição pela interface web) e na Cloudflare (colar variáveis,
  criar KV, etc.).
- Prefere **explicações diretas + arquivos prontos pra aplicar**, não
  trechos de código soltos pra montar sozinho.
- Já passou por bastante fricção técnica (Firebase, Pages vs Workers,
  bugs de dados reais) — vale manter comunicação clara sobre o que
  mudou e por quê a cada ajuste.
- Tem acesso a: conta Cloudflare, conta GitHub, Google Cloud Console
  (com uma conta de administrador do Google Ads já criada), Meta for
  Developers (app "Painel Tráfego Pago" já criado, tipo Empresa).
