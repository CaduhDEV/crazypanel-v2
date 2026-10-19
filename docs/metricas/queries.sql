-- =============================================================================
-- Métricas das comunidades — queries (somente leitura)
-- =============================================================================
-- Uma query por métrica, com a mesma numeração de docs/metricas/relatorio.md.
-- Cada uma é independente: copie inteira para o SQL Editor do Supabase.
--
-- Parâmetros (CTE "params", no topo de cada query):
--   inicio / fim         período analisado (padrão: últimos 30 dias)
--   incluir_teste        true inclui o grupo de teste (padrão: false)
--   horas_sem_resposta   limite para "thread sem resposta" (padrão: 2 h)
--
-- Convenções:
--   comunidade  = grupo escutado, que não é de parceiros (wa_groups.listening and not is_partner_group)
--   thread      = atendimento (tickets); "merged" fica de fora (foi absorvido por outro)
--   resposta    = mensagem no atendimento de alguém que não é o dono da dúvida
--                 quem = 'equipe'   → enviada pelo painel (author_id), pelo número da comunidade (from_me)
--                                     ou por contato da equipe (kind = 'team')
--                        'parceiro' → contato kind = 'partner'
--                        'membro'   → demais contatos
--   notas internas e mensagens apagadas não contam
--   horários em America/Sao_Paulo
-- =============================================================================


-- @q 1 — Ranking de quem mais ajuda
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.id, m.ticket_id, m.sent_at, m.contact_id, m.author_id,
    case when m.from_me or m.author_id is not null or c.kind = 'team' then 'equipe'
         when c.kind = 'partner' then 'parceiro' else 'membro' end as quem
  from public.messages m
  join tk on tk.id = m.ticket_id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
)
select c.name as membro, c.phone, c.kind, co.name as empresa,
  count(distinct r.ticket_id) as threads_ajudadas,
  count(*) as respostas,
  min(r.sent_at) as primeira_ajuda,
  max(r.sent_at) as ultima_ajuda
from resp r
join public.contacts c on c.id = r.contact_id
left join public.companies co on co.id = c.company_id
where r.quem <> 'equipe'
group by c.id, c.name, c.phone, c.kind, co.name
order by threads_ajudadas desc, respostas desc
limit 50;


-- @q 2 — Ranking de quem mais resolve (proxy)
-- Resposta "resolutiva" = de membro/parceiro e (a) recebeu reação do dono da dúvida, ou
-- (b) foi a última resposta antes de o atendimento ser fechado como "resolvido".
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.id, m.ticket_id, m.sent_at, m.contact_id, m.author_id,
    case when m.from_me or m.author_id is not null or c.kind = 'team' then 'equipe'
         when c.kind = 'partner' then 'parceiro' else 'membro' end as quem
  from public.messages m
  join tk on tk.id = m.ticket_id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
),
com_reacao as (
  select distinct r.id
  from resp r
  join tk on tk.id = r.ticket_id
  join public.message_reactions mr on mr.message_id = r.id and mr.contact_id = tk.contact_id
  where r.quem <> 'equipe'
),
ultima_antes_de_fechar as (
  select distinct on (r.ticket_id) r.ticket_id, r.id, r.quem
  from resp r
  join tk on tk.id = r.ticket_id
  where tk.close_reason = 'resolved' and r.sent_at <= tk.closed_at
  order by r.ticket_id, r.sent_at desc
),
resolutivas as (
  select id from com_reacao
  union
  select id from ultima_antes_de_fechar where quem <> 'equipe'
)
select c.name as membro, c.phone, co.name as empresa,
  count(distinct r.ticket_id) as threads_resolvidas,
  count(*) filter (where r.id in (select id from com_reacao)) as respostas_com_reacao_do_autor,
  count(*) filter (where r.id in (select id from ultima_antes_de_fechar)) as ultima_resposta_antes_do_resolvido
from resp r
join resolutivas x on x.id = r.id
join public.contacts c on c.id = r.contact_id
left join public.companies co on co.id = c.company_id
group by c.id, c.name, c.phone, co.name
order by threads_resolvidas desc
limit 50;


