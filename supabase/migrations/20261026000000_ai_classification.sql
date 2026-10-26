-- =============================================================================
-- Classificação pelo agente de IA do CRM DataCrazy (webhook de ida e volta)
-- =============================================================================
-- O painel manda cada atendimento parado (sem mensagem há um tempo) para o
-- webhook do agente; o agente devolve categoria, subcategoria, quem resolveu,
-- resumo e se precisa da equipe. O painel grava como sugestão no atendimento e,
-- se estiver ligado e for seguro (não precisa da equipe, confiança mínima, nenhuma
-- mensagem nova depois do envio), encerra.

-- Sugestão da IA no próprio atendimento (o Finalizar já abre com ela).
alter table public.tickets
  add column if not exists ai_category text,
  add column if not exists ai_topic text,
  add column if not exists ai_resolved_by text check (ai_resolved_by in ('community', 'team', 'both')),
  add column if not exists ai_needs_team boolean,
  add column if not exists ai_summary text check (length(ai_summary) <= 600),
  add column if not exists ai_confidence numeric(3, 2) check (ai_confidence between 0 and 1),
  add column if not exists ai_classified_at timestamptz,
  add column if not exists closed_by_ai boolean not null default false;

-- Cada envio ao agente (um por atendimento). O retorno usa o id como referência.
create table if not exists public.ai_classification_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  status text not null default 'sent' check (status in ('sent', 'done', 'rejected', 'failed')),
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  attempts integer not null default 1,
  -- O que o painel fez com o retorno: closed (encerrou), suggested (ficou aberto com a sugestão).
  outcome text check (outcome in ('closed', 'suggested')),
  response jsonb,
  error text,
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists ai_requests_ticket_idx on public.ai_classification_requests (ticket_id, sent_at desc);
create index if not exists ai_requests_status_idx on public.ai_classification_requests (status, sent_at);

alter table public.ai_classification_requests enable row level security;
drop policy if exists "ai_requests: admins leem" on public.ai_classification_requests;
create policy "ai_requests: admins leem"
  on public.ai_classification_requests for select to authenticated
  using ((select public.is_admin()));

-- Configurações (Configurações → Agente de IA).
alter table public.app_settings
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_auto_close boolean not null default true,
  add column if not exists ai_min_confidence numeric(3, 2) not null default 0.70 check (ai_min_confidence between 0 and 1),
  add column if not exists ai_idle_minutes integer not null default 30 check (ai_idle_minutes between 5 and 1440);

-- Rotina: manda os atendimentos parados para o agente a cada 30 min (sem efeito
-- enquanto ai_enabled estiver desligado ou o webhook do agente não estiver no .env).
select cron.schedule('crazypanel-ai-classify', '*/30 * * * *', $$select public.call_panel_cron('/api/cron/ai-classify')$$);
