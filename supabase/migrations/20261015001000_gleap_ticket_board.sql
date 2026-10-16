-- =============================================================================
-- Board (tipo) e link de cada chamado ativo do Gleap
-- =============================================================================
-- No Gleap o tipo do ticket é o board onde ele está (Roadmap, Bug Report,
-- Inquiries, Financeiro…). A sincronização grava o nome do board e o link para
-- abrir o ticket no painel do Gleap.

alter table public.gleap_tickets
  add column if not exists board_name text,
  add column if not exists url text;

-- A view ganha as colunas novas (mesma definição de 20261015000700).
drop view if exists public.contact_gleap_tickets;
create view public.contact_gleap_tickets as
select distinct on (c.id, t.id)
  c.id as contact_id,
  t.id as gleap_ticket_id,
  t.bug_id,
  t.type,
  t.board_name,
  t.url,
  t.status,
  t.title,
  t.assignee_name,
  t.has_agent_reply,
  t.gleap_created_at,
  t.gleap_updated_at,
  t.synced_at
from public.gleap_tickets t
left join public.gleap_leads g on g.user_id = t.session_user_id
join public.contacts c
  on (g.phone_key is not null and c.phone_key = g.phone_key)
  or (t.session_email is not null and lower(c.email) = lower(t.session_email))
where (select public.is_active_member());

revoke all on public.contact_gleap_tickets from public, anon;
grant select on public.contact_gleap_tickets to authenticated;