-- @q 3 — % de threads resolvidas pela comunidade (sem técnico)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.id, m.ticket_id, m.sent_at, m.contact_id, m.author_id,
    case when m.from_me or m.author_id is not null or c.kind = 'team' then 'equipe'
         when c.kind = 'partner' then 'parceiro' else 'membro' end as quem
  from public.messages m
  join tk on tk.id = m.ticket_id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
),
por_thread as (
  select tk.id, tk.group_jid,
    coalesce(bool_or(r.quem <> 'equipe'), false) as comunidade,
    coalesce(bool_or(r.quem = 'equipe'), false) or tk.first_response_at is not null as equipe
  from tk left join resp r on r.ticket_id = tk.id
  group by tk.id, tk.group_jid, tk.first_response_at
)
select coalesce(g.name, 'TOTAL') as comunidade,
  count(*) as threads,
  count(*) filter (where comunidade and not equipe) as so_comunidade,
  count(*) filter (where equipe and not comunidade) as so_equipe,
  count(*) filter (where comunidade and equipe) as comunidade_e_equipe,
  count(*) filter (where not comunidade and not equipe) as sem_resposta,
  round(100.0 * count(*) filter (where comunidade and not equipe) / nullif(count(*) filter (where comunidade or equipe), 0), 1) as pct_resolvido_pela_comunidade
from por_thread pt
join grupos g on g.jid = pt.group_jid
group by rollup (g.name)
order by g.name nulls last;


-- @q 4 — Tempo até a primeira resposta de um membro
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.id, m.ticket_id, m.sent_at, m.contact_id, m.author_id,
    case when m.from_me or m.author_id is not null or c.kind = 'team' then 'equipe'
         when c.kind = 'partner' then 'parceiro' else 'membro' end as quem
  from public.messages m
  join tk on tk.id = m.ticket_id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
),
primeira as (
  select tk.id, tk.group_jid, extract(epoch from min(r.sent_at) - tk.opened_at) / 60.0 as minutos
  from tk join resp r on r.ticket_id = tk.id and r.quem <> 'equipe'
  group by tk.id, tk.group_jid, tk.opened_at
)
select coalesce(g.name, 'TOTAL') as comunidade,
  count(*) as threads_com_resposta_de_membro,
  round((percentile_cont(0.5) within group (order by minutos))::numeric, 1) as mediana_min,
  round((percentile_cont(0.9) within group (order by minutos))::numeric, 1) as p90_min
from primeira p
join grupos g on g.jid = p.group_jid
group by rollup (g.name)
order by g.name nulls last;


-- @q 5 — % de threads que precisaram de técnico (por semana e comunidade)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
)
select date_trunc('week', tk.opened_at at time zone 'America/Sao_Paulo')::date as semana,
  g.name as comunidade,
  count(*) as threads,
  count(*) filter (where tk.first_response_at is not null) as com_tecnico,
  round(100.0 * count(*) filter (where tk.first_response_at is not null) / count(*), 1) as pct_com_tecnico
from tk join grupos g on g.jid = tk.group_jid
group by 1, 2
order by 1 desc, 2;


-- @q 6 — Tempo até o técnico entrar (separando se algum membro respondeu antes)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.id, m.ticket_id, m.sent_at, m.contact_id, m.author_id,
    case when m.from_me or m.author_id is not null or c.kind = 'team' then 'equipe'
         when c.kind = 'partner' then 'parceiro' else 'membro' end as quem
  from public.messages m
  join tk on tk.id = m.ticket_id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
),
t as (
  select tk.id,
    extract(epoch from tk.first_response_at - tk.opened_at) / 60.0 as minutos,
    exists (select 1 from resp r where r.ticket_id = tk.id and r.quem <> 'equipe' and r.sent_at < tk.first_response_at) as membro_antes
  from tk where tk.first_response_at is not null
)
select case when membro_antes then 'membro respondeu antes' else 'ninguém respondeu antes' end as situacao,
  count(*) as threads,
  round((percentile_cont(0.5) within group (order by minutos))::numeric, 1) as mediana_min,
  round((percentile_cont(0.9) within group (order by minutos))::numeric, 1) as p90_min
