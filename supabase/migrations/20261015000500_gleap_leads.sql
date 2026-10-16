-- =============================================================================
-- Leads do Gleap (usuários do CRM) e lista de quem convidar para as comunidades
-- =============================================================================
-- Importação completa pelo export CSV do Gleap e atualização diária das sessões
-- mais recentes. Quem tem telefone + empresa e não está em nenhum grupo vira
-- candidato a convite.

-- Chave de comparação de telefone BR: sem DDI 55 e sem o nono dígito do celular
-- (mesma regra de phoneKey em lib/gleap.ts).
create or replace function public.phone_key(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) >= 12 and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) = 11 and substr(d, 3, 1) = '9' then d := substr(d, 1, 2) || substr(d, 4); end if;
  if length(d) < 10 then return null; end if;
  return d;
end;
$$;

alter table public.contacts
  add column if not exists phone_key text generated always as (public.phone_key(phone)) stored;
create index if not exists contacts_phone_key_idx on public.contacts (phone_key) where phone_key is not null;

create table if not exists public.gleap_leads (
  -- userId do Gleap (id do usuário no CRM).
  user_id text primary key,
  name text,
  email text,
  phone text,
  phone_key text generated always as (public.phone_key(phone)) stored,
  company_tenant_id text,
  company_name text,
  last_activity_at timestamptz,
  gleap_created_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists gleap_leads_phone_key_idx on public.gleap_leads (phone_key) where phone_key is not null;
create index if not exists gleap_leads_tenant_idx on public.gleap_leads (company_tenant_id);

alter table public.gleap_leads enable row level security;
drop policy if exists "gleap_leads: admins leem" on public.gleap_leads;
create policy "gleap_leads: admins leem"
  on public.gleap_leads for select to authenticated
  using ((select public.is_admin()));

create table if not exists public.gleap_sync_state (
  id smallint primary key default 1 check (id = 1),
  last_full_import_at timestamptz,
  last_full_import_rows integer,
  last_recent_sync_at timestamptz,
  last_recent_sync_rows integer,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.gleap_sync_state (id) values (1) on conflict do nothing;

alter table public.gleap_sync_state enable row level security;
drop policy if exists "gleap_sync_state: admins leem" on public.gleap_sync_state;
create policy "gleap_sync_state: admins leem"
  on public.gleap_sync_state for select to authenticated
  using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Candidatos a convite: um por telefone (a sessão com atividade mais recente),
-- com telefone e empresa, e sem contato ativo em nenhum grupo.
-- -----------------------------------------------------------------------------
create or replace view public.gleap_invite_candidates
with (security_invoker = true)
as
select distinct on (g.phone_key)
  g.phone_key,
  g.user_id,
  g.name,
  g.email,
  g.phone,
  g.company_tenant_id,
  g.company_name,
  g.last_activity_at
from public.gleap_leads g
where g.phone_key is not null
  and g.company_tenant_id is not null
  and not exists (
    select 1
    from public.contacts c
    join public.group_members gm on gm.contact_id = c.id and gm.left_at is null
    where c.phone_key = g.phone_key
  )
order by g.phone_key, g.last_activity_at desc nulls last;

-- -----------------------------------------------------------------------------
-- Vincula os contatos dos grupos sem empresa cujo telefone leva a exatamente
-- um tenant no Gleap. Cria a empresa (external_id = tenant) se faltar e grava o
-- e-mail quando é único. Devolve quantos contatos foram vinculados.
-- -----------------------------------------------------------------------------
create or replace function public.link_contacts_from_gleap(p_actor_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  create temporary table _matches on commit drop as
  select c.id as contact_id,
         min(g.company_tenant_id) as tenant_id,
         min(g.company_name) filter (where g.company_name is not null) as company_name,
         case when count(distinct lower(g.email)) = 1 then min(lower(g.email)) end as email,
         min(g.name) filter (where g.name is not null) as name
  from public.contacts c
  join public.gleap_leads g on g.phone_key = c.phone_key and g.company_tenant_id is not null
  where c.kind = 'customer' and c.company_id is null and c.phone_key is not null
  group by c.id
  having count(distinct g.company_tenant_id) = 1;

  insert into public.companies (name, external_id, created_by)
  select distinct on (m.tenant_id) coalesce(m.company_name, m.tenant_id), m.tenant_id, p_actor_id
  from _matches m
  order by m.tenant_id
  on conflict (external_id) do nothing;

  update public.contacts c set
    company_id = co.id,
    email = coalesce(c.email, m.email),
    name = coalesce(c.name, m.name),
    gleap_status = 'linked',
    gleap_checked_at = now(),
    linked_at = now(),
    linked_by = p_actor_id
  from _matches m
  join public.companies co on co.external_id = m.tenant_id
  where c.id = m.contact_id and c.company_id is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.link_contacts_from_gleap(uuid) from public, anon, authenticated;
grant execute on function public.link_contacts_from_gleap(uuid) to service_role;
