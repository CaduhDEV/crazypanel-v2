-- =============================================================================
-- Números de atendente, exceção de flag, métricas por grupo e perfil do lead
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Números de cada atendente: toda mensagem desses números conta para ele
-- -----------------------------------------------------------------------------
create table if not exists public.profile_phones (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  phone_key text generated always as (public.phone_key(phone)) stored unique,
  created_at timestamptz not null default now()
);
create index if not exists profile_phones_profile_idx on public.profile_phones (profile_id);

alter table public.profile_phones enable row level security;
drop policy if exists "profile_phones: admins leem" on public.profile_phones;
create policy "profile_phones: admins leem" on public.profile_phones for select to authenticated using ((select public.is_admin()));

alter table public.contacts
  add column if not exists attendant_id uuid references public.profiles (id) on delete set null,
  -- Divulgador autorizado: não recebe flag (nem da IA, nem da equipe).
  add column if not exists flag_exempt boolean not null default false,
  add column if not exists flag_exempt_note text check (length(flag_exempt_note) <= 300),
  add column if not exists flag_exempt_at timestamptz,
  add column if not exists flag_exempt_by uuid references public.profiles (id) on delete set null;
create index if not exists contacts_attendant_idx on public.contacts (attendant_id) where attendant_id is not null;
create index if not exists contacts_flag_exempt_idx on public.contacts (flag_exempt) where flag_exempt;

-- Contato novo (ou que ganhou telefone) com número de atendente; vínculo vira equipe.
create or replace function public.contacts_attendant_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone is not null and new.attendant_id is null and (tg_op = 'INSERT' or new.phone is distinct from old.phone) then
    select pp.profile_id into new.attendant_id from public.profile_phones pp where pp.phone_key = public.phone_key(new.phone);
  end if;
  if new.attendant_id is not null then new.kind := 'team'; end if;
  return new;
end;
$$;
drop trigger if exists contacts_attendant_link on public.contacts;
create trigger contacts_attendant_link before insert or update of phone, attendant_id on public.contacts
  for each row execute function public.contacts_attendant_link();

-- Vínculo mudou: as mensagens já recebidas desse contato acompanham.
create or replace function public.contacts_attendant_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages set author_id = new.attendant_id
  where contact_id = new.id and not from_me and not is_note;
  return null;
end;
$$;
drop trigger if exists contacts_attendant_messages on public.contacts;
create trigger contacts_attendant_messages after update of attendant_id on public.contacts
  for each row when (old.attendant_id is distinct from new.attendant_id)
  execute function public.contacts_attendant_messages();

-- Mensagem nova de um número vinculado já nasce com o atendente.
create or replace function public.messages_attendant_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_id is null and new.contact_id is not null and not new.from_me then
    select c.attendant_id into new.author_id from public.contacts c where c.id = new.contact_id;
  end if;
  return new;
end;
$$;
drop trigger if exists messages_attendant_author on public.messages;
create trigger messages_attendant_author before insert on public.messages
  for each row execute function public.messages_attendant_author();

-- Número cadastrado ou removido: atualiza os contatos com esse telefone.
create or replace function public.profile_phones_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.contacts set attendant_id = null where phone_key = old.phone_key and attendant_id = old.profile_id;
    return null;
  end if;
  update public.contacts set attendant_id = new.profile_id where phone_key = new.phone_key;
  return null;
end;
$$;
drop trigger if exists profile_phones_sync on public.profile_phones;
create trigger profile_phones_sync after insert or delete on public.profile_phones
  for each row execute function public.profile_phones_sync();

-- -----------------------------------------------------------------------------
-- Métricas por grupo
-- -----------------------------------------------------------------------------
create or replace function public.report_groups(p_teste boolean, p_group text)
returns setof public.wa_groups
language sql
stable
set search_path = ''
as $$
  select g.* from public.report_groups(p_teste) g where p_group is null or g.jid = p_group;
$$;

drop function if exists public.community_report(timestamptz, timestamptz, boolean);
drop function if exists public.community_report_live(timestamptz, timestamptz, boolean);