from t
group by 1
order by 1;


-- @q 7 — Primeira resposta da equipe dentro do SLA
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
)
select coalesce(g.name, 'TOTAL') as comunidade,
  s.sla_seconds / 60 as sla_min,
  count(*) filter (where tk.first_response_at is not null) as respondidas_pela_equipe,
  count(*) filter (where tk.first_response_at - tk.opened_at <= make_interval(secs => s.sla_seconds)) as dentro_do_sla,
  round(100.0 * count(*) filter (where tk.first_response_at - tk.opened_at <= make_interval(secs => s.sla_seconds))
        / nullif(count(*) filter (where tk.first_response_at is not null), 0), 1) as pct_dentro_do_sla
from tk
join grupos g on g.jid = tk.group_jid
cross join public.app_settings s
group by rollup (g.name), s.sla_seconds
order by g.name nulls last;


-- @q 8 — Carga por técnico (só o que passa pelo painel)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
msgs as (
  select m.author_id, count(*) filter (where not m.is_note) as mensagens, count(*) filter (where m.is_note) as notas,
    count(distinct m.ticket_id) as threads_com_mensagem
  from public.messages m join grupos g on g.jid = m.group_jid, params p
  where m.author_id is not null and m.deleted_at is null and m.sent_at >= p.inicio and m.sent_at < p.fim
  group by m.author_id
),
assumidos as (select assignee_id, count(*) as threads_assumidas from tk where assignee_id is not null group by 1),
fechados as (
  select closed_by, count(*) as fechadas,
    count(*) filter (where close_reason = 'resolved') as resolvidas
  from tk where closed_by is not null and close_reason in ('resolved', 'parallel') group by 1
),
abertos as (
  select t.assignee_id, count(*) as abertas_agora
  from public.tickets t join grupos g on g.jid = t.group_jid
  where t.status = 'open' and t.assignee_id is not null group by 1
),
primeira as (
  select assignee_id, round((percentile_cont(0.5) within group (order by extract(epoch from first_response_at - opened_at) / 60.0))::numeric, 1) as mediana_1a_resposta_min
  from tk where assignee_id is not null and first_response_at is not null group by 1
)
select pr.name as tecnico,
  coalesce(a.threads_assumidas, 0) as threads_assumidas,
  coalesce(m.mensagens, 0) as mensagens,
  coalesce(m.notas, 0) as notas,
  coalesce(f.fechadas, 0) as fechadas,
  coalesce(f.resolvidas, 0) as resolvidas,
  coalesce(o.abertas_agora, 0) as abertas_agora,
  pm.mediana_1a_resposta_min
from public.profiles pr
left join assumidos a on a.assignee_id = pr.id
left join msgs m on m.author_id = pr.id
left join fechados f on f.closed_by = pr.id
left join abertos o on o.assignee_id = pr.id
left join primeira pm on pm.assignee_id = pr.id
where pr.active
order by threads_assumidas desc, mensagens desc;


-- @q 9 — Recorrência por membro (quem volta com dúvida)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
seq as (
  select tk.contact_id, tk.opened_at,
    tk.opened_at - lag(tk.opened_at) over (partition by tk.contact_id order by tk.opened_at) as desde_anterior
  from tk
)
select c.name as membro, c.phone, co.name as empresa,
  count(*) as threads,
  count(*) filter (where desde_anterior <= interval '7 days') as voltou_em_ate_7_dias,
  max(s.opened_at) as ultima
from seq s
join public.contacts c on c.id = s.contact_id
left join public.companies co on co.id = c.company_id
where c.kind <> 'team'
group by c.id, c.name, c.phone, co.name
having count(*) > 1
order by threads desc
limit 50;


