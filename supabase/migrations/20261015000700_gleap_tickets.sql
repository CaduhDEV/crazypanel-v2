-- =============================================================================
-- Chamados ativos do Gleap (conflito de canais)
-- =============================================================================
-- Cópia local dos tickets OPEN/INPROGRESS do Gleap, renovada pela rotina (a cada
-- poucos minutos) e sob demanda. A tela lê só daqui: nenhuma chamada ao Gleap
-- no caminho da requisição. Um lead com atendimento no WhatsApp e chamado ativo
-- no Gleap aparece com aviso de conflito.

create table if not exists public.gleap_tickets (
  id text primary key,
  bug_id bigint,
  type text not null,
  status text not null,
  title text,
  session_user_id text,
  session_email text,
  assignee_name text,
  assignee_email text,
  has_agent_reply boolean not null default false,
  gleap_created_at timestamptz,
  gleap_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists gleap_tickets_user_idx on public.gleap_tickets (session_user_id);
create index if not exists gleap_tickets_email_idx on public.gleap_tickets (lower(session_email));

alter table public.gleap_tickets enable row level security;
-- Sem policies: lido pela view abaixo, gravado só pelo servidor.

alter table public.gleap_sync_state
  add column if not exists last_tickets_sync_at timestamptz,
  add column if not exists last_tickets_sync_rows integer;

-- -----------------------------------------------------------------------------
-- Chamados ativos por contato: pelo usuário do Gleap (telefone) ou pelo e-mail.
-- Roda com os privilégios do dono (lê gleap_leads, restrita a admins) mas só
-- devolve linhas para membros ativos e só os campos do aviso.
-- -----------------------------------------------------------------------------
create or replace view public.contact_gleap_tickets as
select distinct on (c.id, t.id)
  c.id as contact_id,
  t.id as gleap_ticket_id,
  t.bug_id,
  t.type,
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