create or replace function public.community_report(p_inicio timestamptz, p_fim timestamptz, p_teste boolean default false, p_group text default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'inicio', p_inicio,
    'fim', p_fim,
    'gerado_em', now(),
    'resumo', public.community_report_summary(p_inicio, p_fim, p_teste, p_group),
    'anterior', public.community_report_summary(p_inicio - (p_fim - p_inicio), p_inicio, p_teste, p_group),

    'grupos', (
      select coalesce(jsonb_agg(x order by x.membros desc), '[]'::jsonb) from (
        select g.jid, g.name as nome,
          (select count(*) from public.group_members gm join public.contacts c on c.id = gm.contact_id
            where gm.group_jid = g.jid and gm.left_at is null and c.kind <> 'team') as membros,
          (select count(distinct m.contact_id) from public.messages m join public.contacts c on c.id = m.contact_id
            where m.group_jid = g.jid and c.kind <> 'team' and m.sent_at >= p_inicio and m.sent_at < p_fim) as ativos,
          public.community_report_summary(p_inicio, p_fim, p_teste, g.jid) as resumo
        from public.report_groups(p_teste, p_group) g
      ) x
    ),

    'ajudantes', (
      with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste, p_group)),
      r as (select * from public.report_replies(p_inicio, p_fim, p_teste, p_group)),
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
        from public.report_replies(p_inicio, p_fim, p_teste, p_group) r
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
      with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste, p_group))
      select coalesce(jsonb_agg(x order by x.assumidas desc, x.mensagens desc), '[]'::jsonb) from (
        select pr.name as nome,
          (select count(*) from tk where tk.assignee_id = pr.id
            or exists (select 1 from public.messages m where m.ticket_id = tk.id and m.author_id = pr.id and not m.is_note and m.deleted_at is null)) as assumidas,
          (select count(*) from public.messages m join public.report_groups(p_teste, p_group) g on g.jid = m.group_jid
            where m.author_id = pr.id and not m.is_note and m.deleted_at is null and m.sent_at >= p_inicio and m.sent_at < p_fim) as mensagens,
          (select count(*) from tk where tk.closed_by = pr.id and tk.close_reason in ('resolved', 'parallel')) as fechadas,
          (select count(*) from tk where tk.closed_by = pr.id and tk.close_reason = 'resolved') as resolvidas,
          (select count(*) from public.tickets t join public.report_groups(p_teste, p_group) g on g.jid = t.group_jid
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
        from public.report_threads(p_inicio, p_fim, p_teste, p_group) t
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
        from public.report_threads(p_inicio, p_fim, p_teste, p_group) t
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
        join public.report_groups(p_teste, p_group) g on g.jid = m.group_jid
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
      join public.report_groups(p_teste, p_group) g on g.jid = e.group_jid
      where e.created_at >= p_inicio and e.created_at < p_fim
    )
  );
$$;

