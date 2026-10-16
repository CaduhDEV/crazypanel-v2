-- =============================================================================
-- Parceiros e equipe também podem ter empresa
-- =============================================================================
-- O tipo do lead (cliente, parceiro, equipe) define a regra do atendimento; a
-- empresa é a conta dele no CRM e vale para qualquer tipo. A vinculação
-- automática pelo Gleap passa a preencher a empresa de parceiros e da equipe
-- também (sem mudar o tipo).

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
  where c.company_id is null and c.phone_key is not null
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

