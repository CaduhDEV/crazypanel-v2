# CrazyPanel v2

Painel de atendimento das comunidades DataCrazy no WhatsApp. Os atendentes recebem as perguntas feitas nos grupos, respondem com SLA ao vivo, e o admin gerencia equipe, instância, grupos e a base de leads.

Next.js 16 (App Router) · React 19 · Supabase (Auth, Postgres, Realtime, Storage) · uazapi · Tailwind v4 · Radix · TanStack Query · Zod.

## Rodando local

```bash
npm install
cp .env.example .env.local   # preencha (veja abaixo)
npm run dev
```

## Configuração do Supabase (projeto novo)

1. **Migrations**: rode, em ordem, os arquivos de `supabase/migrations/` no SQL Editor (ou `supabase db push`).
2. **Authentication → Sign In / Providers → Email**: provider ligado. Cadastro aberto pode ficar desligado: o acesso é só por convite.
3. **Authentication → URL Configuration**: *Site URL* = URL do app; *Redirect URLs* = `http://localhost:3000/**` e `https://<produção>/**`.
4. **Authentication → Emails**: cole `supabase/templates/invite.html` em *Invite user* e `supabase/templates/recovery.html` em *Reset password*. Os links usam `token_hash` (funcionam em qualquer navegador).
5. **SMTP próprio** em produção (o padrão do Supabase tem limite baixo de envios).
6. **Primeiro admin**: `npm run create-admin -- voce@datacrazy.io "Seu Nome"`. Chega um convite por e-mail; os demais atendentes são convidados pela tela **Atendentes**.

## Conectando a uazapi

1. **Administração → WhatsApp**: informe a *Server URL* e o *token da instância* e clique em **Salvar e testar**. O token é criptografado (AES-256-GCM com `APP_ENCRYPTION_KEY`) e o webhook é registrado automaticamente.
2. Conecte por QR Code ou código de pareamento.
3. **Administração → Grupos**: **Buscar grupos no WhatsApp** e ligue a escuta dos grupos que viram atendimento. **Importar membros** traz todos os participantes para Leads.

A uazapi precisa alcançar `NEXT_PUBLIC_SITE_URL`. Em dev, use um túnel (`cloudflared tunnel --url http://localhost:3000`) e coloque a URL dele em `NEXT_PUBLIC_SITE_URL`.

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client do navegador e do servidor (RLS). |
| `SUPABASE_SECRET_KEY` | Service role. Só servidor: webhook e Server Actions, sempre depois de conferir o papel. |
| `NEXT_PUBLIC_SITE_URL` | Links dos e-mails e URL do webhook. |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | Domínio aceito no formulário (o banco valida em `allowed_email_domains`). |
| `APP_ENCRYPTION_KEY` | 32 bytes em base64 para criptografar o token da instância. Nunca versione o valor. |

## Arquitetura

```
uazapi ──webhook──▶ /api/webhooks/uazapi ──▶ webhook_events ──after()──▶ lib/webhook/process.ts
                                                                         │ ingest_group_message (SQL)
                                                                         │ mídia → Storage (whatsapp-media)
navegador ◀── Realtime (tickets, messages, reações) ◀── Postgres ◀───────┘
navegador ──Server Actions──▶ lib/tickets · lib/admin · lib/leads ──▶ uazapi (/send/*, /message/*)
```

- **Escrita só no servidor.** O navegador lê com RLS (perfil ativo) e escuta o Realtime; toda mudança passa por Server Actions com Zod e checagem de papel (`requireMember` / `requireAdmin`).
- **Webhook rápido.** O evento é gravado em `webhook_events` (sem o token) e o 200 sai na hora; o processamento roda em `after()`. Falhas ficam registradas e podem ser reprocessadas pela tela WhatsApp.
- **Roteamento no banco.** `ingest_group_message` une contato (telefone + `@lid`), registra participação, grava a mensagem e decide o atendimento numa transação com lock por lead e grupo:
  - cita mensagem de um atendimento: do próprio lead entra nele (ou reabre se finalizado há pouco); de outra pessoa entra como contexto; da equipe conta como resposta;
  - sem citação: entra no atendimento aberto do lead naquele grupo, ou abre um novo;
  - equipe sem citação não abre atendimento.
- **SLA** é calculado na tela a partir de `tickets.waiting_since` (mensagem mais antiga do lead sem resposta). Responder zera; nova mensagem do lead volta a contar.
- **Envio** grava a mensagem como `pending`, manda para a uazapi com `track_id` = id da linha (o eco do webhook encontra a mesma linha) e avança o status pelos recibos (`GroupReceipts`), sem nunca regredir.
- **Mídia** recebida é copiada do `fileURL` da uazapi (expira em 2 dias) para o bucket privado e servida por `/api/media/:id`. Mídia enviada sobe do navegador direto para o Storage por URL assinada (sem passar pelo limite de corpo da função).

## Papéis

| | Atendente | Admin |
| --- | --- | --- |
| Inbox e conversa | ✓ | ✓ |
| Limpar fila | | ✓ |
| Leads e vínculo de empresa | | ✓ |
| Atendentes, WhatsApp, Grupos, Configurações | | ✓ |

## Scripts

- `npm run dev` / `build` / `start`
- `npm run typecheck` · `npm run lint`
- `npm run create-admin -- email "Nome"`

## Fora desta entrega

Métricas (o modelo já guarda categoria, motivo de encerramento, primeira resposta e histórico em `ticket_events`), categorização por IA, reporte de bug ao Gleap, aviso no privado e pedidos de entrada na comunidade.
