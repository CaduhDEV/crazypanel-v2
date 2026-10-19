-- =============================================================================
-- Verificação de leads (formulário externo crazypanel-form)
-- =============================================================================
-- O e-mail é verificado pelo Supabase Auth deste projeto, com usuários do tipo
-- "lead" separados da equipe. A marca fica em raw_app_meta_data.kind, que só a
-- service role define (o cadastro público não consegue se marcar como lead).
-- Lead não passa pela regra de domínio e nunca ganha perfil de atendente: sem
-- perfil, o painel não abre para ele.

create or replace function public.is_lead_user(p_app_meta jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_app_meta ->> 'kind', '') = 'lead';
$$;

create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_lead_user(new.raw_app_meta_data) then
    return new;
  end if;
  if new.email is null or not exists (
    select 1
    from public.allowed_email_domains d
    where d.domain = lower(split_part(new.email, '@', 2))
  ) then
    raise exception 'E-mail fora do domínio permitido: %', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_lead_user(new.raw_app_meta_data) then
    return new;
  end if;
  insert into public.profiles (id, email, name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sessões de verificação do formulário (só o servidor acessa)
-- -----------------------------------------------------------------------------
create table if not exists public.lead_verifications (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null,          -- hash do token que o formulário guarda
  name text not null,
  email text not null,
  auth_user_id uuid references auth.users (id) on delete set null,
  email_sent_at timestamptz,
  email_sends integer not null default 0,
  email_attempts integer not null default 0,
  email_verified_at timestamptz,
  phone text,                         -- 55 + DDD + número
  phone_code_hash text,
  phone_code_expires_at timestamptz,
  phone_code_attempts integer not null default 0,
  phone_sends integer not null default 0,
  phone_last_sent_at timestamptz,
  phone_verified_at timestamptz,
  failed_attempts integer not null default 0,  -- erros somados (e-mail + telefone)
  locked_until timestamptz,
  status text not null default 'email_pending'
    check (status in ('email_pending', 'phone_pending', 'completed')),
  gleap_tenant_id text,
  gleap_sessions_updated integer not null default 0,
  crm_lead_id text,
  join_request_id uuid references public.join_requests (id) on delete set null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_verifications_email_idx on public.lead_verifications (lower(email), created_at desc);
create index if not exists lead_verifications_phone_idx on public.lead_verifications (phone, phone_last_sent_at desc);
create index if not exists lead_verifications_ip_idx on public.lead_verifications (ip, created_at desc);

drop trigger if exists lead_verifications_touch on public.lead_verifications;
create trigger lead_verifications_touch
  before update on public.lead_verifications
  for each row execute function public.touch_updated_at();

alter table public.lead_verifications enable row level security;
-- Sem policies: só a service role (rotas /api/verify do painel).

-- Solicitações vindas do formulário verificado.
alter table public.join_requests
  add column if not exists email_verified boolean not null default false,
  add column if not exists phone_verified boolean not null default false,
  add column if not exists verification_id uuid references public.lead_verifications (id) on delete set null;

revoke all on function public.is_lead_user(jsonb) from public, anon, authenticated;
