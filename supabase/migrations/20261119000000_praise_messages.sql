-- =============================================================================
-- Mensagens de elogio/agradecimento (busca por palavra-chave)
-- =============================================================================
-- Acha mensagens com "agradecer", "muito obrigado", "obrigado", "sensacional",
-- "perfeito", "ótimo" (e variações: obrigada, agradeço, perfeita, otimo…).
-- Também entram as mensagens já classificadas como elogio.
--
-- 1. is_praise: campo calculado usado pelo filtro "Elogios" em Mensagens
--    (messages?is_praise=eq.true).
-- 2. praise_messages(...): a mesma regra com filtros, para consultas no SQL.
--
-- Exemplos:
--   select id from public.praise_messages();                                   -- todas
--   select id from public.praise_messages(p_inicio => now() - interval '30 days');
--   select id from public.praise_messages(p_group => '120363408529284352@g.us');
--   select id from public.praise_messages(p_keywords => array['valeu', 'top']);

-- Palavras-chave padrão (palavra inteira, sem diferenciar maiúsculas).
create or replace function public.praise_pattern()
returns text
language sql
immutable
set search_path = ''
as $$
  select '\m(agrade[cç]\w*|muit[oa] obrigad[oa]s?|obrigad[oa]s?|obg|sensaciona(l|is)|perfeit[oa]s?|[oó]tim[oa]s?)\M';
$$;

create or replace function public.is_praise(m public.messages)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(m.body ~* public.praise_pattern(), false) or coalesce(m.topic = 'elogio', false);
$$;

grant execute on function public.praise_pattern() to authenticated, service_role;
grant execute on function public.is_praise(public.messages) to authenticated, service_role;

create or replace function public.praise_messages(
  p_inicio timestamptz default null,
  p_fim timestamptz default null,
  p_group text default null,
  p_contact uuid default null,
  -- true: só mensagens de membros/parceiros (sem equipe nem o número do painel).
  p_only_members boolean default true,
  -- Também as mensagens com subcategoria "elogio" (mesmo sem palavra-chave).
  p_include_category boolean default true,
  -- Lista própria de palavras (substitui a padrão). Casa palavra inteira, sem
  -- diferenciar maiúsculas; aceita regex (ex.: 'valeu+').
  p_keywords text[] default null,
  p_limit integer default 5000
)
returns table (
  id uuid,
  sent_at timestamptz,
  group_jid text,
  contact_id uuid,
  sender_name text,
  body text,
  ticket_id uuid
)
language sql
stable
set search_path = ''
as $$
  with pattern as (
    select case when p_keywords is null then public.praise_pattern()
                else '\m(' || array_to_string(p_keywords, '|') || ')\M' end as re
  )
  select m.id, m.sent_at, m.group_jid, m.contact_id, m.sender_name, m.body, m.ticket_id
  from public.messages m
  left join public.contacts c on c.id = m.contact_id
  cross join pattern
  where not m.is_note
    and m.deleted_at is null
    and (p_inicio is null or m.sent_at >= p_inicio)
    and (p_fim is null or m.sent_at < p_fim)
    and (p_group is null or m.group_jid = p_group)
    and (p_contact is null or m.contact_id = p_contact)
    and (not p_only_members or (not m.from_me and m.author_id is null and coalesce(c.kind::text, '') <> 'team'))
    and (
      m.body ~* pattern.re
      or (p_include_category and m.topic = 'elogio')
    )
  order by m.sent_at desc
  limit greatest(coalesce(p_limit, 5000), 1);
$$;

revoke all on function public.praise_messages(timestamptz, timestamptz, text, uuid, boolean, boolean, text[], integer) from public, anon, authenticated;
grant execute on function public.praise_messages(timestamptz, timestamptz, text, uuid, boolean, boolean, text[], integer) to service_role;
