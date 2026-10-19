-- =============================================================================
-- Métricas das comunidades
-- =============================================================================
-- 1) Resposta de membro sem citação vira sugestão de contexto na dúvida que ela
--    provavelmente responde (o atendente decide).
-- 2) Fechamento diz quem resolveu (comunidade / equipe / ambos) e, se quiser,
--    qual mensagem resolveu.
-- 3) Categoria obrigatória em todo fechamento e subtema (assunto do produto).
-- 4) Relatório oficial em PDF, enviado pelo WhatsApp aos atendentes escolhidos.

-- -----------------------------------------------------------------------------
-- Fechamento
-- -----------------------------------------------------------------------------
alter table public.tickets
  add column if not exists resolved_by text check (resolved_by in ('community', 'team', 'both')),
  add column if not exists resolution_message_id uuid references public.messages (id) on delete set null,
  add column if not exists topic text check (topic in (
    'whatsapp', 'integracoes', 'automacoes', 'meta', 'funil', 'importacao',
    'usuarios', 'financeiro', 'relatorios', 'outro'
  ));

create index if not exists tickets_opened_idx on public.tickets (group_jid, opened_at desc);

-- -----------------------------------------------------------------------------
-- Sugestão de contexto: motivo
-- -----------------------------------------------------------------------------
alter table public.ticket_context_suggestions
  add column if not exists reason text not null default 'during_service'
    check (reason in ('during_service', 'member_reply'));

-- -----------------------------------------------------------------------------
-- Configurações
-- -----------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists member_reply_window_minutes integer not null default 10
    check (member_reply_window_minutes between 0 and 240),
  add column if not exists report_enabled boolean not null default false,
  add column if not exists report_weekday smallint not null default 1 check (report_weekday between 0 and 6),
  add column if not exists report_hour smallint not null default 9 check (report_hour between 0 and 23),
  add column if not exists report_period_days smallint not null default 7 check (report_period_days between 1 and 90),
  add column if not exists report_recipients uuid[] not null default '{}',
  add column if not exists report_last_sent_at timestamptz;

-- WhatsApp do atendente (só dígitos, com DDI): recebe o relatório.
alter table public.profiles
  add column if not exists whatsapp text check (whatsapp ~ '^[0-9]{10,15}$');

-- -----------------------------------------------------------------------------
-- Relatórios emitidos (numeração oficial e comprovante de envio)
-- -----------------------------------------------------------------------------
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  period_start timestamptz not null,
  period_end timestamptz not null,
  trigger text not null check (trigger in ('schedule', 'manual')),
  requested_by uuid references public.profiles (id) on delete set null,
  file_path text,
  checksum text,
  -- [{ profile_id, name, whatsapp, ok, error }]
  deliveries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reports_created_idx on public.reports (created_at desc);

alter table public.reports enable row level security;
drop policy if exists "reports: admins leem" on public.reports;
create policy "reports: admins leem"
  on public.reports for select to authenticated
  using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Roteamento: resposta de membro sem citação vira sugestão (passo 3b)
