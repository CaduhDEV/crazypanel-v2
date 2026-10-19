-- =============================================================================
-- Métricas: série diária, hoje por hora, fila ao vivo e rankings (página e telão)
-- =============================================================================

-- Fatos de cada thread do período: quem respondeu e quem resolveu.
create or replace function public.report_thread_facts(p_inicio timestamptz, p_fim timestamptz, p_teste boolean, p_group text default null)
returns table (
  id uuid, group_jid text, contact_id uuid, opened_at timestamptz, first_response_at timestamptz,
  status text, assignee_id uuid, close_reason text, category text, topic text,
  primeira_resp timestamptz, primeira_com timestamptz, quem_resolveu text
)
language sql
stable
set search_path = ''
as $$
  with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste, p_group)),
  agg as (
    select r.ticket_id,
      bool_or(r.quem <> 'equipe') as com,
      bool_or(r.quem = 'equipe') as eq,
      min(r.sent_at) filter (where r.quem <> 'equipe') as primeira_com,
      min(r.sent_at) as primeira_resp
    from public.report_replies(p_inicio, p_fim, p_teste, p_group) r
    group by r.ticket_id
  )
  select tk.id, tk.group_jid, tk.contact_id, tk.opened_at, tk.first_response_at,
    tk.status::text, tk.assignee_id, tk.close_reason, tk.category, tk.topic,
    least(a.primeira_resp, tk.first_response_at),
    a.primeira_com,
    case when tk.resolved_by is not null then tk.resolved_by
         when coalesce(a.com, false) and not (coalesce(a.eq, false) or tk.first_response_at is not null) then 'community'
         when not coalesce(a.com, false) and (coalesce(a.eq, false) or tk.first_response_at is not null) then 'team'
         when coalesce(a.com, false) then 'both' end
  from tk left join agg a on a.ticket_id = tk.id;
$$;

