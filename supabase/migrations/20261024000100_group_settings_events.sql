-- =============================================================================
-- Grupo trancado / destrancado (aviso com cadeado no atendimento)
-- =============================================================================
-- A uazapi manda no evento "groups":
--   Announce { IsAnnounce }  → só admins enviam mensagens (true) ou todos (false)
--   Locked   { IsLocked }    → só admins editam os dados do grupo (true) ou todos (false)
-- Cada mudança vira um community_events e o estado atual fica no grupo.

alter table public.community_events drop constraint if exists community_events_type_check;
alter table public.community_events add constraint community_events_type_check check (type in (
  'request_created', 'request_accepted', 'request_rejected', 'request_expired',
  'invite_sent', 'add_failed', 'approve_failed',
  'added_by_admin', 'invited_by_member', 'joined_via_link',
  'left', 'removed', 'pv_sent', 'pv_failed',
  'group_closed', 'group_opened', 'group_info_locked', 'group_info_unlocked'
));

create index if not exists community_events_group_idx on public.community_events (group_jid, created_at desc);

-- A equipe toda vê as mudanças de configuração do grupo (o resto do log segue só para admins).
drop policy if exists "community_events: membros leem configuração do grupo" on public.community_events;
create policy "community_events: membros leem configuração do grupo"
  on public.community_events for select to authenticated
  using (
    type in ('group_closed', 'group_opened', 'group_info_locked', 'group_info_unlocked')
    and (select public.is_active_member())
  );

alter table public.wa_groups
  add column if not exists announce boolean,   -- (substituída por is_announce na migration seguinte)
  add column if not exists locked boolean;     -- true: só admins editam os dados

-- O que já chegou antes desta migration (ex.: grupo trancado hoje).
insert into public.community_events (type, group_jid, actor_phone, actor_name, data, created_at)
select
  case
    when e.payload #> '{event,Announce}' <> 'null'::jsonb
      then case when (e.payload #>> '{event,Announce,IsAnnounce}')::boolean then 'group_closed' else 'group_opened' end
    else case when (e.payload #>> '{event,Locked,IsLocked}')::boolean then 'group_info_locked' else 'group_info_unlocked' end
  end,
  e.payload #>> '{event,JID}',
  nullif(split_part(coalesce(e.payload #>> '{event,SenderPN}', ''), '@', 1), ''),
  nullif(e.payload #>> '{event,Notify}', ''),
  jsonb_build_object('webhook_event_id', e.id),
  coalesce((e.payload #>> '{event,Timestamp}')::timestamptz, e.received_at)
from public.webhook_events e
join public.wa_groups g on g.jid = e.payload #>> '{event,JID}'
where e.event_type = 'groups'
  and (e.payload #> '{event,Announce}' <> 'null'::jsonb or e.payload #> '{event,Locked}' <> 'null'::jsonb)
  and not exists (
    select 1 from public.community_events c where c.data ->> 'webhook_event_id' = e.id::text
  );

-- Estado atual de cada grupo: o último evento de cada tipo.
update public.wa_groups g set announce = x.closed
from (
  select distinct on (group_jid) group_jid, type = 'group_closed' as closed
  from public.community_events where type in ('group_closed', 'group_opened')
  order by group_jid, created_at desc
) x
where g.jid = x.group_jid;

update public.wa_groups g set locked = x.locked
from (
  select distinct on (group_jid) group_jid, type = 'group_info_locked' as locked
  from public.community_events where type in ('group_info_locked', 'group_info_unlocked')
  order by group_jid, created_at desc
) x
where g.jid = x.group_jid;
