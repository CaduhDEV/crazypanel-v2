-- =============================================================================
-- Autenticação: domínio permitido, perfis e papéis
-- =============================================================================
-- Não há cadastro aberto: o admin convida o atendente pelo painel e o Supabase
-- envia o e-mail de convite. O perfil nasce pelo trigger em auth.users.

-- Domínios de e-mail autorizados. Para liberar outro:
--   insert into public.allowed_email_domains (domain) values ('outrodominio.com');
create table if not exists public.allowed_email_domains (
  domain text primary key check (domain = lower(domain))
);

insert into public.allowed_email_domains (domain)
values ('datacrazy.io')
on conflict do nothing;

alter table public.allowed_email_domains enable row level security;
-- Sem policies: só service_role e funções security definer acessam.

-- Bloqueia no banco qualquer usuário fora dos domínios permitidos (a validação
-- do formulário é só UX; esta é a garantia real).
create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

drop trigger if exists enforce_allowed_email_domain on auth.users;
create trigger enforce_allowed_email_domain
  before insert or update of email on auth.users
  for each row execute function public.enforce_allowed_email_domain();

-- -----------------------------------------------------------------------------
-- Perfis
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'attendant');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  avatar_url text,
  role public.app_role not null default 'attendant',
  active boolean not null default true,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_active_idx on public.profiles (active, name);

-- updated_at automático (reutilizado pelas demais tabelas).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Cria o perfil no convite/cadastro. O nome vem de options.data.name; o papel
-- começa como atendente e é ajustado pelo admin (via service role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Helpers de autorização usados pelas policies de RLS
-- -----------------------------------------------------------------------------
-- security definer: leem profiles sem depender da própria RLS de profiles.
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  );
$$;

revoke all on function public.is_active_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- RLS de profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles: membros ativos leem" on public.profiles;
create policy "profiles: membros ativos leem"
  on public.profiles for select
  to authenticated
  using ((select public.is_active_member()));

-- O próprio usuário só edita nome e foto (privilégio por coluna). Papel e
-- status ativo mudam apenas pelo admin, via service role.
revoke update on public.profiles from authenticated;
grant update (name, avatar_url) on public.profiles to authenticated;

drop policy if exists "profiles: edita o próprio" on public.profiles;
create policy "profiles: edita o próprio"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