-- @q 10 — Recorrência por empresa
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
)
select coalesce(co.name, '(sem empresa)') as empresa, co.external_id as tenant,
  count(*) as threads,
  count(distinct tk.contact_id) as pessoas_com_duvida,
  round(count(*)::numeric / count(distinct tk.contact_id), 2) as threads_por_pessoa,
  count(*) filter (where tk.first_response_at is not null) as com_tecnico,
  count(*) filter (where tk.category = 'bug') as bugs,
  count(*) filter (where tk.category = 'reclamacao') as reclamacoes
from tk
join public.contacts c on c.id = tk.contact_id
left join public.companies co on co.id = c.company_id
where c.kind <> 'team'
group by co.id, co.name, co.external_id
order by threads desc
limit 50;


-- @q 11 — Recorrência por comunidade (threads por 100 membros)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
membros as (
  select gm.group_jid, count(*) as membros
  from public.group_members gm join public.contacts c on c.id = gm.contact_id
  where gm.left_at is null and c.kind <> 'team'
  group by 1
)
select g.name as comunidade,
  coalesce(m.membros, 0) as membros,
  count(tk.id) as threads,
  count(distinct tk.contact_id) as pessoas_com_duvida,
  round(100.0 * count(tk.id) / nullif(m.membros, 0), 2) as threads_por_100_membros
from grupos g
left join membros m on m.group_jid = g.jid
left join tk on tk.group_jid = g.jid
group by g.name, m.membros
order by threads desc;


-- @q 12 — Recorrência por tema
-- (a) categoria dada no fechamento "resolvido" do painel
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
)
select coalesce(tk.category, '(sem categoria)') as tema,
  count(*) as threads,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct,
  count(distinct c.company_id) as empresas
from tk join public.contacts c on c.id = tk.contact_id
group by 1
order by threads desc;

-- @q 12b — Recorrência por tema no Gleap (tipo de ticket), ligado à empresa pelo e-mail do lead
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta)
select gt.type as tipo, gt.status,
  count(*) as tickets_gleap,
  count(distinct c.company_id) as empresas_da_comunidade,
  count(*) filter (where not gt.has_agent_reply) as sem_resposta_do_agente
from public.gleap_tickets gt
cross join params p
left join public.contacts c on lower(c.email) = lower(gt.session_email)
where gt.gleap_created_at >= p.inicio and gt.gleap_created_at < p.fim
group by 1, 2
order by tickets_gleap desc;


-- @q 13 — Reabertura de threads
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
reab as (select ticket_id, count(*) as vezes from public.ticket_events where type = 'reopened' group by 1)
select count(*) filter (where tk.status = 'closed' or r.ticket_id is not null) as threads_fechadas_alguma_vez,
  count(r.ticket_id) as reabertas,
  coalesce(sum(r.vezes), 0) as reaberturas,
  round(100.0 * count(r.ticket_id) / nullif(count(*) filter (where tk.status = 'closed' or r.ticket_id is not null), 0), 1) as pct_reabertas
from tk left join reab r on r.ticket_id = tk.id;


-- @q 14 — Threads sem resposta (ninguém além do autor respondeu em X horas)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.id, m.ticket_id, m.sent_at
  from public.messages m join tk on tk.id = m.ticket_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
),
t as (
  select tk.*, (select min(r.sent_at) from resp r where r.ticket_id = tk.id) as primeira_resposta
  from tk
)
select coalesce(g.name, 'TOTAL') as comunidade,
  count(*) as threads,
  count(*) filter (where coalesce(primeira_resposta, now()) - t.opened_at > make_interval(hours => p.horas_sem_resposta)) as sem_resposta_no_prazo,
  round(100.0 * count(*) filter (where coalesce(primeira_resposta, now()) - t.opened_at > make_interval(hours => p.horas_sem_resposta)) / count(*), 1) as pct_sem_resposta_no_prazo,
  count(*) filter (where primeira_resposta is null) as nunca_respondidas,
  count(*) filter (where t.status = 'open' and primeira_resposta is null and now() - t.opened_at > make_interval(hours => p.horas_sem_resposta)) as abertas_agora_sem_resposta
from t
join grupos g on g.jid = t.group_jid
cross join params p
group by rollup (g.name)
order by g.name nulls last;