-- -----------------------------------------------------------------------------
create or replace function public.ingest_group_message(
  p_wa_id text,
  p_group_jid text,
  p_phone text,
  p_lid text,
  p_sender_name text,
  p_from_me boolean,
  p_kind public.message_kind,
  p_body text,
  p_has_media boolean,
  p_media_mime text,
  p_media_name text,
  p_media_duration integer,
  p_quoted_wa_id text,
  p_sent_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.messages;
  v_contact_id uuid;
  v_contact_kind public.contact_kind;
  v_is_team boolean;
  v_message_id uuid;
  v_ticket_id uuid;
  v_is_lead_message boolean := false;
  v_q_ticket public.tickets;
  v_reopen_hours integer;
  v_join_minutes integer;
  v_member_minutes integer;
  v_suggest_reason text := 'during_service';
  v_preview text := public.message_preview(p_kind, p_body);
  v_created boolean := false;
  v_reopened boolean := false;
  v_joined boolean := false;
  v_suggest_ticket uuid;
  v_suggested boolean := false;
begin
  select * into v_existing from public.messages where wa_id = p_wa_id;
  if found then
    return jsonb_build_object('message_id', v_existing.id, 'ticket_id', v_existing.ticket_id, 'duplicate', true);
  end if;

  if not p_from_me and (p_phone is not null or p_lid is not null) then
    v_contact_id := public.upsert_contact(p_phone, p_lid, p_sender_name);
    select kind into v_contact_kind from public.contacts where id = v_contact_id;

    insert into public.group_members (group_jid, contact_id)
    values (p_group_jid, v_contact_id)
    on conflict (group_jid, contact_id) do update set left_at = null;

    update public.contacts set
      message_count = message_count + 1,
      last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at)
    where id = v_contact_id;
  end if;

  v_is_team := p_from_me or v_contact_kind = 'team' or v_contact_id is null;

  insert into public.messages (
    wa_id, group_jid, contact_id, from_me, sender_name, kind, body,
    media_mime, media_name, media_duration, media_status, quoted_wa_id, status, sent_at
  ) values (
    p_wa_id, p_group_jid, v_contact_id, p_from_me, nullif(trim(p_sender_name), ''), p_kind, p_body,
    p_media_mime, p_media_name, p_media_duration,
    case when p_has_media then 'pending' end,
    p_quoted_wa_id,
    case when p_from_me then 'sent'::public.message_status end,
    p_sent_at
  )
  returning id into v_message_id;

  update public.wa_groups
  set last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at)
  where jid = p_group_jid;

  -- Serializa o roteamento por grupo: com participantes, mensagens de pessoas
  -- diferentes podem cair no mesmo atendimento.
  perform pg_advisory_xact_lock(hashtext('crazypanel:route:' || p_group_jid));

  if p_quoted_wa_id is not null then
    select t.* into v_q_ticket
    from public.messages m
    join public.tickets t on t.id = m.ticket_id
    where m.wa_id = p_quoted_wa_id
    limit 1;
  end if;

  if v_is_team then
    if v_q_ticket.id is not null and v_q_ticket.status = 'open' then
      v_ticket_id := v_q_ticket.id;
      update public.tickets set
        waiting_since = null,
        first_response_at = coalesce(first_response_at, p_sent_at)
      where id = v_ticket_id;
    end if;
  else
    select reopen_window_hours, join_window_minutes, member_reply_window_minutes
      into v_reopen_hours, v_join_minutes, v_member_minutes
    from public.app_settings where id = 1;

    -- 1. Citação.
    if v_q_ticket.id is not null and not exists (
      select 1 from public.ticket_participants p
      where p.ticket_id = v_q_ticket.id and p.contact_id = v_contact_id and p.removed_at is not null
    ) then
      if v_q_ticket.status = 'open' then
        v_ticket_id := v_q_ticket.id;
      elsif v_q_ticket.contact_id = v_contact_id
        and v_q_ticket.closed_at > now() - make_interval(hours => coalesce(v_reopen_hours, 24)) then
        update public.tickets set
          status = 'open', closed_at = null, closed_by = null,
          close_reason = null, close_note = null
        where id = v_q_ticket.id;
        insert into public.ticket_events (ticket_id, type, data)
        values (v_q_ticket.id, 'reopened', jsonb_build_object('message_id', v_message_id));
        v_ticket_id := v_q_ticket.id;
        v_reopened := true;
      end if;
    end if;

    -- 2. Participante ativo de um atendimento aberto no grupo.
    if v_ticket_id is null then
      select t.id into v_ticket_id
      from public.ticket_participants p
      join public.tickets t on t.id = p.ticket_id
      where p.contact_id = v_contact_id and p.removed_at is null
        and t.group_jid = p_group_jid and t.status = 'open'
      order by (t.contact_id = v_contact_id) desc, t.last_message_at desc
      limit 1;
    end if;

    -- 3. Atendimento em andamento no grupo: não entra sozinho; vira sugestão
    --    de contexto (o atendente decide). A mensagem segue para o passo 4.
    if v_ticket_id is null and coalesce(v_join_minutes, 30) > 0 then
      select t.id into v_suggest_ticket
      from public.tickets t
      where t.group_jid = p_group_jid and t.status = 'open'
        and t.assignee_id is not null and t.first_response_at is not null
        and t.last_message_at > p_sent_at - make_interval(mins => coalesce(v_join_minutes, 30))
        and not exists (
          select 1 from public.ticket_participants p
          where p.ticket_id = t.id and p.contact_id = v_contact_id and p.removed_at is not null
        )
        -- Já ignorado para este atendimento: não sugere de novo.
        and not exists (
          select 1 from public.ticket_context_suggestions s
          where s.ticket_id = t.id and s.contact_id = v_contact_id and s.status = 'dismissed'
        )
      order by t.last_message_at desc
      limit 1;
    end if;

    -- 3b. Resposta de membro sem citação: dúvida de outra pessoa no grupo, ainda
    --     sem equipe, com atividade há pouco. Também vira sugestão (o atendente
    --     decide se a mensagem é uma resposta àquela dúvida).
    if v_ticket_id is null and v_suggest_ticket is null and coalesce(v_member_minutes, 10) > 0 then
      select t.id into v_suggest_ticket
      from public.tickets t
      where t.group_jid = p_group_jid and t.status = 'open'
        and t.contact_id <> v_contact_id
        and t.last_message_at > p_sent_at - make_interval(mins => coalesce(v_member_minutes, 10))
        and not exists (
          select 1 from public.ticket_participants p
          where p.ticket_id = t.id and p.contact_id = v_contact_id and p.removed_at is not null
        )
        and not exists (
          select 1 from public.ticket_context_suggestions s
          where s.ticket_id = t.id and s.contact_id = v_contact_id and s.status = 'dismissed'
        )
      order by t.last_message_at desc
      limit 1;
      if v_suggest_ticket is not null then v_suggest_reason := 'member_reply'; end if;
    end if;

    -- 4. Atendimento novo.
    if v_ticket_id is null then
      insert into public.tickets (group_jid, contact_id, subject, opened_at, last_message_at)
      values (p_group_jid, v_contact_id, v_preview, p_sent_at, p_sent_at)
      returning id into v_ticket_id;
      insert into public.ticket_events (ticket_id, type, data)
      values (v_ticket_id, 'opened', jsonb_build_object('message_id', v_message_id));
      v_created := true;

      if v_suggest_ticket is not null then
        insert into public.ticket_context_suggestions (ticket_id, contact_id, message_id, source_ticket_id, reason)
        values (v_suggest_ticket, v_contact_id, v_message_id, v_ticket_id, v_suggest_reason)
        on conflict do nothing;
        v_suggested := true;
      end if;
    else
      insert into public.ticket_participants (ticket_id, contact_id, joined_at)
      values (v_ticket_id, v_contact_id, p_sent_at)
      on conflict do nothing;
      if found then
        v_joined := true;
        insert into public.ticket_events (ticket_id, type, data)
        values (v_ticket_id, 'participant_added', jsonb_build_object('contact_id', v_contact_id, 'message_id', v_message_id));
      end if;
    end if;

    v_is_lead_message := true;
  end if;

  if v_ticket_id is not null then
    update public.messages set ticket_id = v_ticket_id where id = v_message_id;
    update public.tickets set
      last_message_at = greatest(last_message_at, p_sent_at),
      last_message_preview = v_preview,
      message_count = message_count + 1,
      waiting_since = case when v_is_lead_message then coalesce(waiting_since, p_sent_at) else waiting_since end,
      last_customer_message_at = case when v_is_lead_message then p_sent_at else last_customer_message_at end
    where id = v_ticket_id;
  end if;

  return jsonb_build_object(
    'message_id', v_message_id,
    'ticket_id', v_ticket_id,
    'contact_id', v_contact_id,
    'ticket_created', v_created,
    'ticket_reopened', v_reopened,
    'participant_joined', v_joined,
    'context_suggested', v_suggested,
    'duplicate', false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Métricas (mesmas definições de docs/metricas/relatorio.md)
-- -----------------------------------------------------------------------------
-- Comunidade = grupo escutado que não é de parceiros (o de teste fica de fora,
-- salvo p_teste). Thread = atendimento aberto no período, sem os mesclados.

create or replace function public.report_groups(p_teste boolean)
returns setof public.wa_groups
language sql
stable
set search_path = ''
as $$
  select g.* from public.wa_groups g
  where g.listening and not g.is_partner_group and (p_teste or coalesce(g.name, '') not ilike '%teste%');
$$;

create or replace function public.report_threads(p_inicio timestamptz, p_fim timestamptz, p_teste boolean, p_group text default null)
returns setof public.tickets
language sql
stable
set search_path = ''
as $$
  select t.* from public.tickets t
  join public.report_groups(p_teste) g on g.jid = t.group_jid
  where (p_group is null or t.group_jid = p_group)
    and t.opened_at >= p_inicio and t.opened_at < p_fim
    and t.close_reason is distinct from 'merged';
$$;

-- Respostas: mensagens na thread de quem não é o autor da dúvida.
create or replace function public.report_replies(p_inicio timestamptz, p_fim timestamptz, p_teste boolean, p_group text default null)
returns table (message_id uuid, ticket_id uuid, sent_at timestamptz, contact_id uuid, author_id uuid, quem text)
language sql
stable
set search_path = ''
as $$
  select m.id, m.ticket_id, m.sent_at, m.contact_id, m.author_id,
    case when m.from_me or m.author_id is not null or c.kind = 'team' then 'equipe'
         when c.kind = 'partner' then 'parceiro' else 'membro' end
  from public.report_threads(p_inicio, p_fim, p_teste, p_group) t
  join public.messages m on m.ticket_id = t.id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from t.contact_id;
$$;

-- Indicadores do período (o relatório compara com o período anterior).
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
    'sem_resposta', count(*) filter (where primeira_resp is null),
    'sem_resposta_2h', count(*) filter (where coalesce(primeira_resp, least(now(), p_fim)) - opened_at > interval '2 hours'),
    'abertas_sem_resposta', count(*) filter (where status = 'open' and primeira_resp is null),
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

-- Relatório completo (painel /metricas e PDF).
create or replace function public.community_report(p_inicio timestamptz, p_fim timestamptz, p_teste boolean default false)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'inicio', p_inicio,
    'fim', p_fim,
    'gerado_em', now(),
    'resumo', public.community_report_summary(p_inicio, p_fim, p_teste),
    'anterior', public.community_report_summary(p_inicio - (p_fim - p_inicio), p_inicio, p_teste),

    'grupos', (
      select coalesce(jsonb_agg(x order by x.membros desc), '[]'::jsonb) from (
        select g.jid, g.name as nome,
          (select count(*) from public.group_members gm join public.contacts c on c.id = gm.contact_id
            where gm.group_jid = g.jid and gm.left_at is null and c.kind <> 'team') as membros,
          (select count(distinct m.contact_id) from public.messages m join public.contacts c on c.id = m.contact_id
            where m.group_jid = g.jid and c.kind <> 'team' and m.sent_at >= p_inicio and m.sent_at < p_fim) as ativos,
          public.community_report_summary(p_inicio, p_fim, p_teste, g.jid) as resumo
        from public.report_groups(p_teste) g
      ) x
    ),

    'ajudantes', (
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
        select c.name as nome, co.name as empresa, c.kind::text as tipo,
          count(distinct r.ticket_id) as threads,
          count(*) as respostas,
          count(distinct r.ticket_id) filter (where r.message_id in (select message_id from resolutivas)) as resolvidas
        from r
        join public.contacts c on c.id = r.contact_id
        left join public.companies co on co.id = c.company_id
        where r.quem <> 'equipe'
        group by c.id, c.name, co.name, c.kind
        order by threads desc, respostas desc
        limit 10
      ) x
    ),

    'concentracao', (
      with por as (
        select r.contact_id, count(*) as n, row_number() over (order by count(*) desc) as pos
        from public.report_replies(p_inicio, p_fim, p_teste) r
        where r.quem <> 'equipe' group by r.contact_id
      ), tot as (select coalesce(sum(n), 0) as total, count(*) as ajudantes from por)
      select jsonb_build_object(
        'ajudantes', tot.ajudantes,
        'respostas', tot.total,
        'pct_top5', round(100.0 * (select coalesce(sum(n), 0) from por where pos <= 5) / nullif(tot.total, 0), 1),
        'hhi', round((select sum((100.0 * n / tot.total) ^ 2) from por) )
      ) from tot
    ),

    'tecnicos', (
      with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste))
      select coalesce(jsonb_agg(x order by x.assumidas desc, x.mensagens desc), '[]'::jsonb) from (
        select pr.name as nome,
          (select count(*) from tk where tk.assignee_id = pr.id) as assumidas,
          (select count(*) from public.messages m join public.report_groups(p_teste) g on g.jid = m.group_jid
            where m.author_id = pr.id and not m.is_note and m.deleted_at is null and m.sent_at >= p_inicio and m.sent_at < p_fim) as mensagens,
          (select count(*) from tk where tk.closed_by = pr.id and tk.close_reason in ('resolved', 'parallel')) as fechadas,
          (select count(*) from tk where tk.closed_by = pr.id and tk.close_reason = 'resolved') as resolvidas,
          (select count(*) from public.tickets t join public.report_groups(p_teste) g on g.jid = t.group_jid
            where t.status = 'open' and t.assignee_id = pr.id) as abertas_agora,
          (select round((percentile_cont(0.5) within group (order by extract(epoch from tk.first_response_at - tk.opened_at) / 60.0))::numeric, 1)
            from tk where tk.assignee_id = pr.id and tk.first_response_at is not null) as mediana_min
        from public.profiles pr
        where pr.active
      ) x
    ),

    'empresas', (
      select coalesce(jsonb_agg(x order by x.threads desc), '[]'::jsonb) from (
        select co.name as nome, co.external_id as tenant,
          count(*) as threads,
          count(distinct t.contact_id) as pessoas,
          count(*) filter (where t.first_response_at is not null) as com_tecnico
        from public.report_threads(p_inicio, p_fim, p_teste) t
        join public.contacts c on c.id = t.contact_id
        join public.companies co on co.id = c.company_id
        where c.kind <> 'team'
        group by co.id, co.name, co.external_id
        order by threads desc
        limit 10
      ) x
    ),

    'temas', (
      select coalesce(jsonb_agg(x order by x.threads desc), '[]'::jsonb) from (
        select t.category as categoria, t.topic as subtema, count(*) as threads
        from public.report_threads(p_inicio, p_fim, p_teste) t
        where t.close_reason in ('resolved', 'parallel')
        group by t.category, t.topic
      ) x
    ),

    'picos', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(isodow from m.sent_at at time zone 'America/Sao_Paulo')::int as dia,
          extract(hour from m.sent_at at time zone 'America/Sao_Paulo')::int as hora,
          count(*) as mensagens
        from public.messages m
        join public.report_groups(p_teste) g on g.jid = m.group_jid
        left join public.contacts c on c.id = m.contact_id
        where not m.from_me and m.author_id is null and coalesce(c.kind::text, '') <> 'team'
          and m.sent_at >= p_inicio and m.sent_at < p_fim
        group by 1, 2
      ) x
    ),

    'movimento', (
      select jsonb_build_object(
        'entradas', count(*) filter (where e.type in ('joined_via_link', 'added_by_admin', 'invited_by_member')),
        'pelo_link', count(*) filter (where e.type = 'joined_via_link'),
        'adicionados', count(*) filter (where e.type = 'added_by_admin'),
        'convidados', count(*) filter (where e.type = 'invited_by_member'),
        'saidas', count(*) filter (where e.type in ('left', 'removed'))
      )
      from public.community_events e
      join public.report_groups(p_teste) g on g.jid = e.group_jid
      where e.created_at >= p_inicio and e.created_at < p_fim
    )
  );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.report_groups(boolean)',
    'public.report_threads(timestamptz, timestamptz, boolean, text)',
    'public.report_replies(timestamptz, timestamptz, boolean, text)',
    'public.community_report_summary(timestamptz, timestamptz, boolean, text)',
    'public.community_report(timestamptz, timestamptz, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
