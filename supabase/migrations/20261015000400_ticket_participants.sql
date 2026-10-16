-- =============================================================================
-- Atendimentos com vários leads (participantes)
-- =============================================================================
-- Um atendimento continua tendo um lead "dono" (tickets.contact_id), mas outras
-- pessoas do grupo podem entrar nele:
--  - citando uma mensagem do atendimento aberto;
--  - mandando mensagem no grupo enquanto um atendente está atendendo (atendimento
--    aberto, já respondido e com atividade nos últimos join_window_minutes).
-- O atendente pode retirar um participante; ele não volta mais para aquele
-- atendimento e as mensagens dele saem (para um atendimento próprio ou para fora
-- da fila).

alter table public.app_settings
  add column if not exists join_window_minutes integer not null default 30
    check (join_window_minutes between 0 and 1440);

create table if not exists public.ticket_participants (
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  primary key (ticket_id, contact_id)
);

create index if not exists ticket_participants_contact_idx
  on public.ticket_participants (contact_id) where removed_at is null;

alter table public.ticket_participants enable row level security;
drop policy if exists "ticket_participants: membros leem" on public.ticket_participants;
create policy "ticket_participants: membros leem"
  on public.ticket_participants for select to authenticated
  using ((select public.is_active_member()));

-- O dono é participante desde a abertura.
insert into public.ticket_participants (ticket_id, contact_id, joined_at)
select id, contact_id, opened_at from public.tickets
on conflict do nothing;

-- Quem já tem mensagens em atendimentos de outro dono também vira participante.
insert into public.ticket_participants (ticket_id, contact_id, joined_at)
select m.ticket_id, m.contact_id, min(m.sent_at)
from public.messages m
where m.ticket_id is not null and m.contact_id is not null and not m.from_me
group by m.ticket_id, m.contact_id
on conflict do nothing;

alter table public.ticket_events drop constraint if exists ticket_events_type_check;
alter table public.ticket_events add constraint ticket_events_type_check check (type in (
  'opened', 'reopened', 'assigned', 'unassigned', 'closed', 'merged', 'message_moved',
  'participant_added', 'participant_removed'
));

-- Atendimento novo: o dono entra como participante (vale também para os
-- criados fora da ingestão, como "separar mensagem").
create or replace function public.add_ticket_owner_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ticket_participants (ticket_id, contact_id, joined_at)
  values (new.id, new.contact_id, new.opened_at)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists tickets_owner_participant on public.tickets;
create trigger tickets_owner_participant
  after insert on public.tickets
  for each row execute function public.add_ticket_owner_participant();

-- -----------------------------------------------------------------------------
-- Ingestão: mesma assinatura, novo roteamento.
-- Regras para mensagem de lead (fora da equipe):
--  1. Cita mensagem de um atendimento:
--     - aberto e do qual ele não foi retirado: entra nele (vira participante);
--     - do próprio lead e finalizado há pouco: reabre.
--  2. Já é participante ativo de um atendimento aberto no grupo: entra nele.
--  3. Há um atendimento "em andamento" no grupo (aberto, com responsável, já
--     respondido e com atividade recente): entra nele como participante.
--  4. Senão, abre um atendimento.
-- Equipe (ou a própria conta, pelo celular) só entra citando, e conta como resposta.
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
  v_preview text := public.message_preview(p_kind, p_body);
  v_created boolean := false;
  v_reopened boolean := false;
  v_joined boolean := false;
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
    select reopen_window_hours, join_window_minutes into v_reopen_hours, v_join_minutes
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

    -- 3. Atendimento em andamento no grupo.
    if v_ticket_id is null and coalesce(v_join_minutes, 30) > 0 then
      select t.id into v_ticket_id
      from public.tickets t
      where t.group_jid = p_group_jid and t.status = 'open'
        and t.assignee_id is not null and t.first_response_at is not null
        and t.last_message_at > p_sent_at - make_interval(mins => coalesce(v_join_minutes, 30))
        and not exists (
          select 1 from public.ticket_participants p
          where p.ticket_id = t.id and p.contact_id = v_contact_id and p.removed_at is not null
        )
      order by t.last_message_at desc
      limit 1;
    end if;

    -- 4. Atendimento novo.
    if v_ticket_id is null then
      insert into public.tickets (group_jid, contact_id, subject, opened_at, last_message_at)
      values (p_group_jid, v_contact_id, v_preview, p_sent_at, p_sent_at)
      returning id into v_ticket_id;
      insert into public.ticket_events (ticket_id, type, data)
      values (v_ticket_id, 'opened', jsonb_build_object('message_id', v_message_id));
      v_created := true;
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
    'duplicate', false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Retira um participante (não o dono). As mensagens dele saem do atendimento:
