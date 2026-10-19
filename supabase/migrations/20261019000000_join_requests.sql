-- =============================================================================
-- Solicitações de entrada nas comunidades e log de membros
-- =============================================================================
-- Duas origens:
--   form     → formulário externo (middleware) chama /api/community/join;
--   whatsapp → pedido de entrada feito no próprio WhatsApp (grupo com aprovação),
--              lido em /group/info (a uazapi não manda evento para isso).
-- O admin aceita ou recusa no painel. Tudo fica em community_events.

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('form', 'whatsapp')),
  phone text,                       -- dígitos com DDI
  lid text,
  phone_key text generated always as (public.phone_key(phone)) stored,
  email text,
  name text,
  form_source text,                 -- campo "source" enviado pelo formulário
  group_jid text references public.wa_groups (jid) on delete set null, -- grupo pedido (WhatsApp)
  contact_id uuid references public.contacts (id) on delete set null,
  -- Vínculo encontrado na triagem.
  link_status text check (link_status in ('found', 'not_found', 'error')),
  company_id uuid references public.companies (id) on delete set null,
  company_name text,
  gleap_tenant_id text,
  crm_lead_id text,
  crm_tax_id text,
  -- pending  → aguardando o admin
  -- accepted → aceito; adicionado/aprovado no(s) grupo(s)
  -- invited  → a privacidade bloqueou a adição: convite enviado no privado
  -- joined   → já está (ou entrou) num grupo da comunidade
  -- rejected → recusado pelo admin
  -- expired  → pedido do WhatsApp sumiu sem decisão no painel (resolvido pelo celular)
  -- error    → falha técnica (ver error)
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invited', 'joined', 'rejected', 'expired', 'error')),
  target_groups text[] not null default '{}',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists join_requests_status_idx on public.join_requests (status, created_at desc);
create index if not exists join_requests_phone_key_idx on public.join_requests (phone_key);
-- Um pedido pendente por pessoa e grupo (a consulta periódica não duplica).
create unique index if not exists join_requests_whatsapp_pending_key
  on public.join_requests (group_jid, coalesce(phone_key, lid))
  where source = 'whatsapp' and status = 'pending';

drop trigger if exists join_requests_touch on public.join_requests;
create trigger join_requests_touch
  before update on public.join_requests
  for each row execute function public.touch_updated_at();

alter table public.join_requests enable row level security;
drop policy if exists "join_requests: admins leem" on public.join_requests;
create policy "join_requests: admins leem"
  on public.join_requests for select to authenticated
  using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Log da comunidade
-- -----------------------------------------------------------------------------
create table if not exists public.community_events (
  id bigint generated always as identity primary key,
  type text not null check (type in (
    'request_created', 'request_accepted', 'request_rejected', 'request_expired',
    'invite_sent', 'add_failed', 'approve_failed',
    'added_by_admin', 'invited_by_member', 'joined_via_link',
    'left', 'removed', 'pv_sent', 'pv_failed'
  )),
  group_jid text,
  contact_id uuid references public.contacts (id) on delete set null,
  phone text,
  name text,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_phone text,                 -- quem fez a ação no WhatsApp (Sender)
  actor_name text,
  request_id uuid references public.join_requests (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists community_events_created_idx on public.community_events (created_at desc);
create index if not exists community_events_request_idx on public.community_events (request_id, created_at);

alter table public.community_events enable row level security;
drop policy if exists "community_events: admins leem" on public.community_events;
create policy "community_events: admins leem"
  on public.community_events for select to authenticated
  using ((select public.is_admin()));

do $$
declare
  t text;
begin
  foreach t in array array['join_requests', 'community_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Mensagens no privado ({nome}, {grupo}, {email})
-- -----------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists join_msg_no_company text not null default
    'Olá, {nome}! Recebemos seu pedido para entrar na comunidade DataCrazy, mas não encontramos nenhuma empresa cadastrada com o e-mail {email}. Confira se é o mesmo e-mail que você usa no CRM DataCrazy e envie o formulário novamente.'
    check (length(join_msg_no_company) between 1 and 1000),
  add column if not exists join_msg_rejected text not null default
    'Olá, {nome}! Seu pedido para entrar na comunidade DataCrazy não foi aprovado.'
    check (length(join_msg_rejected) between 1 and 1000),
  add column if not exists join_msg_accepted text not null default
    'Olá, {nome}! Seu pedido foi aprovado e você entrou no grupo {grupo}. Seja bem-vindo(a) à comunidade DataCrazy!'
    check (length(join_msg_accepted) between 1 and 1000);

-- Última leitura dos pedidos do WhatsApp (evita consultar a uazapi a cada abertura da página).
alter table public.whatsapp_instance
  add column if not exists join_requests_synced_at timestamptz;
