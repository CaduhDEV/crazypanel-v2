-- =============================================================================
-- Off-topic fora das métricas de resposta
-- =============================================================================
-- Atendimento off-topic (subcategoria "offtopic" ou encerrado como "Assunto
-- paralelo") não pedia resposta: deixa de contar como "sem resposta" no resumo,
-- na série diária e em "quem resolveu". O resumo ganha o total "offtopic", e o
-- percentual de sem resposta passa a ser sobre os atendimentos que pediam resposta.
-- Mesmas funções de 20261021000000 e 20261021000200, só com esse filtro.

create or replace function public.community_report_summary(p_inicio timestamptz, p_fim timestamptz, p_teste boolean, p_group text default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste, p_group)),
  r as (select * from public.report_replies(p_inicio, p_fim, p_teste, p_group)),
  agg as (
    select r.ticket_id,
      bool_or(r.quem <> 'equipe') as com,
      bool_or(r.quem = 'equipe') as eq,
      min(r.sent_at) filter (where r.quem <> 'equipe') as primeira_com,
      min(r.sent_at) as primeira_resp
    from r group by r.ticket_id
  ),
  por as (
    select tk.*, coalesce(a.com, false) as com,
      coalesce(a.eq, false) or tk.first_response_at is not null as eq,
      a.primeira_com,
      least(a.primeira_resp, tk.first_response_at) as primeira_resp
    from tk left join agg a on a.ticket_id = tk.id
  ),
  cls as (
    select por.*,
      case when resolved_by is not null then resolved_by
           when com and not eq then 'community'
           when eq and not com then 'team'
           when com and eq then 'both' end as quem_resolveu
    from por
  ),
  abertura as (
    select tk.id, tk.contact_id, tk.opened_at, m.quoted_wa_id,
      lag(tk.opened_at) over w as anterior_em,
      lag(tk.contact_id) over w as anterior_de
    from tk
    left join public.ticket_events te on te.ticket_id = tk.id and te.type = 'opened'
    left join public.messages m on m.id = (te.data->>'message_id')::uuid
    window w as (partition by tk.group_jid order by tk.opened_at)
  ),
  sla as (select sla_seconds from public.app_settings where id = 1)
  select jsonb_build_object(
    'threads', count(*),
    'respondidas', count(*) filter (where quem_resolveu is not null),
    'comunidade', count(*) filter (where quem_resolveu = 'community'),
    'equipe', count(*) filter (where quem_resolveu = 'team'),
    'ambos', count(*) filter (where quem_resolveu = 'both'),
    'declaradas', count(*) filter (where resolved_by is not null),
    'sem_resposta', count(*) filter (where primeira_resp is null and not (coalesce(topic, '') = 'offtopic' or close_reason = 'parallel')),
    'sem_resposta_2h', count(*) filter (where coalesce(primeira_resp, least(now(), p_fim)) - opened_at > interval '2 hours' and not (coalesce(topic, '') = 'offtopic' or close_reason = 'parallel')),
    'abertas_sem_resposta', count(*) filter (where status = 'open' and primeira_resp is null and not (coalesce(topic, '') = 'offtopic' or close_reason = 'parallel')),
    -- Off-topic (subcategoria ou "Assunto paralelo"): não pedia resposta; fica fora das métricas de resposta.
    'offtopic', count(*) filter (where (coalesce(topic, '') = 'offtopic' or close_reason = 'parallel')),
    'com_tecnico', count(*) filter (where first_response_at is not null),
    'sla_min', (select sla_seconds / 60 from sla),
    'dentro_sla', count(*) filter (where first_response_at - opened_at <= make_interval(secs => (select sla_seconds from sla))),
    'mediana_membro_min', round((percentile_cont(0.5) within group (order by extract(epoch from primeira_com - opened_at) / 60.0))::numeric, 1),
    'mediana_tecnico_min', round((percentile_cont(0.5) within group (order by extract(epoch from first_response_at - opened_at) / 60.0))::numeric, 1),
    'p90_tecnico_min', round((percentile_cont(0.9) within group (order by extract(epoch from first_response_at - opened_at) / 60.0))::numeric, 1),
    'fechadas', count(*) filter (where status = 'closed'),
    'limpas', count(*) filter (where close_reason = 'sla_cleared'),
    'sem_categoria', count(*) filter (where close_reason in ('resolved', 'parallel') and category is null),
    'sem_empresa', count(*) filter (where (select c.company_id from public.contacts c where c.id = cls.contact_id) is null),
    'reabertas', (select count(distinct e.ticket_id) from public.ticket_events e join tk on tk.id = e.ticket_id where e.type = 'reopened'),
    'ruido', (select count(*) from abertura a
              where a.quoted_wa_id is null and a.anterior_de <> a.contact_id and a.opened_at - a.anterior_em <= interval '5 minutes')
  )
  from cls;
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
          count(f.id) filter (where f.primeira_resp is null and not (coalesce(f.topic, '') = 'offtopic' or f.close_reason = 'parallel')) as sem_resposta,
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
        'sem_resposta', count(*) filter (where primeira_resp is null and not (coalesce(topic, '') = 'offtopic' or close_reason = 'parallel'))
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
