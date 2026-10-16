-- =============================================================================
-- Leads em mais de uma empresa
-- =============================================================================
-- O mesmo telefone pode aparecer em vários tenants no Gleap (consultor que
-- atende clientes, quem mudou de empresa…). A empresa principal continua sendo
-- contacts.company_id; aqui ficam as demais opções e a contagem para marcar.

-- Empresas possíveis de cada lead: tenants do Gleap com o mesmo telefone, mais
-- a empresa vinculada (mesmo que não venha do Gleap).
create or replace view public.contact_company_options
with (security_invoker = true)
as
with gleap as (
  select
    c.id as contact_id,
    g.company_tenant_id as tenant_id,
    (array_agg(g.company_name order by g.last_activity_at desc nulls last) filter (where g.company_name is not null))[1] as gleap_name,
    count(*)::integer as users_count,
    max(g.last_activity_at) as last_activity_at
  from public.contacts c
  join public.gleap_leads g on g.phone_key = c.phone_key and g.company_tenant_id is not null
  where c.phone_key is not null
  group by c.id, g.company_tenant_id
),
options as (
  -- Tenants do Gleap com o mesmo telefone (cadastrados aqui ou não).
  select gl.contact_id, gl.tenant_id, co.id as company_id, coalesce(co.name, gl.gleap_name, gl.tenant_id) as name,
         co.cnpj, gl.users_count, gl.last_activity_at
  from gleap gl
  left join public.companies co on co.external_id = gl.tenant_id
  union all
  -- A empresa vinculada, quando não está entre os tenants acima (vínculo manual).
  select c.id, co.external_id, co.id, co.name, co.cnpj, 0, null::timestamptz
  from public.contacts c
  join public.companies co on co.id = c.company_id
  where not exists (select 1 from gleap gl where gl.contact_id = c.id and gl.tenant_id = co.external_id)
)
select o.contact_id, o.tenant_id, o.company_id, o.name, o.cnpj, o.users_count, o.last_activity_at,
       (o.company_id is not null and o.company_id = c.company_id) as is_primary
from options o
join public.contacts c on c.id = o.contact_id;

-- Quantas empresas cada lead tem (para a etiqueta e o filtro em Leads).
alter table public.contacts
  add column if not exists companies_count integer not null default 0;

create index if not exists contacts_multi_company_idx on public.contacts (companies_count) where companies_count > 1;

-- Recalcula a contagem. Com p_contact_id, só daquele lead (troca de empresa);
-- sem, de todos (depois de importar o Gleap).
create or replace function public.refresh_contact_companies_count(p_contact_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with counts as (
    select contact_id, count(distinct coalesce(tenant_id, company_id::text))::integer as n
    from public.contact_company_options
    where p_contact_id is null or contact_id = p_contact_id
    group by contact_id
  )
  update public.contacts c set companies_count = coalesce(k.n, 0)
  from (
    select c2.id, counts.n
    from public.contacts c2
    left join counts on counts.contact_id = c2.id
    where p_contact_id is null or c2.id = p_contact_id
  ) k
  where c.id = k.id and c.companies_count is distinct from coalesce(k.n, 0);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_contact_companies_count(uuid) from public, anon, authenticated;
grant execute on function public.refresh_contact_companies_count(uuid) to service_role;

-- Estado inicial.
select public.refresh_contact_companies_count();
