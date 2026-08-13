# Painel de Tráfego Pago — versão com dados reais

Este projeto é a versão "de verdade" do dashboard: ele se conecta às suas contas
reais do **Google Ads** e do **Meta Ads (Facebook/Instagram)**, busca os números
das campanhas com segurança, e mostra tudo no mesmo painel que já validamos.

Ele é 100% gratuito para rodar em escala pequena/média:

- **GitHub** guarda o código e publica automaticamente a cada alteração.
- **Firebase** hospeda o site (Hosting) e roda o "cérebro" que fala com o
  Google Ads e o Meta Ads (Cloud Functions), além de guardar os tokens de
  acesso com segurança (Firestore).

Você **não precisa escrever nenhum código** — ele já está pronto. Você só
precisa seguir os passos abaixo, que são principalmente "criar conta", "clicar
em criar projeto" e "colar um código aqui".

> ⏱️ Tempo estimado: 1 a 2 horas na primeira vez (a maior parte é esperando
> aprovações do Google e do Meta). Depois de configurado, publicar
> atualizações leva segundos.

---

## Visão geral do que vamos fazer

1. Criar uma conta no GitHub e subir este projeto para lá
2. Criar um projeto no Firebase (gratuito) e ligar ao GitHub
3. Criar as credenciais no Google Cloud (para o Google Ads)
4. Criar um app no Meta for Developers (para o Facebook/Instagram Ads)
5. Colocar essas credenciais no Firebase
6. Publicar o projeto
7. Conectar as contas de anúncio do seu cliente pelo próprio painel

---

## Passo 1 — Colocar o projeto no GitHub

1. Crie uma conta gratuita em [github.com](https://github.com) (se ainda não tiver).
2. Crie um novo repositório (botão **New**), por exemplo `painel-trafego-pago`.
   Deixe como **privado** (só você vai acessar).
3. Na página do repositório recém-criado, clique em **"uploading an existing
   file"** e arraste todos os arquivos e pastas deste projeto para lá
   (mantenha a estrutura de pastas: `functions/`, `public/`, `.github/`, etc.).
4. Clique em **Commit changes** para salvar.

> 💡 Se preferir usar linha de comando (`git`), também funciona normalmente —
> mas o upload pelo site é suficiente e não exige nada instalado.

---

## Passo 2 — Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
   e faça login com uma conta Google.
2. Clique em **Adicionar projeto**, dê um nome (ex: `painel-trafego-pago`) e
   conclua a criação.
3. No menu lateral, vá em **Compilação → Functions** e clique para **ativar**.
   Isso vai pedir para você ativar o **plano Blaze** (pago por uso).
   - Não se assuste: o Blaze tem uma camada gratuita generosa, e um painel
     como esse normalmente fica dentro da faixa gratuita (R$ 0/mês). O plano
     é necessário porque as Functions precisam "conversar" com o Facebook e o
     Google pela internet, o que o plano gratuito (Spark) não permite.
4. Ainda no console, vá em **Compilação → Firestore Database** e clique em
   **Criar banco de dados** (modo produção, localização padrão está ok).
5. Vá em **Configurações do projeto → Contas de serviço** e gere uma chave
   (não precisa usar agora, mas é bom já ter).

### Ligar o Firebase ao GitHub (deploy automático)

1. No terminal do Firebase (ou usando o botão **Hosting** no console), gere um
   token de deploy. Se tiver alguém com acesso a um terminal por perto, o
   comando é:
   ```
   npm install -g firebase-tools
   firebase login:ci
   ```
   Isso vai abrir uma tela de login e, no final, mostrar um código longo
   (o `FIREBASE_TOKEN`).
2. No GitHub, vá até o repositório → **Settings → Secrets and variables →
   Actions → New repository secret**.
3. Nome do secret: `FIREBASE_TOKEN`. Cole o código gerado no passo anterior.
4. Abra o arquivo `.firebaserc` no GitHub e troque `SEU-PROJETO-FIREBASE`
   pelo ID do seu projeto Firebase (aparece em Configurações do projeto).

A partir daqui, toda vez que você alterar um arquivo pelo GitHub, o site é
publicado sozinho automaticamente.

---

## Passo 3 — Credenciais do Google Ads

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) e crie
   um projeto nesse Google Cloud (pode ser o mesmo nome do Firebase).
2. Vá em **APIs e serviços → Biblioteca**, procure por **Google Ads API** e
   clique em **Ativar**.
3. Vá em **APIs e serviços → Tela de consentimento OAuth**:
   - Tipo: Externo
   - Preencha nome do app, e-mail de suporte
   - Em "Escopos", não precisa adicionar nada manualmente agora
4. Vá em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente
   OAuth**:
   - Tipo de aplicativo: **Aplicativo da Web**
   - Em "URIs de redirecionamento autorizados", adicione:
     `https://SEU-PROJETO.web.app/auth/google/callback`
   - Copie o **Client ID** e o **Client Secret** gerados.
