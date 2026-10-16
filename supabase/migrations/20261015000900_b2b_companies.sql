-- =============================================================================
-- Empresas (B2B): uma linha por tenant do CRM
-- =============================================================================
-- Junta o que o painel sabe de cada cliente: os usuários do Gleap com aquele
-- tenant (quem tem acesso à conta), a empresa cadastrada aqui (CNPJ, notas) e
-- os leads dos grupos vinculados a ela.

create index if not exists gleap_leads_tenant_activity_idx
  on public.gleap_leads (company_tenant_id, last_activity_at desc);

-- Ficha da empresa vinda do CRM (logo, nicho, plano…), quando houver acesso.
alter table public.companies
  add column if not exists image_url text,
  add column if not exists niche text,
  add column if not exists crm_profile jsonb,
  add column if not exists crm_synced_at timestamptz;

-- Membros: telefones (chave) que estão ativos em algum grupo.
create or replace view public.community_phone_keys
with (security_invoker = true)
as
select distinct c.phone_key
from public.contacts c
join public.group_members gm on gm.contact_id = c.id and gm.left_at is null
where c.phone_key is not null;

create or replace view public.b2b_companies
with (security_invoker = true)
as
with gleap as (
  select
    g.company_tenant_id as tenant_id,
    -- Nome mais recente informado pelo Gleap.
    (array_agg(g.company_name order by g.last_activity_at desc nulls last) filter (where g.company_name is not null))[1] as gleap_name,
    count(*) as users_count,
    count(*) filter (where g.phone_key is not null) as users_with_phone,
    count(distinct g.phone_key) filter (where k.phone_key is not null) as users_in_community,
    max(g.last_activity_at) as last_activity_at
  from public.gleap_leads g
  left join public.community_phone_keys k on k.phone_key = g.phone_key
  where g.company_tenant_id is not null
  group by g.company_tenant_id
),
linked as (
  select company_id, count(*) as leads_count
  from public.contacts
  where company_id is not null
  group by company_id
)
select
  coalesce(co.external_id, gl.tenant_id) as tenant_id,
  co.id as company_id,
  coalesce(co.name, gl.gleap_name, gl.tenant_id) as name,
  co.cnpj,
  co.image_url,
  co.niche,
  co.email,
  coalesce(gl.users_count, 0)::integer as users_count,
  coalesce(gl.users_with_phone, 0)::integer as users_with_phone,
  coalesce(gl.users_in_community, 0)::integer as users_in_community,
  coalesce(li.leads_count, 0)::integer as leads_count,
  gl.last_activity_at
from gleap gl
full join public.companies co on co.external_id = gl.tenant_id
left join linked li on li.company_id = co.id;
