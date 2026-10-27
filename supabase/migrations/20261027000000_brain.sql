-- =============================================================================
-- Cérebro da comunidade (privado: só admins)
-- =============================================================================
-- Um agente de IA do CRM lê os atendimentos RESOLVIDOS, em ordem de
-- encerramento, e devolve o conhecimento: pergunta, resposta que funcionou,
-- categoria e assunto. Respostas parecidas viram o mesmo item (frequência);
-- uma resposta nova para a mesma pergunta atualiza o item (a informação muda
-- com o tempo) e a anterior fica no histórico. A busca pesa texto, frequência
-- e quando a resposta foi vista pela última vez.

create table if not exists public.brain_items (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(question) between 3 and 500),
  answer text not null check (length(answer) between 3 and 4000),
  category text,
  topic text,
  -- draft: gerado pela IA, sem revisão; approved: revisado; archived: fora da busca.
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  -- Atendimentos que confirmaram o item (frequência).
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Quando a resposta mudou pela última vez.
  answer_changed_at timestamptz not null default now(),
  -- Resposta nova sugerida pela IA para um item revisado (o admin aceita ou não).
  proposed_answer text check (length(proposed_answer) <= 4000),
  proposed_at timestamptz,
  proposed_ticket_id uuid references public.tickets (id) on delete set null,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  edited boolean not null default false,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(question, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(answer, '')), 'B')
  ) stored
);

create index if not exists brain_items_search_idx on public.brain_items using gin (search);
create index if not exists brain_items_status_idx on public.brain_items (status, last_seen_at desc);

-- De onde cada item saiu (um atendimento confirma um item uma vez).
create table if not exists public.brain_sources (
  item_id uuid not null references public.brain_items (id) on delete cascade,
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  -- Quando o atendimento foi resolvido (linha do tempo da informação).
  seen_at timestamptz not null,
  action text not null check (action in ('new', 'same', 'update')),
  answer text check (length(answer) <= 4000),
  primary key (item_id, ticket_id)
);
create index if not exists brain_sources_ticket_idx on public.brain_sources (ticket_id);
create index if not exists brain_sources_seen_idx on public.brain_sources (seen_at desc);

-- Respostas anteriores de cada item.
create table if not exists public.brain_item_versions (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.brain_items (id) on delete cascade,
  answer text not null,
  valid_until timestamptz not null default now(),
  ticket_id uuid references public.tickets (id) on delete set null,
  changed_by uuid references public.profiles (id) on delete set null
);
create index if not exists brain_item_versions_item_idx on public.brain_item_versions (item_id, valid_until desc);

-- Cada lote enviado ao agente do cérebro.
create table if not exists public.brain_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'sent' check (status in ('sent', 'done', 'rejected', 'failed')),
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  ticket_ids uuid[] not null default '{}',
  created integer not null default 0,
  confirmed integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  response jsonb,
  error text
);
create index if not exists brain_requests_sent_idx on public.brain_requests (sent_at desc);

-- Atendimento já lido pelo cérebro.
alter table public.tickets add column if not exists brain_processed_at timestamptz;
create index if not exists tickets_brain_pending_idx on public.tickets (closed_at)
  where brain_processed_at is null and status = 'closed' and close_reason = 'resolved';

alter table public.app_settings add column if not exists brain_enabled boolean not null default false;

alter table public.brain_items enable row level security;
alter table public.brain_sources enable row level security;
alter table public.brain_item_versions enable row level security;
alter table public.brain_requests enable row level security;
drop policy if exists "brain_items: admins leem" on public.brain_items;
create policy "brain_items: admins leem" on public.brain_items for select to authenticated using ((select public.is_admin()));
drop policy if exists "brain_sources: admins leem" on public.brain_sources;
create policy "brain_sources: admins leem" on public.brain_sources for select to authenticated using ((select public.is_admin()));
drop policy if exists "brain_item_versions: admins leem" on public.brain_item_versions;
create policy "brain_item_versions: admins leem" on public.brain_item_versions for select to authenticated using ((select public.is_admin()));
drop policy if exists "brain_requests: admins leem" on public.brain_requests;
create policy "brain_requests: admins leem" on public.brain_requests for select to authenticated using ((select public.is_admin()));

-- Busca: qualquer palavra da pergunta (OU), pesando o texto, a frequência
-- (quantos atendimentos confirmaram) e a recência (meia-vida de ~4 meses desde
-- a última vez que a resposta foi vista).
create or replace function public.brain_search(p_query text, p_category text default null, p_limit integer default 5, p_include_drafts boolean default true)
returns table (
  id uuid,
  question text,
  answer text,
  category text,
  topic text,
  status text,
  occurrences integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  answer_changed_at timestamptz,
  proposed_answer text,
  proposed_at timestamptz,
  score double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(replace(plainto_tsquery('portuguese', coalesce(p_query, ''))::text, '&', '|'), '')::tsquery as tsq
  )
  select i.id, i.question, i.answer, i.category, i.topic, i.status, i.occurrences, i.first_seen_at, i.last_seen_at,
         i.answer_changed_at, i.proposed_answer, i.proposed_at,
         ts_rank_cd(i.search, q.tsq)
           * (1 + ln(1 + i.occurrences))
           * exp(-greatest(0, extract(epoch from (now() - greatest(i.last_seen_at, coalesce(i.proposed_at, i.last_seen_at))))) / 86400.0 / 180.0)
           * (case when i.status = 'approved' then 1.25 else 1 end) as score
  from public.brain_items i, q
  where q.tsq is not null
    and i.search @@ q.tsq
    and i.status <> 'archived'
    and (p_include_drafts or i.status = 'approved')
    and (p_category is null or i.category = p_category)
  order by score desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

revoke all on function public.brain_search(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.brain_search(text, text, integer, boolean) to service_role;

-- Rotina de garantia: retoma a leitura se o encadeamento parar (cada retorno
-- do agente já manda o próximo lote).
select cron.schedule('crazypanel-brain', '*/15 * * * *', $$select public.call_panel_cron('/api/cron/brain')$$);