5. Solicite um **Developer Token** do Google Ads:
   - Acesse sua conta do Google Ads → ferramenta **Centro de API** (em
     Ferramentas e Configurações → Configuração)
   - Solicite acesso (nível **Básico** é suficiente para começar e costuma
     ser aprovado em poucos dias)

Guarde os três valores: `Client ID`, `Client Secret` e `Developer Token`.

---

## Passo 4 — Credenciais do Meta Ads (Facebook/Instagram)

1. Acesse [developers.facebook.com](https://developers.facebook.com) e crie
   uma conta de desenvolvedor (usa seu login normal do Facebook).
2. Clique em **Meus Apps → Criar App**. Escolha o tipo **Empresa**.
3. Dentro do app criado, adicione o produto **Facebook Login** e configure:
   - Em Configurações → Básico, copie o **App ID** e o **App Secret**.
   - Em Facebook Login → Configurações, adicione em "URIs de redirecionamento
     OAuth válidos":
     `https://SEU-PROJETO.web.app/auth/meta/callback`
4. Adicione também o produto **Marketing API** ao app.
5. Enquanto o app estiver em **modo de desenvolvimento**, ele já funciona
   normalmente para contas de anúncio que você mesmo administra (ideal para
   testar). Para usar com contas de outros clientes, será necessário passar
   pela **Análise do App (App Review)** do Meta e solicitar as permissões
   `ads_read` e `read_insights` — isso pode levar alguns dias.

Guarde os dois valores: `App ID` e `App Secret`.

---

## Passo 5 — Configurar as credenciais no Firebase

Com um terminal (pode ser o Prompt de Comando, PowerShell ou Terminal do
Mac), dentro da pasta do projeto:

```bash
npm install -g firebase-tools
firebase login
firebase use SEU-PROJETO-FIREBASE

firebase functions:config:set ^
  google.client_id="COLE_AQUI" ^
  google.client_secret="COLE_AQUI" ^
  google.developer_token="COLE_AQUI" ^
  meta.app_id="COLE_AQUI" ^
  meta.app_secret="COLE_AQUI" ^
  app.base_url="https://SEU-PROJETO.web.app"
```

> No Mac/Linux, troque o `^` de quebra de linha por `\`.

---

## Passo 6 — Publicar

Se você configurou o GitHub Actions (Passo 2), basta salvar qualquer alteração
no repositório que ele publica sozinho.

Se preferir publicar manualmente pelo terminal:

```bash
firebase deploy --only hosting,functions
```

Ao final, você vai receber o link do seu painel, algo como:
`https://SEU-PROJETO.web.app`

---

## Passo 7 — Conectar as contas do cliente

1. Abra o link do seu painel publicado.
2. Na barra de status no topo, clique em **"Conectar Google Ads"** e faça
   login com a conta que administra os anúncios do cliente.
3. Clique em **"Conectar Meta Ads"** e faça o mesmo com o Facebook.
4. Agora você precisa informar qual conta de anúncio específica usar. Envie
   uma requisição (pode usar o navegador mesmo) para:
   ```
   https://SEU-PROJETO.web.app/api/client-config?clientId=default
   ```
   com o método POST e um corpo JSON como:
   ```json
   {
     "googleCustomerId": "1234567890",
     "metaAdAccountId": "9876543210",
     "metaIgUserId": "17841400000000000"
   }
   ```
   (O `googleCustomerId` fica em Google Ads → canto superior direito. O
   `metaAdAccountId` fica na URL do Gerenciador de Anúncios. O `metaIgUserId`
   é o ID da conta comercial do Instagram, encontrado nas configurações da
   página do Facebook vinculada.)
5. Atualize a página do painel — os números reais devem aparecer no lugar dos
   fictícios, e o aviso "Modo demonstração" desaparece.

Para acompanhar **vários clientes**, repita os passos 7 trocando o
`clientId` (ex: `?cliente=cliente-a`, `?cliente=cliente-b`) — cada um fica
com suas próprias contas conectadas, isolado dos demais.

---

## O que ainda é simplificado nesta primeira versão

- A **tabela de campanhas individuais** ainda usa uma estimativa proporcional
  em vez de puxar campanha por campanha da API — dá pra evoluir depois
  buscando o nível de campanha nas duas plataformas.
- **Novos seguidores do Instagram** dependem de uma conta comercial do
  Instagram vinculada à Página do Facebook, com as permissões do App Review
  aprovadas.
- Enquanto o app do Meta estiver em modo de desenvolvimento, funciona apenas
  com contas de anúncio que a própria conta que criou o app administra.

Qualquer um desses pontos, posso ajudar a evoluir quando quiser.

---

## Resumo do que cada pasta faz

| Pasta/arquivo | Função |
|---|---|
| `public/index.html` | O dashboard (mesmo visual, agora buscando dados reais) |
| `functions/index.js` | O backend: login com Google/Meta e busca das métricas |
| `firebase.json` | Configuração de hospedagem e rotas |
| `firestore.rules` | Bloqueia acesso direto ao banco — só o backend acessa |
| `.github/workflows/deploy.yml` | Publica automaticamente a cada alteração no GitHub |
