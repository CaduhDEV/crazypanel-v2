-- =============================================================================
-- Empresas do lead também pelo e-mail
-- =============================================================================
-- Muitos cadastros do Gleap não têm telefone, só e-mail (ex.: alguém que acessa
-- várias contas com o mesmo e-mail). As empresas possíveis do lead passam a
-- vir dos usuários do Gleap com o mesmo telefone OU com o mesmo e-mail — o do
-- lead e os e-mails dos cadastros que batem pelo telefone.

create index if not exists gleap_leads_email_idx on public.gleap_leads (lower(email)) where email is not null;

create or replace view public.contact_company_options
with (security_invoker = true)
as
with emails as (
  -- E-mails conhecidos de cada lead: o próprio e os do Gleap pelo telefone.
  select c.id as contact_id, lower(c.email) as email
  from public.contacts c
  where c.email is not null
  union
  select c.id, lower(g.email)
  from public.contacts c
  join public.gleap_leads g on g.phone_key = c.phone_key
  where c.phone_key is not null and g.email is not null
),
matches as (
  select c.id as contact_id, g.*
  from public.contacts c
  join public.gleap_leads g on g.phone_key = c.phone_key
  where c.phone_key is not null
  union
  select e.contact_id, g.*
  from emails e
  join public.gleap_leads g on lower(g.email) = e.email
),
gleap as (
  select
    m.contact_id,
    m.company_tenant_id as tenant_id,
    (array_agg(m.company_name order by m.last_activity_at desc nulls last) filter (where m.company_name is not null))[1] as gleap_name,
    count(*)::integer as users_count,
    max(m.last_activity_at) as last_activity_at
  from matches m
  where m.company_tenant_id is not null
  group by m.contact_id, m.company_tenant_id
),
options as (
  select gl.contact_id, gl.tenant_id, co.id as company_id, coalesce(co.name, gl.gleap_name, gl.tenant_id) as name,
         co.cnpj, gl.users_count, gl.last_activity_at
  from gleap gl
  left join public.companies co on co.external_id = gl.tenant_id
  union all
  select c.id, co.external_id, co.id, co.name, co.cnpj, 0, null::timestamptz
  from public.contacts c
  join public.companies co on co.id = c.company_id
  where not exists (select 1 from gleap gl where gl.contact_id = c.id and gl.tenant_id = co.external_id)
)
select o.contact_id, o.tenant_id, o.company_id, o.name, o.cnpj, o.users_count, o.last_activity_at,
       (o.company_id is not null and o.company_id = c.company_id) as is_primary
from options o
join public.contacts c on c.id = o.contact_id;

-- Recalcula "N empresas" com a regra nova.
select public.refresh_contact_companies_count();
