-- =============================================================================
-- Mensagem da equipe sem citação entra na conversa em andamento
-- =============================================================================
-- Antes, a mensagem de alguém da equipe (contato "equipe" ou o próprio número
-- pelo celular) só entrava num atendimento se citasse uma mensagem dele. Áudio
-- e textos soltos ("mas vê se abre também") ficavam fora de todos e não
-- apareciam no modal. Agora, sem citação (ou citando um atendimento fechado):
--   2. continua o atendimento aberto em que essa pessoa falou por último no grupo;
--   3. senão, o atendimento aberto do grupo com conversa mais recente.
-- As duas regras valem dentro da janela de entrada (join_window_minutes, 30 min).
-- Como na citação, conta como resposta da equipe (zera a espera do SLA).
-- Só muda o bloco da equipe; o resto é igual a 20261021000000_community_metrics.

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
    select join_window_minutes into v_join_minutes from public.app_settings where id = 1;

    -- 1. Citação de uma mensagem de atendimento aberto.
    if v_q_ticket.id is not null and v_q_ticket.status = 'open' then
      v_ticket_id := v_q_ticket.id;
    end if;

    -- 2. Continua a conversa em que esta pessoa da equipe falou por último no grupo.
    if v_ticket_id is null and (p_from_me or v_contact_id is not null) then
      select m.ticket_id into v_ticket_id
      from public.messages m
      join public.tickets t on t.id = m.ticket_id
      where m.group_jid = p_group_jid
        and m.id <> v_message_id
        and t.status = 'open'
        and m.sent_at > p_sent_at - make_interval(mins => coalesce(v_join_minutes, 30))
        and case when p_from_me then m.from_me else m.contact_id = v_contact_id end
      order by m.sent_at desc
      limit 1;
    end if;

    -- 3. Senão, o atendimento aberto do grupo com conversa mais recente.
    if v_ticket_id is null then
      select t.id into v_ticket_id
      from public.tickets t
      where t.group_jid = p_group_jid and t.status = 'open'
        and t.last_message_at > p_sent_at - make_interval(mins => coalesce(v_join_minutes, 30))
      order by t.last_message_at desc
      limit 1;
    end if;

    if v_ticket_id is not null then
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
