# CrazyPanel v2

Painel de atendimento das comunidades da DataCrazy no WhatsApp.

Cada pergunta feita num grupo vira um atendimento numa fila com SLA. A equipe responde pelo painel, finaliza com categoria e as métricas saem disso. O painel também cuida da entrada de novos membros, da moderação dos grupos e liga cada lead à empresa dele no CRM.


## Créditos

- Desenvolvimento: Carlos Eduardo ([@CaduhDEV](https://github.com/CaduhDEV))
- Iniciativa: Leonardo Souza
- Mockup do front-end: Murilo Souza

## Sumário

- [Funcionalidades](#funcionalidades)
- [Stack](#stack)
- [Rodando local](#rodando-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [WhatsApp (uazapi)](#whatsapp-uazapi)
- [Agentes de IA do CRM](#agentes-de-ia-do-crm)
- [Deploy](#deploy)
- [Rotinas automáticas](#rotinas-automáticas)
- [Arquitetura](#arquitetura)
- [Pastas](#pastas)
- [Permissões](#permissões)
- [Scripts](#scripts)

## Funcionalidades

### Atendimento

- Inbox com as abas Em aberto, Meus, Em atendimento, SLA estourado e Todos, e o botão Chamar próximo.
- Conversa completa do grupo: texto, áudio, imagem, vídeo, documento, reações, citações e notas internas.
- SLA ao vivo, transferência entre atendentes, mescla e separação de atendimentos, mais de um lead no mesmo atendimento.
- Sugestão de contexto: mensagens de outras pessoas no grupo que podem fazer parte do atendimento, com prévia da mídia.
- Aviso quando o lead tem chamado aberto no Gleap ou conversa recente no WhatsApp do CRM.
- Aviso quando um admin fecha ou abre o grupo.
- Finalizar com categoria e subcategoria, quem resolveu (comunidade, equipe ou os dois) e uma ou mais mensagens que resolveram. Cada autor dessas mensagens ganha o resolvido nas métricas.
- Classificar com IA: o agente sugere categoria, quem resolveu e a mensagem que resolveu. Disponível para atendentes e admins.

### Leads e empresas

- Lista de todos os membros dos grupos, com vínculo à empresa (tenant do CRM) e flags de moderação.
- Vínculo automático pelo Gleap quando o telefone leva a uma empresa só.
- Dados do CRM DataCrazy: documento, responsável e último contato.
- Perfil do lead (`/leads/[id]`): dados, empresas, grupos, chamados do Gleap, números (mensagens, dúvidas, reclamações, elogios) e todas as mensagens com filtros por texto, categoria, tipo, grupo e período.

### Comunidade e moderação

- Pedidos de entrada pelo WhatsApp e pelo formulário ([crazypanel-form](https://github.com/CaduhDEV/crazypanel-form)), com verificação de e-mail e telefone e aceite pelo painel.
- Log de entradas, saídas e convites.
- Flags por lead (advertência no privado), com limite configurável para ficar inapto. Flag numa mensagem específica.
- Moderação automática por IA com as regras da comunidade. A flag fica marcada como "Moderado por IA" e pode ser retirada.
- Divulgador autorizado: o lead não recebe flag.
- Remoção da comunidade com aviso no privado.

### Métricas

- Comunidade e equipe, primeira resposta, SLA, temas, horários de pico e empresas.
- Filtro por período (atalhos ou datas) e por comunidade, sem recarregar a página.
- Rankings da comunidade e da equipe por atendimentos, mensagens ou resoluções.
- Mensagens de números vinculados a um atendente contam para ele.
- Modo telão com slides: ranking por grupo e da equipe.
- Relatório em PDF enviado pelo WhatsApp no dia e hora configurados.

### Cérebro

- Base de conhecimento montada a partir dos atendimentos resolvidos, com frequência e histórico de cada resposta.
- Revisão pelos admins e consulta pelo agente interno do CRM (`/api/cerebro/busca` e `/api/cerebro/panorama`).

### Administração

- Atendentes (convite por e-mail) e os números de WhatsApp de cada um.
- Conexão do WhatsApp, grupos escutados e logs.
- Mensagens: busca e filtros, inclusive o filtro de elogios.
- Configurações: SLA, mensagens automáticas, relatório, moderação, agentes de IA e categorias.
- Histórico: atendimentos finalizados, transcrição, PDF e o histórico importado do sistema antigo (`groups`).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Aplicação | Next.js 16 (App Router, Server Actions, Route Handlers), React 19 |
| Interface | Tailwind CSS 4, Radix UI, lucide, Recharts, sonner |
| Dados no navegador | TanStack Query e Supabase Realtime |
| Banco e login | Supabase: Postgres, Auth, Realtime, Storage, Vault, pg_cron e pg_net |
| Mídia | Cloudflare R2 (via `aws4fetch`) |
| WhatsApp | uazapi |
| Integrações | CRM DataCrazy, Gleap, agentes de IA do CRM |
| Validação | Zod |
| PDF | jsPDF |
| Hospedagem | Node.js 22 (`next build` e `next start`) |

## Rodando local

Requisitos: Node 22 ou mais novo e um projeto no Supabase.

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev                  # http://localhost:3000
```

Para a uazapi entregar mensagens em desenvolvimento, o painel precisa de um endereço público. Use um túnel e coloque a URL em `NEXT_PUBLIC_SITE_URL`:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Variáveis de ambiente

O modelo está em [`.env.example`](.env.example). O `.env.local` não vai para o Git.

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Acesso ao Supabase pelo navegador e pelo servidor, com RLS. |
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase. Só no servidor. |
| `NEXT_PUBLIC_SITE_URL` | Endereço do painel: links dos e-mails, webhook da uazapi e retorno dos agentes. |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Domínio aceito nas contas da equipe. |
| `APP_ENCRYPTION_KEY` | 32 bytes em base64. Criptografa o token da uazapi no banco. Precisa ser igual em ambientes que compartilham o banco. |
| `CRON_SECRET` | Segredo das rotinas. O mesmo valor fica no Vault do Supabase. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PREFIX` | Bucket do Cloudflare R2 das mídias e PDFs. |
| `DATACRAZY_API_URL`, `DATACRAZY_API_KEY` | API do CRM DataCrazy. |
| `GLEAP_API_TOKEN`, `GLEAP_PROJECT_ID` | Leads e chamados do Gleap. `GLEAP_PROJECT_ID` é opcional. |
| `FORM_API_KEY` | Chave compartilhada com o formulário de entrada. |
| `COMMUNITY_FORM_ORIGINS` | Opcional. Endereços do formulário aceitos em `/api/community/join`, separados por vírgula. |
| `EMAIL_OTP_LENGTH`, `EMAIL_OTP_EXPIRY_SECONDS` | Tamanho e validade do código por e-mail, iguais aos do Supabase Auth. |
| `AI_AGENT_WEBHOOK_URL` | Webhook do agente que classifica atendimentos. |
| `AI_MODERATION_WEBHOOK_URL` | Webhook do agente de moderação. |
| `AI_BRAIN_WEBHOOK_URL` | Webhook do agente que monta o Cérebro. |
| `AI_WEBHOOK_SECRET` | Assina o envio aos agentes e autentica o retorno e as consultas ao Cérebro. |

Usadas só por scripts locais: `LEGACY_SUPABASE_URL` e `LEGACY_SUPABASE_SERVICE_KEY` (importação do sistema antigo).

## Banco de dados

1. Migrations: `npx supabase db push`, ou `npx supabase db push --db-url "<connection string>"` para outro projeto. Cada PR que traz migration precisa dela aplicada antes do merge.
2. Authentication › URL Configuration: Site URL com o endereço do painel e, em Redirect URLs, o endereço de produção e `http://localhost:3000/**`.
3. Authentication › Emails: templates de `supabase/templates/`. O topo de cada arquivo indica o template e o assunto. Para mudar o visual, edite `scripts/email-templates.mts` e rode `npx tsx scripts/email-templates.mts`.
4. SMTP próprio com domínio `datacrazy.io`. O envio padrão do Supabase tem limite baixo.
5. Primeiro admin: `npm run create-admin -- voce@datacrazy.io "Seu Nome"`. Os outros são convidados pela tela Atendentes.

## WhatsApp (uazapi)

1. Administração › Conexões: informe a Server URL e o token da instância e clique em Salvar e testar. O webhook é registrado na hora.
2. Conecte por QR Code ou código de pareamento.
3. Administração › Grupos: ligue a escuta dos grupos que viram atendimento e marque o grupo de parceiros.
4. Administração › Atendentes › Números do WhatsApp: cadastre os números de cada atendente.

Ao trocar o endereço do painel, clique em Configurar webhook novamente em Administração › Conexões.

## Agentes de IA do CRM

O painel conversa com três agentes do CRM DataCrazy por webhook. O painel envia, assinado com `AI_WEBHOOK_SECRET`, e o agente devolve no `callback_url` que vai no corpo.

| Agente | Envio | Retorno | Prompt |
| --- | --- | --- | --- |
| Classificação | `AI_AGENT_WEBHOOK_URL` | `/api/ai/classificacoes` | Configurações › Agente de IA |
| Moderação | `AI_MODERATION_WEBHOOK_URL` | `/api/ai/moderacao` | Configurações › Moderação |
| Cérebro | `AI_BRAIN_WEBHOOK_URL` | `/api/ai/cerebro` | Cérebro › Agentes do cérebro |

O agente interno da equipe consulta o Cérebro por `/api/cerebro/busca` e `/api/cerebro/panorama` com a chave em `?key=`.

## Deploy

A produção sai do repositório `leuhsouza/crazypanel-v2`. Qualquer hospedagem com Node.js 22 serve:

```bash
npm ci
npm run build
npm start            # porta 3000 (ou PORT)
```

- As variáveis de ambiente ficam no servidor. As `NEXT_PUBLIC_*` entram no build, então mudar alguma pede um build novo.
- Hospede perto do banco (São Paulo) para as telas responderem rápido.
- Webhooks e rotinas precisam de um endereço HTTPS público, o mesmo de `NEXT_PUBLIC_SITE_URL`.
- Ao trocar o endereço do painel, atualize `NEXT_PUBLIC_SITE_URL`, o segredo `crazypanel_url` no Vault e o webhook da uazapi (Administração › Conexões).

## Rotinas automáticas

Todas as rotinas rodam no `pg_cron` do Supabase, que chama as rotas do painel.

| Rotina | Frequência |
| --- | --- |
| Leads do Gleap (`/api/cron/gleap`) | todo dia, 9h UTC |
| Pedidos de entrada (`/api/cron/join-requests`) | 5 min |
| Chamados do Gleap (`/api/cron/gleap-tickets`) | 10 min |
| Relatório (`/api/cron/report`) | 1 h |
| Classificação por IA (`/api/cron/ai-classify`) | 30 min |
| Fim do Limpar fila (`/api/cron/ai-classify?so=limpeza`) | 5 min |
| Moderação por IA, reenvio (`/api/cron/ai-moderate`) | 10 min |
| Cérebro, retomada (`/api/cron/brain`) | 15 min |
| Mídias com falha (`/api/cron/media-retry`) | 5 min |

O pg_cron chama as rotas com `Authorization: Bearer <CRON_SECRET>`. O endereço e o segredo ficam no Vault, com o mesmo valor de `CRON_SECRET`:

```sql
select vault.create_secret('https://endereco-do-painel', 'crazypanel_url');
select vault.create_secret('<CRON_SECRET>', 'crazypanel_cron_secret');
```

Para trocar depois, use `vault.update_secret`.

## Arquitetura

```
uazapi ──webhook──▶ /api/webhooks/uazapi ──▶ webhook_events ──after()──▶ lib/webhook/process.ts
                                                                          │  ingest_group_message (SQL)
                                                                          │  mídia para o Cloudflare R2
navegador ◀── Realtime (tickets, mensagens, eventos) ◀── Postgres ◀──────┘
navegador ──Server Actions / rotas /api──▶ lib/* ──▶ uazapi, CRM, Gleap, agentes de IA
```

- O navegador lê com RLS e escuta o Realtime. Toda escrita passa por Server Actions com Zod e checagem de permissão.
- Consultas lentas ficam em rotas `/api`, porque o Next roda uma Server Action por vez em cada navegador.
- O webhook grava o evento e responde na hora. O processamento roda depois, com `after()`.
- `ingest_group_message` junta o contato (telefone e `@lid`), grava a mensagem e escolhe o atendimento numa transação com lock por grupo:
  - mensagem que cita outra entra no atendimento da citada;
  - mensagem da equipe sem citação continua a conversa em que a pessoa falou por último;
  - mensagem de lead sem atendimento aberto abre um novo.
- O SLA conta a partir de `tickets.waiting_since`, a mensagem mais antiga do lead ainda sem resposta.
- A mensagem enviada aparece na hora como "enviando", sai pela uazapi com `track_id` e os recibos avançam o status.
- A mídia recebida é copiada para o R2 (o link da uazapi vale 2 dias) e servida por `/api/media/:id`. A enviada sobe do navegador direto para o R2 por URL assinada. Falhas são tentadas de novo pela rotina de mídias.

## Pastas

```
app/
  (app)/            telas logadas: atendimento, leads, moderação, cérebro, métricas, admin
  (auth)/           login, recuperação e definição de senha
  api/              webhook, rotinas, mídia, métricas, PDF, formulário, agentes de IA, cérebro
  telao/            modo telão
components/         interface por área (conversation, inbox, leads, metrics, moderation, brain…)
lib/                regras do servidor: atendimentos, webhook, relatórios, moderação, IA, integrações
supabase/
  migrations/       schema, funções SQL, RLS e rotinas
  templates/        e-mails do Supabase Auth
scripts/            admin inicial, templates de e-mail, importação do sistema antigo
```

## Permissões

| | Atendente | Admin |
| --- | :---: | :---: |
| Inbox, conversa e finalizar | ✓ | ✓ |
| Classificar com IA | ✓ | ✓ |
| Perfil do lead | ✓ | ✓ |
| Criar categoria no Finalizar | | ✓ |
| Limpar fila | | ✓ |
| Leads, empresas, convites e histórico | | ✓ |
| Solicitações de entrada e moderação | | ✓ |
| Cérebro | | ✓ |
| Métricas e telão | | ✓ |
| Atendentes, conexões, grupos, mensagens, logs e configurações | | ✓ |

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
| `npx tsx --env-file=.env.local scripts/media-to-r2.mts` | Move mídias antigas do Storage do Supabase para o R2 |
