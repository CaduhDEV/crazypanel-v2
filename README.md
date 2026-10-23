# CrazyPanel v2

Painel de atendimento das comunidades da DataCrazy no WhatsApp.

As perguntas feitas nos grupos viram atendimentos numa fila com SLA. A equipe responde pelo painel, e o que acontece nos grupos (entradas, saídas, pedidos para entrar, grupo fechado) fica registrado. Cada lead é ligado à empresa dele no CRM, e no fim de cada atendimento a categoria alimenta as métricas e o relatório semanal.

Produção: https://crazypanel.vercel.app

## Créditos

- **Desenvolvimento:** Carlos Eduardo ([@CaduhDEV](https://github.com/CaduhDEV))
- **Iniciativa:** Leonardo Souza
- **Mockup do front-end:** Murilo Souza

## Sumário

- [O que o painel faz](#o-que-o-painel-faz)
- [Stack](#stack)
- [Rodando local](#rodando-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados (Supabase)](#banco-de-dados-supabase)
- [WhatsApp (uazapi)](#whatsapp-uazapi)
- [Deploy (Vercel)](#deploy-vercel)
- [Rotinas automáticas](#rotinas-automáticas)
- [Como funciona por dentro](#como-funciona-por-dentro)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Papéis](#papéis)
- [Scripts](#scripts)

## O que o painel faz

**Atendimento**
- Inbox com as abas Em aberto, Meus, Em atendimento, SLA estourado e Todos, e o botão Chamar próximo.
- Conversa completa do grupo: texto, áudio, imagem, vídeo, documento, reações, citações e notas internas.
- SLA ao vivo, transferência entre atendentes, mescla e separação de atendimentos e mais de um lead no mesmo atendimento.
- Aviso de outro canal aberto: chamado ativo no Gleap ou conversa recente no WhatsApp do CRM.
- Aviso com cadeado quando um admin fecha ou abre o grupo.
- Ao finalizar: categoria e subcategoria (obrigatórias), quem resolveu (comunidade, equipe ou os dois) e a mensagem que resolveu.

**Leads e empresas**
- Todos os membros dos grupos, com o vínculo à empresa (tenant do CRM).
- Vínculo automático pelo Gleap quando o telefone leva a uma empresa só.
- Dados do CRM DataCrazy: documento, responsável e último contato.
- Filtros Sem vínculo, Vinculados, Várias empresas, Parceiros, Equipe e Ex-membros.

**Comunidade**
- Solicitações de entrada: pedidos pelo WhatsApp e pelo formulário ([crazypanel-form](https://github.com/CaduhDEV/crazypanel-form)), com verificação de e-mail e telefone e aceite pelo painel.
- Log de entradas, saídas e convites.

**Métricas**
- Comunidade × equipe, primeira resposta, SLA, temas, horários de pico e empresas.
- Período por atalho (7, 30 ou 90 dias) ou por data inicial e final.
- Modo telão para a TV do escritório, com slides e pódio.
- Relatório oficial em PDF, enviado pelo WhatsApp aos atendentes escolhidos, no dia e hora configurados.

**Administração**
- Atendentes (convite por e-mail), conexão do WhatsApp, grupos escutados e logs.
- Base de mensagens com busca e filtros.
- Configurações: SLA, mensagens automáticas e relatório.
- Categorias editáveis: o admin também cria categoria e subcategoria direto no Finalizar.

**Histórico**
- Atendimentos finalizados, transcrição, exportação em PDF e o histórico importado do sistema antigo (`groups`).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Front-end e servidor | Next.js 16 (App Router, Server Actions, Route Handlers), React 19 |
| Interface | Tailwind CSS 4, Radix UI (componentes no padrão shadcn), lucide, Recharts, sonner |
| Dados no navegador | TanStack Query + Supabase Realtime |
| Banco e login | Supabase: Postgres, Auth, Realtime, Storage, Vault, pg_cron e pg_net |
| Arquivos de mídia | Cloudflare R2 (S3 compatível, via `aws4fetch`) |
| WhatsApp | uazapi |
| Integrações | CRM DataCrazy, Gleap |
| Validação | Zod |
| PDF | jsPDF |
| Hospedagem | Vercel (funções em São Paulo, `gru1`) |

## Rodando local

Requisitos: Node 22 ou mais novo e um projeto no Supabase.

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev                  # http://localhost:3000
```

Para a uazapi entregar as mensagens em desenvolvimento, o painel precisa de um endereço público. Use um túnel e coloque a URL dele em `NEXT_PUBLIC_SITE_URL`:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Variáveis de ambiente

O modelo completo está em [`.env.example`](.env.example). O `.env.local` não vai para o Git.

| Variável | Para que serve |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Acesso ao Supabase pelo navegador e pelo servidor (com RLS). |
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase. Só no servidor, sempre depois de conferir o papel de quem pediu. |
| `NEXT_PUBLIC_SITE_URL` | Endereço do painel: links dos e-mails e URL do webhook da uazapi. |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Domínio aceito nas contas da equipe. |
| `APP_ENCRYPTION_KEY` | 32 bytes em base64. Criptografa o token da instância da uazapi no banco. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PREFIX` | Bucket do Cloudflare R2 onde ficam as mídias. |
| `DATACRAZY_API_URL`, `DATACRAZY_API_KEY` | API do CRM DataCrazy. |
| `GLEAP_API_TOKEN`, `GLEAP_PROJECT_ID` | Leads e chamados do Gleap. |
| `FORM_API_KEY` | Chave compartilhada com o formulário de entrada na comunidade. |
| `EMAIL_OTP_LENGTH`, `EMAIL_OTP_EXPIRY_SECONDS` | Tamanho e validade do código por e-mail (iguais ao Supabase Auth). |
| `CRON_SECRET` | Segredo das rotinas automáticas. |

Usadas só por scripts locais: `CLOUDFLARE_API_TOKEN` (CORS do bucket) e `LEGACY_SUPABASE_URL` / `LEGACY_SUPABASE_SERVICE_KEY` (importação do sistema antigo).

## Banco de dados (Supabase)

1. **Migrations:** `npx supabase db push`, ou rode os arquivos de `supabase/migrations/` em ordem no SQL Editor.
2. **Authentication → URL Configuration:** Site URL com o endereço do painel. Em Redirect URLs, `https://crazypanel.vercel.app/**` e `http://localhost:3000/**`.
3. **Authentication → Emails:** cole os templates de `supabase/templates/`. O topo de cada arquivo diz o template e o assunto. Para mudar o visual, edite `scripts/email-templates.mts` e rode `npx tsx scripts/email-templates.mts`.
4. **SMTP próprio** em produção, porque o envio padrão do Supabase tem limite baixo.
5. **Primeiro admin:** `npm run create-admin -- voce@datacrazy.io "Seu Nome"`. Os demais são convidados pela tela Atendentes.

## WhatsApp (uazapi)

1. **Administração → WhatsApp:** informe a Server URL e o token da instância e clique em Salvar e testar. O webhook é registrado sozinho.
2. Conecte por QR Code ou código de pareamento.
3. **Administração → Grupos:** busque os grupos e ligue a escuta dos que viram atendimento.

Ao trocar o endereço do painel (túnel → produção), clique em **Configurar webhook novamente** em Administração → Conexões.

## Deploy (Vercel)

```bash
npx vercel deploy --prod
```

- As variáveis ficam no painel da Vercel (Settings → Environment Variables).
- O `vercel.json` fixa as funções em São Paulo (`gru1`), perto do banco.
- O `.vercelignore` impede que o `.env.local` suba no deploy pela CLI.

## Rotinas automáticas

O plano grátis da Vercel só roda cron uma vez por dia. Por isso, as rotinas ficam divididas assim:

| Rotina | Frequência | Onde roda |
| --- | --- | --- |
| Leads do Gleap (`/api/cron/gleap`) | todo dia, 9h UTC | Vercel Cron |
| Pedidos de entrada (`/api/cron/join-requests`) | a cada 5 min | `pg_cron` no Supabase |
| Chamados do Gleap (`/api/cron/gleap-tickets`) | a cada 10 min | `pg_cron` no Supabase |
| Relatório (`/api/cron/report`) | de hora em hora | `pg_cron` no Supabase |

O `pg_cron` chama as rotas com `Authorization: Bearer <CRON_SECRET>`. O endereço do painel e o segredo ficam no Vault do Supabase, e não no código. Cadastre uma vez no SQL Editor:

```sql
select vault.create_secret('https://crazypanel.vercel.app', 'crazypanel_url');
select vault.create_secret('<CRON_SECRET>', 'crazypanel_cron_secret');
```

## Como funciona por dentro

```
uazapi ──webhook──▶ /api/webhooks/uazapi ──▶ webhook_events ──after()──▶ lib/webhook/process.ts
                                                                          │  ingest_group_message (SQL)
                                                                          │  mídia → Cloudflare R2
navegador ◀── Realtime (tickets, mensagens, eventos) ◀── Postgres ◀──────┘
navegador ──Server Actions / rotas /api──▶ lib/* ──▶ uazapi · CRM · Gleap
```

- **Escrita só no servidor.** O navegador lê com RLS e escuta o Realtime. Toda mudança passa por Server Actions com Zod e checagem de papel.
- **Leituras lentas são rotas `/api`, não Server Actions.** O Next roda uma Server Action por vez em cada navegador, então uma consulta ao CRM seguraria o envio de mensagens.
- **Webhook rápido.** O evento é gravado e o 200 sai na hora. O processamento roda depois da resposta (`after()`).
- **Roteamento no banco.** `ingest_group_message` une o contato (telefone e `@lid`), grava a mensagem e decide o atendimento numa transação com lock por grupo:
  - mensagem que cita outra entra no atendimento da citada;
  - mensagem da equipe sem citação continua a conversa em que a pessoa falou por último;
  - mensagem de lead sem atendimento aberto abre um novo.
- **SLA** calculado a partir de `tickets.waiting_since`, que é a mensagem mais antiga do lead sem resposta.
- **Envio:** a mensagem aparece na hora como "enviando". Ela é gravada com o mesmo id e sai pela uazapi com `track_id`, e os recibos avançam o status sem regredir.
- **Mídia** recebida é copiada para o R2 (o link da uazapi expira em 2 dias) e servida por `/api/media/:id`. A enviada sobe do navegador direto para o R2 por URL assinada.
- **Fila em tempo real:** cada evento do Realtime é aplicado direto na lista, sem recarregar a fila inteira para cada atendente.

## Estrutura de pastas

```
app/
  (app)/            telas logadas: atendimento, leads, histórico, métricas, admin…
  (auth)/           login, recuperar e definir senha, retorno dos links de e-mail
  api/              webhook, rotinas, mídia, métricas, PDF, formulário
  telao/            modo telão (fora do layout do painel)
components/         interface, separada por área (conversation, inbox, leads, metrics…)
lib/                regras do servidor: tickets, webhook, relatórios, integrações
supabase/
  migrations/       schema, funções SQL, RLS e rotinas
  templates/        e-mails do Supabase Auth
scripts/            admin inicial, templates de e-mail, importação do sistema antigo
```

## Papéis

| | Atendente | Admin |
| --- | :---: | :---: |
| Inbox, conversa e finalizar | ✓ | ✓ |
| Criar categoria no Finalizar | | ✓ |
| Limpar fila | | ✓ |
| Leads, empresas, convites e histórico | | ✓ |
| Solicitações de entrada | | ✓ |
| Métricas e telão | | ✓ |
| Atendentes, WhatsApp, grupos, mensagens, logs e configurações | | ✓ |

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e servidor de produção |
| `npm run typecheck` | Checagem de tipos |
| `npm run lint` | ESLint |
| `npm run create-admin -- email "Nome"` | Cria o primeiro admin (convite por e-mail) |
| `npx tsx scripts/email-templates.mts` | Gera os templates de e-mail |
| `npx tsx --env-file=.env.local scripts/legacy-import/run.mts` | Importa o histórico do sistema antigo (`groups`) |
