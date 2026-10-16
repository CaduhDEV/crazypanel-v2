-- =============================================================================
-- WhatsApp (uazapi), configurações, grupos, empresas e leads
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Instância da uazapi (linha única). Guarda segredos: SEM policies de leitura.
-- Só o servidor (service role) lê e escreve.
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_instance (
  id smallint primary key default 1 check (id = 1),
  base_url text,
  -- Token da instância criptografado com AES-256-GCM (APP_ENCRYPTION_KEY).
  token_encrypted text,
  -- Últimos 4 caracteres, para o admin reconhecer qual token está salvo.
  token_hint text,
  -- Segredo que a uazapi manda na URL do webhook (?secret=...).
  webhook_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  webhook_url text,
  webhook_configured_at timestamptz,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'connected', 'hibernated')),
  phone text,
  profile_name text,
  profile_pic_url text,
  last_disconnect_reason text,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_instance (id) values (1) on conflict (id) do nothing;
alter table public.whatsapp_instance enable row level security;

drop trigger if exists whatsapp_instance_touch on public.whatsapp_instance;
create trigger whatsapp_instance_touch
  before update on public.whatsapp_instance
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Configurações do atendimento (linha única)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  sla_seconds integer not null default 300 check (sla_seconds between 60 and 86400),
  sla_warning_percent integer not null default 75 check (sla_warning_percent between 10 and 95),
  -- Assina as respostas com "*Nome:*" antes do texto.
  sign_messages boolean not null default true,
  -- Tempo de "digitando..." antes de cada envio.
  typing_delay_ms integer not null default 1200 check (typing_delay_ms between 0 and 10000),
  -- Lead que responde um atendimento finalizado há menos que isso o reabre.
  reopen_window_hours integer not null default 24 check (reopen_window_hours between 0 and 720),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;

drop policy if exists "app_settings: membros leem" on public.app_settings;
create policy "app_settings: membros leem"
  on public.app_settings for select to authenticated
  using ((select public.is_active_member()));

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Caixa de entrada do webhook: o evento é gravado antes de qualquer
-- processamento, para reprocessar e diagnosticar falhas. O token da instância
-- é removido do payload antes de gravar.
-- -----------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  error text
);

create index if not exists webhook_events_received_idx on public.webhook_events (received_at desc);
create index if not exists webhook_events_pending_idx
  on public.webhook_events (received_at) where processed_at is null;

alter table public.webhook_events enable row level security;

-- -----------------------------------------------------------------------------
-- Grupos do WhatsApp. Grupo novo entra desligado; o admin escolhe quais escutar.
-- -----------------------------------------------------------------------------
create table if not exists public.wa_groups (
  jid text primary key check (jid like '%@g.us'),
  name text,
  description text,
  picture_url text,
  member_count integer,
  is_announce boolean not null default false,
  is_community boolean not null default false,
  listening boolean not null default false,
  last_message_at timestamptz,
  synced_at timestamptz,
  members_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wa_groups_listening_idx on public.wa_groups (listening, name);

alter table public.wa_groups enable row level security;
drop policy if exists "wa_groups: membros leem" on public.wa_groups;
create policy "wa_groups: membros leem"
  on public.wa_groups for select to authenticated
  using ((select public.is_active_member()));

drop trigger if exists wa_groups_touch on public.wa_groups;
create trigger wa_groups_touch
  before update on public.wa_groups
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Empresas (contas do CRM). Várias pessoas podem pertencer à mesma empresa.
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  -- Identificador da conta no CRM DataCrazy.
  external_id text unique,
  email text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companies_name_idx on public.companies (lower(name));

alter table public.companies enable row level security;
drop policy if exists "companies: membros leem" on public.companies;
create policy "companies: membros leem"
  on public.companies for select to authenticated
  using ((select public.is_active_member()));

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch
  before update on public.companies
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Contatos (leads). Uma linha por pessoa: o WhatsApp entrega às vezes o
-- telefone, às vezes o @lid; os dois ficam na mesma linha (upsert_contact une).
--   customer = cliente (precisa de empresa vinculada)
--   partner  = parceiro (isento de vínculo)
--   team     = equipe DataCrazy (mensagens contam como resposta, não abrem atendimento)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'contact_kind') then
    create type public.contact_kind as enum ('customer', 'partner', 'team');
  end if;
end $$;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone ~ '^[0-9]{6,20}$'),
  lid text unique check (lid ~ '^[0-9]{6,30}$'),
  name text,
  avatar_url text,
  kind public.contact_kind not null default 'customer',
  company_id uuid references public.companies (id) on delete set null,
  strikes integer not null default 0 check (strikes >= 0),
  notes text,
  message_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_message_at timestamptz,
  linked_at timestamptz,
  linked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_identity check (phone is not null or lid is not null)
);

create index if not exists contacts_company_idx on public.contacts (company_id);
create index if not exists contacts_last_message_idx on public.contacts (last_message_at desc nulls last);
create index if not exists contacts_unlinked_idx on public.contacts (last_message_at desc nulls last)
  where kind = 'customer' and company_id is null;
create index if not exists contacts_name_idx on public.contacts (lower(name));

alter table public.contacts enable row level security;
drop policy if exists "contacts: membros leem" on public.contacts;
create policy "contacts: membros leem"
  on public.contacts for select to authenticated
  using ((select public.is_active_member()));

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch
  before update on public.contacts
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Participação nos grupos (inclui quem nunca mandou mensagem).
-- -----------------------------------------------------------------------------
create table if not exists public.group_members (
  group_jid text not null references public.wa_groups (jid) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_jid, contact_id)
);

create index if not exists group_members_contact_idx on public.group_members (contact_id);

alter table public.group_members enable row level security;
drop policy if exists "group_members: membros leem" on public.group_members;
create policy "group_members: membros leem"
  on public.group_members for select to authenticated
  using ((select public.is_active_member()));
