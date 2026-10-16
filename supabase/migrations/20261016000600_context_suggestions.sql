-- =============================================================================
-- Sugestões de contexto
-- =============================================================================
-- Mensagem de outro lead enquanto alguém atende no grupo não entra mais sozinha
-- no atendimento em andamento: abre o atendimento dele e aparece como SUGESTÃO
-- no atendimento em andamento. O atendente aceita (junta os dois) ou ignora.
-- Citar uma mensagem do atendimento continua entrando na hora.

create table if not exists public.ticket_context_suggestions (
  id bigint generated always as identity primary key,
  -- Atendimento em andamento que recebe a sugestão.
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  -- Atendimento que a mensagem abriu (é juntado ao aceitar).
  source_ticket_id uuid references public.tickets (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  unique (ticket_id, source_ticket_id)
);

create index if not exists ticket_context_suggestions_pending_idx
  on public.ticket_context_suggestions (ticket_id) where status = 'pending';

alter table public.ticket_context_suggestions enable row level security;
drop policy if exists "ticket_context_suggestions: membros leem" on public.ticket_context_suggestions;
create policy "ticket_context_suggestions: membros leem"
  on public.ticket_context_suggestions for select to authenticated
  using ((select public.is_active_member()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_context_suggestions'
  ) then
    alter publication supabase_realtime add table public.ticket_context_suggestions;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Ingestão: mesma assinatura; a regra 3 agora sugere em vez de juntar.
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

    -- 4. Atendimento novo.
    if v_ticket_id is null then
      insert into public.tickets (group_jid, contact_id, subject, opened_at, last_message_at)
      values (p_group_jid, v_contact_id, v_preview, p_sent_at, p_sent_at)
      returning id into v_ticket_id;
      insert into public.ticket_events (ticket_id, type, data)
      values (v_ticket_id, 'opened', jsonb_build_object('message_id', v_message_id));
      v_created := true;

      if v_suggest_ticket is not null then
        insert into public.ticket_context_suggestions (ticket_id, contact_id, message_id, source_ticket_id)
        values (v_suggest_ticket, v_contact_id, v_message_id, v_ticket_id)
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
-- Aceitar: junta o atendimento do lead ao atendimento em andamento. As
-- mensagens dele vão para lá, ele vira participante e o atendimento separado
-- é finalizado como "mesclado".
-- -----------------------------------------------------------------------------
create or replace function public.accept_context_suggestion(p_id bigint, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.ticket_context_suggestions;
  v_target public.tickets;
  v_moved integer := 0;
  v_first timestamptz;
begin
  select * into v_s from public.ticket_context_suggestions where id = p_id for update;
  if not found then raise exception 'sugestão não encontrada'; end if;
  -- Outra pessoa já aceitou ou ignorou (dois atendentes no mesmo atendimento).
  if v_s.status <> 'pending' then
    raise exception 'sugestão já decidida' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_target from public.tickets where id = v_s.ticket_id for update;
  if v_target.status <> 'open' then
    raise exception 'o atendimento já foi finalizado' using errcode = 'check_violation';
  end if;

  if v_s.source_ticket_id is not null then
    select min(sent_at) into v_first from public.messages
    where ticket_id = v_s.source_ticket_id and not is_note and not from_me;

    update public.messages set ticket_id = v_s.ticket_id
    where ticket_id = v_s.source_ticket_id and not is_note;
    get diagnostics v_moved = row_count;

    update public.tickets set
      status = 'closed', close_reason = 'merged', closed_at = now(), closed_by = p_actor_id,
      message_count = 0, waiting_since = null
    where id = v_s.source_ticket_id and status = 'open';

    insert into public.ticket_events (ticket_id, type, actor_id, data)
    values (v_s.source_ticket_id, 'merged', p_actor_id, jsonb_build_object('into', v_s.ticket_id, 'suggestion', true));
  end if;

  insert into public.ticket_participants (ticket_id, contact_id, joined_at)
  values (v_s.ticket_id, v_s.contact_id, coalesce(v_first, now()))
  on conflict (ticket_id, contact_id) do update set removed_at = null, removed_by = null;

  insert into public.ticket_events (ticket_id, type, actor_id, data)
  values (v_s.ticket_id, 'participant_added', p_actor_id,
          jsonb_build_object('contact_id', v_s.contact_id, 'suggestion', true, 'moved', v_moved));

  -- A espera passa a contar desde a mensagem do lead, se ela for anterior.
  update public.tickets set
    message_count = message_count + v_moved,
    waiting_since = case when v_first is null then waiting_since else least(coalesce(waiting_since, v_first), v_first) end,
    last_customer_message_at = case when v_first is null then last_customer_message_at
                                    else greatest(coalesce(last_customer_message_at, v_first), v_first) end
  where id = v_s.ticket_id;

  update public.ticket_context_suggestions set status = 'accepted', decided_at = now(), decided_by = p_actor_id
  where id = p_id;
  -- Outras sugestões do mesmo atendimento separado perdem o sentido.
  update public.ticket_context_suggestions set status = 'dismissed', decided_at = now(), decided_by = p_actor_id
  where source_ticket_id = v_s.source_ticket_id and id <> p_id and status = 'pending';

  return v_s.ticket_id;
end;
$$;

revoke all on function public.accept_context_suggestion(bigint, uuid) from public, anon, authenticated;
grant execute on function public.accept_context_suggestion(bigint, uuid) to service_role;
