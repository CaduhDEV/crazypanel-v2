-- =============================================================================
-- Moderação: flag numa mensagem específica e moderação pela IA
-- =============================================================================
-- Cada flag pode apontar a mensagem que violou as regras (dada no atendimento
-- ou pela IA). A IA lê as mensagens novas dos grupos e dá flag no que cai nas
-- regras da comunidade; fica marcado como "Moderado por IA" e o admin desfaz se
-- a IA errar.

alter table public.moderation_events
  add column if not exists message_id uuid references public.messages (id) on delete set null,
  add column if not exists by_ai boolean not null default false,
  -- Regra violada (texto da regra, para a IA; livre para o admin).
  add column if not exists rule text check (length(rule) <= 300),
  add column if not exists confidence numeric(3, 2) check (confidence between 0 and 1),
  -- Flag desfeita (retirada): continua no histórico.
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid references public.profiles (id) on delete set null;

-- Uma flag ativa por mensagem (a IA e dois admins não marcam a mesma duas vezes).
create unique index if not exists moderation_events_message_flag_uidx
  on public.moderation_events (message_id)
  where type = 'flag_added' and reverted_at is null and message_id is not null;
create index if not exists moderation_events_active_flags_idx
  on public.moderation_events (contact_id, created_at desc)
  where type = 'flag_added' and reverted_at is null;

-- Mensagem com flag (aparece marcada no atendimento) e já lida pela IA.
alter table public.messages
  add column if not exists flagged_at timestamptz,
  add column if not exists ai_moderated_at timestamptz;
create index if not exists messages_ai_moderation_idx
  on public.messages (sent_at)
  where ai_moderated_at is null and from_me = false and is_note = false;

-- Cada lote de mensagens enviado ao agente de moderação.
create table if not exists public.ai_moderation_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'sent' check (status in ('sent', 'done', 'rejected', 'failed')),
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  message_ids uuid[] not null default '{}',
  flagged integer not null default 0,
  response jsonb,
  error text
);
create index if not exists ai_moderation_requests_sent_idx on public.ai_moderation_requests (sent_at desc);

alter table public.ai_moderation_requests enable row level security;
drop policy if exists "ai_moderation_requests: admins leem" on public.ai_moderation_requests;
create policy "ai_moderation_requests: admins leem"
  on public.ai_moderation_requests for select to authenticated
  using ((select public.is_admin()));

alter table public.app_settings
  -- Uma regra por linha. Vai para a IA e serve de referência para a equipe.
  add column if not exists community_rules text not null default
    E'Anúncios de qualquer espécie sem aprovação\nCompra ou venda de BM\nOferta ou procura de serviços de disparos\nToxicidade, preconceito, xingamentos e ofensas'
    check (length(community_rules) <= 3000),
  add column if not exists ai_moderation_enabled boolean not null default false,
  add column if not exists ai_moderation_min_confidence numeric(3, 2) not null default 0.80 check (ai_moderation_min_confidence between 0 and 1),
  -- Mandar a advertência no privado quando a IA dá a flag.
  add column if not exists ai_moderation_warn boolean not null default false;

-- Rotina: a cada 2 min, as mensagens novas vão para o agente de moderação (sem
-- efeito com a moderação por IA desligada ou sem AI_MODERATION_WEBHOOK_URL).
select cron.schedule('crazypanel-ai-moderate', '*/2 * * * *', $$select public.call_panel_cron('/api/cron/ai-moderate')$$);