create or replace function public.community_report_live(p_inicio timestamptz, p_fim timestamptz, p_teste boolean default false, p_group text default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with f as (select * from public.report_thread_facts(p_inicio, p_fim, p_teste, p_group)),
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
          (select count(*) from public.tickets t join public.report_groups(p_teste, p_group) g on g.jid = t.group_jid
            where t.close_reason is distinct from 'merged'
              and date_trunc('day', t.opened_at at time zone (select z from tz)) = date_trunc('day', now() at time zone (select z from tz))
              and extract(hour from t.opened_at at time zone (select z from tz)) = h.hora) as threads,
          (select count(*) from public.messages m join public.report_groups(p_teste, p_group) g on g.jid = m.group_jid
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
      from public.tickets t join public.report_groups(p_teste, p_group) g on g.jid = t.group_jid
      where t.status = 'open'
    ),

    -- Top da comunidade: quem mais ajudou (threads de outras pessoas).
    'top_comunidade', (
      with tk as (select * from public.report_threads(p_inicio, p_fim, p_teste, p_group)),
      r as (select * from public.report_replies(p_inicio, p_fim, p_teste, p_group)),
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

    -- Ranking da comunidade por grupo (o de parceiros já fica de fora em report_groups).
    'ranking_grupos', (
      with r as (select * from public.report_replies(p_inicio, p_fim, p_teste, p_group)),
      tk as (select * from public.report_threads(p_inicio, p_fim, p_teste, p_group)),
      por as (
        select tk.group_jid, c.id, c.name as nome, c.avatar_url, co.name as empresa, c.kind::text as tipo,
          count(distinct r.ticket_id) as threads,
          count(*) as respostas,
          count(distinct r.ticket_id) filter (where r.message_id = tk.resolution_message_id) as resolvidas
        from r
        join tk on tk.id = r.ticket_id
        join public.contacts c on c.id = r.contact_id
        left join public.companies co on co.id = c.company_id
        where r.quem <> 'equipe'
        group by tk.group_jid, c.id, c.name, c.avatar_url, co.name, c.kind
      ),
      pos as (
        select por.*, row_number() over (partition by group_jid order by threads desc, respostas desc) as n from por
      )
      select coalesce(jsonb_agg(x order by x.nome), '[]'::jsonb) from (
        select g.jid, g.name as nome,
          (select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'avatar_url', p.avatar_url, 'empresa', p.empresa, 'tipo', p.tipo, 'threads', p.threads, 'respostas', p.respostas, 'resolvidas', p.resolvidas) order by p.n)
             from pos p where p.group_jid = g.jid and p.n <= 5) as top
        from public.report_groups(p_teste, p_group) g
        where exists (select 1 from pos p where p.group_jid = g.jid)
      ) x
    ),

    -- Top da equipe: atendimentos que assumiu ou respondeu (pelo painel ou por um
    -- número vinculado), resolvidos e tempo da primeira resposta dele.
    'top_equipe', (
      with resp as (
        select r.ticket_id, r.author_id, min(r.sent_at) as primeira
        from public.report_replies(p_inicio, p_fim, p_teste, p_group) r
        where r.author_id is not null
        group by r.ticket_id, r.author_id
      ),
      atuou as (
        select f.id as ticket_id, f.assignee_id as pid from f where f.assignee_id is not null
        union
        select resp.ticket_id, resp.author_id from resp
      ),
      det as (
        select a.pid, f.id, f.opened_at, f.close_reason,
          coalesce(resp.primeira, case when f.assignee_id = a.pid then f.first_response_at end) as resp_at
        from atuou a
        join f on f.id = a.ticket_id
        left join resp on resp.ticket_id = a.ticket_id and resp.author_id = a.pid
      )
      select coalesce(jsonb_agg(x order by x.assumidas desc, x.resolvidas desc), '[]'::jsonb) from (
        select pr.id, pr.name as nome, pr.avatar_url,
          count(*) as assumidas,
          count(*) filter (where det.close_reason = 'resolved') as resolvidas,
          count(*) filter (where det.resp_at is not null) as respondidas,
          count(*) filter (where det.resp_at - det.opened_at <= make_interval(secs => (select sla_seconds from sla))) as dentro_sla,
          round((percentile_cont(0.5) within group (order by extract(epoch from det.resp_at - det.opened_at) / 60.0))::numeric, 1) as mediana_min
        from det
        join public.profiles pr on pr.id = det.pid and pr.active
        group by pr.id, pr.name, pr.avatar_url
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

-- -----------------------------------------------------------------------------
-- Números do perfil do lead
-- -----------------------------------------------------------------------------
create or replace function public.lead_profile_stats(p_contact uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with m as (
    select * from public.messages where contact_id = p_contact and not is_note and deleted_at is null
  ),
  t as (
    select distinct on (x.id) x.* from public.tickets x
    left join public.ticket_participants p on p.ticket_id = x.id and p.contact_id = p_contact
    where x.close_reason is distinct from 'merged' and (x.contact_id = p_contact or p.contact_id is not null)
  )
  select jsonb_build_object(
    'mensagens', (select count(*) from m),
    'primeira', (select min(sent_at) from m),
    'ultima', (select max(sent_at) from m),
    'atendimentos', (select count(*) from t where t.contact_id = p_contact),
    'participou', (select count(*) from t where t.contact_id <> p_contact),
    'abertos', (select count(*) from t where t.status = 'open'),
    'duvidas', (select count(*) from t where t.contact_id = p_contact and t.category = 'duvida'),
    'tecnicos', (select count(*) from t where t.contact_id = p_contact and t.category = 'tecnico'),
    'reclamacoes', (select count(*) from t where t.contact_id = p_contact and t.topic = 'reclamacao'),
    'elogios', (select count(*) from t where t.contact_id = p_contact and t.topic = 'elogio'),
    'resolveu_para_outros', (select count(*) from public.tickets x join m on m.id = x.resolution_message_id where x.contact_id <> p_contact),
    'por_tipo', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select kind::text as k, count(*) as n from m group by kind) a),
    'por_grupo', (select coalesce(jsonb_agg(a order by a.mensagens desc), '[]'::jsonb) from (
      select m.group_jid as jid, g.name as nome, count(*) as mensagens from m left join public.wa_groups g on g.jid = m.group_jid group by m.group_jid, g.name
    ) a)
  );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.report_groups(boolean, text)',
    'public.community_report(timestamptz, timestamptz, boolean, text)',
    'public.community_report_live(timestamptz, timestamptz, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.lead_profile_stats(uuid) from public, anon;
grant execute on function public.lead_profile_stats(uuid) to authenticated, service_role;