-- @q 15 — Membros ativos vs. inativos (mensagem nos últimos 30 dias)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
membros as (
  select gm.group_jid, gm.contact_id
  from public.group_members gm join public.contacts c on c.id = gm.contact_id
  where gm.left_at is null and c.kind <> 'team'
),
ativos as (
  select distinct m.group_jid, m.contact_id
  from public.messages m
  where m.contact_id is not null and m.sent_at >= now() - interval '30 days'
)
select g.name as comunidade,
  count(mb.contact_id) as membros,
  count(a.contact_id) as ativos_30d,
  count(mb.contact_id) - count(a.contact_id) as inativos_30d,
  round(100.0 * count(a.contact_id) / nullif(count(mb.contact_id), 0), 2) as pct_ativos
from grupos g
left join membros mb on mb.group_jid = g.jid
left join ativos a on a.group_jid = mb.group_jid and a.contact_id = mb.contact_id
group by g.name
order by membros desc;


-- @q 16 — Entradas, saídas e retenção (eventos do webhook, desde 19/10/2026)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
)
select date_trunc('week', e.created_at at time zone 'America/Sao_Paulo')::date as semana,
  g.name as comunidade,
  count(*) filter (where e.type in ('joined_via_link', 'added_by_admin', 'invited_by_member')) as entradas,
  count(*) filter (where e.type = 'joined_via_link') as pelo_link,
  count(*) filter (where e.type = 'added_by_admin') as adicionados,
  count(*) filter (where e.type = 'invited_by_member') as convidados_por_membro,
  count(*) filter (where e.type in ('left', 'removed')) as saidas,
  count(*) filter (where e.type in ('joined_via_link', 'added_by_admin', 'invited_by_member'))
    - count(*) filter (where e.type in ('left', 'removed')) as saldo
from public.community_events e
join grupos g on g.jid = e.group_jid
cross join params p
where e.created_at >= p.inicio and e.created_at < p.fim
  and e.type in ('joined_via_link', 'added_by_admin', 'invited_by_member', 'left', 'removed')
group by 1, 2
order by 1 desc, 2;

-- @q 16b — Retenção em 30 dias: de quem entrou, quantos continuam no grupo
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
entradas as (
  select distinct on (e.group_jid, e.contact_id) e.group_jid, e.contact_id, e.created_at
  from public.community_events e
  join grupos g on g.jid = e.group_jid
  where e.type in ('joined_via_link', 'added_by_admin', 'invited_by_member') and e.contact_id is not null
    and e.created_at <= now() - interval '30 days'
  order by e.group_jid, e.contact_id, e.created_at
)
select g.name as comunidade,
  count(*) as entraram_ha_30_dias_ou_mais,
  count(*) filter (where gm.left_at is null) as continuam,
  round(100.0 * count(*) filter (where gm.left_at is null) / nullif(count(*), 0), 1) as pct_retencao
from entradas en
join grupos g on g.jid = en.group_jid
left join public.group_members gm on gm.group_jid = en.group_jid and gm.contact_id = en.contact_id
group by g.name;


-- @q 17 — Horários de pico (mensagens de membros e threads abertas)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
)
select to_char(m.sent_at at time zone 'America/Sao_Paulo', 'ID - Dy') as dia_semana,
  extract(hour from m.sent_at at time zone 'America/Sao_Paulo')::int as hora,
  count(*) as mensagens_de_membros,
  count(*) filter (where te.id is not null) as threads_abertas
from public.messages m
join grupos g on g.jid = m.group_jid
cross join params p
left join public.contacts c on c.id = m.contact_id
left join public.ticket_events te on te.type = 'opened' and te.data->>'message_id' = m.id::text
where not m.from_me and m.author_id is null and coalesce(c.kind::text, '') <> 'team'
  and m.sent_at >= p.inicio and m.sent_at < p.fim
group by 1, 2
order by 1, 2;