create or replace function public.community_report_live(p_inicio timestamptz, p_fim timestamptz, p_teste boolean default false)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with f as (select * from public.report_thread_facts(p_inicio, p_fim, p_teste)),
  sla as (select sla_seconds from public.app_settings where id = 1),
  tz as (select 'America/Sao_Paulo'::text as z)
  select jsonb_build_object(
    -- Por dia (horário de Brasília), com os dias sem movimento.
    'serie', (
      select coalesce(jsonb_agg(x order by x.dia), '[]'::jsonb) from (
        select d.dia::date as dia,
          count(f.id) as threads,
          count(f.id) filter (where f.quem_resolveu = 'community') as comunidade,
          count(f.id) filter (where f.quem_resolveu in ('team', 'both')) as equipe,
          count(f.id) filter (where f.primeira_resp is null) as sem_resposta,
          round((percentile_cont(0.5) within group (order by extract(epoch from f.first_response_at - f.opened_at) / 60.0))::numeric, 1) as mediana_tecnico_min
        from generate_series(
          date_trunc('day', p_inicio at time zone (select z from tz)),
          date_trunc('day', (p_fim - interval '1 second') at time zone (select z from tz)),
          interval '1 day'
        ) as d(dia)
        left join f on date_trunc('day', f.opened_at at time zone (select z from tz)) = d.dia
        group by d.dia
      ) x
    ),

    -- Hoje, hora a hora: threads abertas e mensagens de membros.
    'hoje', (
      select coalesce(jsonb_agg(x order by x.hora), '[]'::jsonb) from (
        select h.hora,
          (select count(*) from public.tickets t join public.report_groups(p_teste) g on g.jid = t.group_jid
            where t.close_reason is distinct from 'merged'
              and date_trunc('day', t.opened_at at time zone (select z from tz)) = date_trunc('day', now() at time zone (select z from tz))
              and extract(hour from t.opened_at at time zone (select z from tz)) = h.hora) as threads,
          (select count(*) from public.messages m join public.report_groups(p_teste) g on g.jid = m.group_jid
            left join public.contacts c on c.id = m.contact_id
            where not m.from_me and m.author_id is null and coalesce(c.kind::text, '') <> 'team'
              and date_trunc('day', m.sent_at at time zone (select z from tz)) = date_trunc('day', now() at time zone (select z from tz))
              and extract(hour from m.sent_at at time zone (select z from tz)) = h.hora) as mensagens
        from generate_series(0, 23) as h(hora)
      ) x
    ),

    -- Fila agora.
    'fila', (
      select jsonb_build_object(
        'abertas', count(*),
        'aguardando', count(*) filter (where t.waiting_since is not null),
        'sem_responsavel', count(*) filter (where t.assignee_id is null),
        'estouradas', count(*) filter (where t.waiting_since is not null and now() - t.waiting_since > make_interval(secs => (select sla_seconds from sla))),
        'espera_max_min', round((extract(epoch from now() - min(t.waiting_since)) / 60.0)::numeric, 1)
      )
      from public.tickets t join public.report_groups(p_teste) g on g.jid = t.group_jid
      where t.status = 'open'
    ),

    -- Top da comunidade: quem mais ajudou (threads de outras pessoas).
    'top_comunidade', (
      with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste)),
      r as (select * from public.report_replies(p_inicio, p_fim, p_teste)),
      resolutivas as (
        select r.message_id from r
        join tk on tk.id = r.ticket_id
        join public.message_reactions mr on mr.message_id = r.message_id and mr.contact_id = tk.contact_id
        union
        select tk.resolution_message_id from tk where tk.resolution_message_id is not null
      )
      select coalesce(jsonb_agg(x order by x.threads desc, x.respostas desc), '[]'::jsonb) from (
        select c.id, c.name as nome, c.avatar_url, co.name as empresa, c.kind::text as tipo,
          count(distinct r.ticket_id) as threads,
          count(*) as respostas,
          count(distinct r.ticket_id) filter (where r.message_id in (select message_id from resolutivas)) as resolvidas
        from r
        join public.contacts c on c.id = r.contact_id
        left join public.companies co on co.id = c.company_id
        where r.quem <> 'equipe'
        group by c.id, c.name, c.avatar_url, co.name, c.kind
        order by threads desc, respostas desc
        limit 5
      ) x
    ),

    -- Top da equipe: atendimentos no período, resolvidos e tempo de resposta.
    'top_equipe', (
      select coalesce(jsonb_agg(x order by x.assumidas desc, x.resolvidas desc), '[]'::jsonb) from (
        select pr.id, pr.name as nome, pr.avatar_url,
          count(f.id) as assumidas,
          count(f.id) filter (where f.close_reason = 'resolved') as resolvidas,
          count(f.id) filter (where f.first_response_at is not null) as respondidas,
          count(f.id) filter (where f.first_response_at - f.opened_at <= make_interval(secs => (select sla_seconds from sla))) as dentro_sla,
          round((percentile_cont(0.5) within group (order by extract(epoch from f.first_response_at - f.opened_at) / 60.0))::numeric, 1) as mediana_min
        from public.profiles pr
        left join f on f.assignee_id = pr.id
        where pr.active
        group by pr.id, pr.name, pr.avatar_url
        having count(f.id) > 0
        order by assumidas desc, resolvidas desc
        limit 5
      ) x
    ),

    -- Quem resolveu (para o gráfico de pizza).
    'resolucao', (
      select jsonb_build_object(
        'comunidade', count(*) filter (where quem_resolveu = 'community'),
        'equipe', count(*) filter (where quem_resolveu = 'team'),
        'ambos', count(*) filter (where quem_resolveu = 'both'),
        'sem_resposta', count(*) filter (where primeira_resp is null)
      ) from f
    ),

    -- Categorias e subcategorias das threads finalizadas.
    'categorias', (
      select coalesce(jsonb_agg(x order by x.threads desc), '[]'::jsonb) from (
        select f.category as categoria, f.topic as subcategoria, count(*) as threads
        from f where f.category is not null
        group by f.category, f.topic
      ) x
    )
  );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.report_thread_facts(timestamptz, timestamptz, boolean, text)',
    'public.community_report_live(timestamptz, timestamptz, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