-- com p_open_ticket, vão para um atendimento próprio (aberto); sem, ficam fora
-- da fila. Devolve o id do atendimento novo (ou null).
-- -----------------------------------------------------------------------------
create or replace function public.remove_ticket_participant(
  p_ticket_id uuid,
  p_contact_id uuid,
  p_actor_id uuid,
  p_open_ticket boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_new_id uuid;
  v_first public.messages;
  v_last public.messages;
  v_moved integer;
  v_last_reply timestamptz;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'atendimento não encontrado'; end if;
  if v_ticket.contact_id = p_contact_id then
    raise exception 'o lead principal não pode ser retirado' using errcode = 'check_violation';
  end if;

  update public.ticket_participants
  set removed_at = now(), removed_by = p_actor_id
  where ticket_id = p_ticket_id and contact_id = p_contact_id and removed_at is null;
  if not found then
    insert into public.ticket_participants (ticket_id, contact_id, removed_at, removed_by)
    values (p_ticket_id, p_contact_id, now(), p_actor_id)
    on conflict (ticket_id, contact_id) do update set removed_at = now(), removed_by = p_actor_id;
  end if;

  select * into v_first from public.messages
  where ticket_id = p_ticket_id and contact_id = p_contact_id and not from_me and not is_note
  order by sent_at asc limit 1;
  select * into v_last from public.messages
  where ticket_id = p_ticket_id and contact_id = p_contact_id and not from_me and not is_note
  order by sent_at desc limit 1;

  if v_first.id is not null and p_open_ticket then
    insert into public.tickets (
      group_jid, contact_id, subject, opened_at, last_message_at, last_message_preview,
      last_customer_message_at, waiting_since
    ) values (
      v_ticket.group_jid, p_contact_id, public.message_preview(v_first.kind, v_first.body), v_first.sent_at,
      v_last.sent_at, public.message_preview(v_last.kind, v_last.body), v_last.sent_at, v_first.sent_at
    )
    returning id into v_new_id;
  end if;

  update public.messages set ticket_id = v_new_id
  where ticket_id = p_ticket_id and contact_id = p_contact_id and not from_me and not is_note;
  get diagnostics v_moved = row_count;

  if v_new_id is not null then
    update public.tickets set message_count = v_moved where id = v_new_id;
    insert into public.ticket_events (ticket_id, type, actor_id, data)
    values (v_new_id, 'opened', p_actor_id, jsonb_build_object('from', p_ticket_id, 'split_participant', true));
  end if;

  -- Recalcula a espera do atendimento original: a mensagem mais antiga dos
  -- leads que restaram depois da última resposta da equipe.
  select max(sent_at) into v_last_reply from public.messages
  where ticket_id = p_ticket_id and not is_note and (from_me or author_id is not null);

  update public.tickets t set
    message_count = greatest(0, t.message_count - v_moved),
    waiting_since = case when t.waiting_since is null then null else (
      select min(m.sent_at) from public.messages m
      where m.ticket_id = p_ticket_id and not m.from_me and not m.is_note and m.contact_id is not null
        and (v_last_reply is null or m.sent_at > v_last_reply)
    ) end,
    last_customer_message_at = (
      select max(m.sent_at) from public.messages m
      where m.ticket_id = p_ticket_id and not m.from_me and not m.is_note and m.contact_id is not null
    )
  where t.id = p_ticket_id;

  insert into public.ticket_events (ticket_id, type, actor_id, data)
  values (p_ticket_id, 'participant_removed', p_actor_id,
          jsonb_build_object('contact_id', p_contact_id, 'moved', v_moved, 'to', v_new_id));

  return v_new_id;
end;
$$;

revoke all on function public.remove_ticket_participant(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.remove_ticket_participant(uuid, uuid, uuid, boolean) to service_role;
revoke all on function public.add_ticket_owner_participant() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_participants'
  ) then
    alter publication supabase_realtime add table public.ticket_participants;
  end if;
end $$;
