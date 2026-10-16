-- =============================================================================
-- Mesclar atendimentos e confirmação de contexto
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rajada: mensagens da mesma pessoa com até este intervalo entre elas são
-- continuação (quem escreve uma palavra por mensagem). Acima disso, depois de
-- uma resposta da equipe, o painel pergunta se a mensagem é do mesmo assunto.
-- -----------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists burst_window_seconds integer not null default 180
    check (burst_window_seconds between 0 and 3600);

-- pending: o painel pergunta "faz parte deste atendimento?"; confirmed: sim.
alter table public.messages
  add column if not exists context_check text check (context_check in ('pending', 'confirmed'));

create index if not exists messages_context_pending_idx on public.messages (ticket_id) where context_check = 'pending';

-- -----------------------------------------------------------------------------
-- Mesclar: o atendimento de origem é juntado ao de destino (mesmo grupo).
-- Mensagens, notas e participantes vão para o destino; a origem é finalizada
-- como "mesclado".
-- -----------------------------------------------------------------------------
create or replace function public.merge_tickets(p_source_id uuid, p_target_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.tickets;
  v_target public.tickets;
  v_moved integer;
  v_last public.messages;
begin
  if p_source_id = p_target_id then
    raise exception 'escolha outro atendimento' using errcode = 'invalid_parameter_value';
  end if;

  -- Trava os dois na mesma ordem (evita impasse com mesclas cruzadas).
  perform 1 from public.tickets where id in (p_source_id, p_target_id) order by id for update;
  select * into v_source from public.tickets where id = p_source_id;
  select * into v_target from public.tickets where id = p_target_id;
  if v_source.id is null or v_target.id is null then
    raise exception 'atendimento não encontrado' using errcode = 'no_data_found';
  end if;
  if v_source.group_jid <> v_target.group_jid then
    raise exception 'só dá para mesclar atendimentos do mesmo grupo' using errcode = 'check_violation';
  end if;
  if v_source.status <> 'open' or v_target.status <> 'open' then
    raise exception 'os dois atendimentos precisam estar abertos' using errcode = 'check_violation';
  end if;

  update public.messages set ticket_id = p_target_id where ticket_id = p_source_id;
  get diagnostics v_moved = row_count;

  insert into public.ticket_participants (ticket_id, contact_id, joined_at)
  select p_target_id, p.contact_id, p.joined_at
  from public.ticket_participants p
  where p.ticket_id = p_source_id and p.removed_at is null
  on conflict (ticket_id, contact_id) do update set removed_at = null, removed_by = null;

  select * into v_last from public.messages
  where ticket_id = p_target_id and not is_note
  order by sent_at desc limit 1;

  update public.tickets t set
    message_count = t.message_count + v_moved,
    assignee_id = coalesce(t.assignee_id, v_source.assignee_id),
    -- Espera: a mais antiga das duas (se alguma ainda espera resposta).
    waiting_since = case
      when t.waiting_since is null then v_source.waiting_since
      when v_source.waiting_since is null then t.waiting_since
      else least(t.waiting_since, v_source.waiting_since)
    end,
    first_response_at = case
      when t.first_response_at is null then v_source.first_response_at
      when v_source.first_response_at is null then t.first_response_at
      else least(t.first_response_at, v_source.first_response_at)
    end,
    last_customer_message_at = greatest(t.last_customer_message_at, v_source.last_customer_message_at),
    last_message_at = greatest(t.last_message_at, v_source.last_message_at),
    last_message_preview = coalesce(public.message_preview(v_last.kind, v_last.body), t.last_message_preview),
    opened_at = least(t.opened_at, v_source.opened_at)
  where t.id = p_target_id;

  update public.tickets set
    status = 'closed', close_reason = 'merged', closed_at = now(), closed_by = p_actor_id,
    message_count = 0, waiting_since = null
  where id = p_source_id;

  insert into public.ticket_events (ticket_id, type, actor_id, data) values
    (p_target_id, 'merged', p_actor_id, jsonb_build_object('from', p_source_id, 'from_number', v_source.number, 'moved', v_moved)),
    (p_source_id, 'merged', p_actor_id, jsonb_build_object('into', p_target_id, 'into_number', v_target.number));

  -- Sugestões ligadas à origem perdem o sentido.
  update public.ticket_context_suggestions set status = 'dismissed', decided_at = now(), decided_by = p_actor_id
  where status = 'pending' and (source_ticket_id = p_source_id or ticket_id = p_source_id);

  return p_target_id;
end;
$$;

revoke all on function public.merge_tickets(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_tickets(uuid, uuid, uuid) to service_role;