-- @q 18 — Dependência de "heróis" (concentração das respostas de membros)
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
resp as (
  select m.contact_id
  from public.messages m
  join tk on tk.id = m.ticket_id
  left join public.contacts c on c.id = m.contact_id
  where not m.is_note and m.deleted_at is null and m.contact_id is distinct from tk.contact_id
    and not m.from_me and m.author_id is null and c.kind <> 'team'
),
por_membro as (
  select contact_id, count(*) as n, row_number() over (order by count(*) desc) as pos
  from resp group by contact_id
),
tot as (select sum(n) as total, count(*) as ajudantes from por_membro)
select tot.ajudantes,
  tot.total as respostas,
  round(100.0 * sum(n) filter (where pos <= 5) / nullif(tot.total, 0), 1) as pct_top5,
  round(100.0 * sum(n) filter (where pos <= greatest(1, ceil(tot.ajudantes * 0.1))) / nullif(tot.total, 0), 1) as pct_top10pct,
  round(sum((100.0 * n / tot.total) ^ 2)) as hhi_0_a_10000
from por_membro, tot
group by tot.ajudantes, tot.total;


-- @q 19 — Engajamento: mensagens por membro ativo e % de ativos que já ajudaram alguém
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
msgs as (
  select m.group_jid, m.contact_id, m.ticket_id, t.contact_id as dono
  from public.messages m
  join grupos g on g.jid = m.group_jid
  cross join params p
  join public.contacts c on c.id = m.contact_id
  left join public.tickets t on t.id = m.ticket_id
  where c.kind <> 'team' and not m.is_note and m.deleted_at is null and m.sent_at >= p.inicio and m.sent_at < p.fim
)
select g.name as comunidade,
  count(distinct ms.contact_id) as membros_ativos,
  count(*) as mensagens,
  round(count(*)::numeric / nullif(count(distinct ms.contact_id), 0), 1) as mensagens_por_ativo,
  count(distinct ms.contact_id) filter (where ms.ticket_id is not null and ms.contact_id <> ms.dono) as ativos_que_ajudaram,
  round(100.0 * count(distinct ms.contact_id) filter (where ms.ticket_id is not null and ms.contact_id <> ms.dono)
        / nullif(count(distinct ms.contact_id), 0), 1) as pct_que_ajudaram
from msgs ms join grupos g on g.jid = ms.group_jid
group by g.name
order by membros_ativos desc;


-- @q 20 — Ruído de roteamento: threads que provavelmente eram resposta a outra
-- Thread aberta sem citação até 5 min depois de outra (de outra pessoa) no mesmo grupo:
-- é a resposta de um membro que não citou a mensagem e virou atendimento separado.
with params as (select now() - interval '30 days' as inicio, now() as fim, false as incluir_teste, 2 as horas_sem_resposta),
grupos as (
  select g.jid, g.name from public.wa_groups g, params p
  where g.listening and not g.is_partner_group and (p.incluir_teste or g.name not ilike '%teste%')
),
tk as (
  select t.* from public.tickets t join grupos g on g.jid = t.group_jid, params p
  where t.opened_at >= p.inicio and t.opened_at < p.fim and t.close_reason is distinct from 'merged'
),
abertura as (
  select tk.id, tk.group_jid, tk.contact_id, tk.opened_at, m.quoted_wa_id,
    lag(tk.opened_at) over w as anterior_em,
    lag(tk.contact_id) over w as anterior_de
  from tk
  left join public.ticket_events te on te.ticket_id = tk.id and te.type = 'opened'
  left join public.messages m on m.id = (te.data->>'message_id')::uuid
  window w as (partition by tk.group_jid order by tk.opened_at)
)
select coalesce(g.name, 'TOTAL') as comunidade,
  count(*) as threads,
  count(*) filter (where a.quoted_wa_id is null and a.anterior_de <> a.contact_id and a.opened_at - a.anterior_em <= interval '5 minutes') as provavel_resposta_sem_citacao,
  round(100.0 * count(*) filter (where a.quoted_wa_id is null and a.anterior_de <> a.contact_id and a.opened_at - a.anterior_em <= interval '5 minutes') / count(*), 1) as pct
from abertura a
join grupos g on g.jid = a.group_jid
group by rollup (g.name)
order by g.name nulls last;
