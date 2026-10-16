-- =============================================================================
-- Atendimentos (tickets), mensagens, reações, histórico e funções de ingestão
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum ('open', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'message_kind') then
    create type public.message_kind as enum
      ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'poll', 'other');
  end if;
  -- A ordem importa: o status só avança (pending < sent < delivered < read < played).
  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type public.message_status as enum ('pending', 'sent', 'delivered', 'read', 'played', 'failed');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Atendimentos
-- -----------------------------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  group_jid text not null references public.wa_groups (jid),
  contact_id uuid not null references public.contacts (id),
  status public.ticket_status not null default 'open',
  assignee_id uuid references public.profiles (id) on delete set null,
  -- Primeira mensagem do lead (o "assunto" mostrado no card da fila).
  subject text,
  -- Mensagem mais antiga do lead ainda sem resposta. null = respondido.
  -- O SLA é calculado na tela a partir daqui.
  waiting_since timestamptz,
  last_customer_message_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  first_response_at timestamptz,
  message_count integer not null default 0,
  category text check (category in (
    'duvida_basica', 'duvida_avancada', 'duvida_meta', 'bug', 'reclamacao',
    'feedback', 'elogio', 'agradecimento', 'divulgacao', 'outro'
  )),
  close_reason text check (close_reason in ('resolved', 'parallel', 'sla_cleared', 'merged')),
  close_note text,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tickets_open_queue_idx on public.tickets (waiting_since nulls last)
  where status = 'open';
create index if not exists tickets_open_lead_idx on public.tickets (group_jid, contact_id, last_message_at desc)
  where status = 'open';
create index if not exists tickets_assignee_idx on public.tickets (assignee_id) where status = 'open';
create index if not exists tickets_contact_idx on public.tickets (contact_id, opened_at desc);
create index if not exists tickets_closed_idx on public.tickets (closed_at desc) where status = 'closed';

alter table public.tickets enable row level security;
drop policy if exists "tickets: membros leem" on public.tickets;
create policy "tickets: membros leem"
  on public.tickets for select to authenticated
  using ((select public.is_active_member()));

drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch
  before update on public.tickets
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Mensagens (recebidas, enviadas pelo painel, enviadas pelo celular e notas)
-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  -- messageid do WhatsApp. null enquanto o envio está pendente e em notas.
  wa_id text unique,
  group_jid text not null references public.wa_groups (jid),
  ticket_id uuid references public.tickets (id) on delete set null,
  -- Autor quando é um contato do grupo.
  contact_id uuid references public.contacts (id) on delete set null,
  -- Atendente que enviou pelo painel (ou escreveu a nota).
  author_id uuid references public.profiles (id) on delete set null,
  from_me boolean not null default false,
  is_note boolean not null default false,
  sender_name text,
  kind public.message_kind not null default 'text',
  body text,
  media_path text,
  media_mime text,
  media_name text,
  media_size bigint,
  media_duration integer,
  media_status text check (media_status in ('pending', 'ready', 'failed')),
  quoted_wa_id text,
  status public.message_status,
  error text,
  edited_at timestamptz,
  deleted_at timestamptz,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint messages_note_has_ticket check (not is_note or ticket_id is not null)
);

create index if not exists messages_ticket_idx on public.messages (ticket_id, sent_at);
create index if not exists messages_group_idx on public.messages (group_jid, sent_at desc);
create index if not exists messages_contact_idx on public.messages (contact_id, sent_at desc);
create index if not exists messages_quoted_idx on public.messages (quoted_wa_id) where quoted_wa_id is not null;

alter table public.messages enable row level security;
drop policy if exists "messages: membros leem" on public.messages;
create policy "messages: membros leem"
  on public.messages for select to authenticated
  using ((select public.is_active_member()));

-- -----------------------------------------------------------------------------
-- Reações: uma por reator por mensagem. A conta conectada é o reator 'me'.
-- -----------------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  reactor_key text not null,
  contact_id uuid references public.contacts (id) on delete set null,
  author_id uuid references public.profiles (id) on delete set null,
  reactor_name text,
  emoji text not null,
  reacted_at timestamptz not null default now(),
  primary key (message_id, reactor_key)
);

alter table public.message_reactions enable row level security;
drop policy if exists "message_reactions: membros leem" on public.message_reactions;
create policy "message_reactions: membros leem"
  on public.message_reactions for select to authenticated
  using ((select public.is_active_member()));

-- -----------------------------------------------------------------------------
-- Histórico do atendimento (auditoria e base das métricas futuras)
-- -----------------------------------------------------------------------------
create table if not exists public.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  type text not null check (type in (
    'opened', 'reopened', 'assigned', 'unassigned', 'closed', 'merged', 'message_moved'
  )),
  actor_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

alter table public.ticket_events enable row level security;
drop policy if exists "ticket_events: membros leem" on public.ticket_events;
create policy "ticket_events: membros leem"
  on public.ticket_events for select to authenticated
  using ((select public.is_active_member()));

-- =============================================================================
-- Funções (só service role executa)
-- =============================================================================

-- Une dois contatos que eram a mesma pessoa (telefone numa linha, @lid na outra).
create or replace function public.merge_contacts(p_source uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.contacts;
begin
  if p_source = p_target then return; end if;
  select * into v_src from public.contacts where id = p_source for update;
  if not found then return; end if;

  insert into public.group_members (group_jid, contact_id, is_admin, joined_at, left_at)
  select group_jid, p_target, is_admin, joined_at, left_at
  from public.group_members where contact_id = p_source
  on conflict (group_jid, contact_id) do nothing;
  delete from public.group_members where contact_id = p_source;

  update public.tickets set contact_id = p_target where contact_id = p_source;
  update public.messages set contact_id = p_target where contact_id = p_source;
  update public.message_reactions set contact_id = p_target where contact_id = p_source;

  -- Libera as chaves únicas antes de copiá-las para o destino.
  delete from public.contacts where id = p_source;

  update public.contacts c set
    phone = coalesce(c.phone, v_src.phone),
    lid = coalesce(c.lid, v_src.lid),
    name = coalesce(c.name, v_src.name),
    company_id = coalesce(c.company_id, v_src.company_id),
    kind = case when c.kind = 'customer' then v_src.kind else c.kind end,
    strikes = greatest(c.strikes, v_src.strikes),
    message_count = c.message_count + v_src.message_count,
    first_seen_at = least(c.first_seen_at, v_src.first_seen_at),
    last_message_at = greatest(c.last_message_at, v_src.last_message_at)
  where c.id = p_target;
end;
$$;

-- Acha ou cria o contato por telefone e/ou @lid (só dígitos). Serializado por
-- lock: o volume das comunidades é baixo e isso elimina corridas de duplicação.
create or replace function public.upsert_contact(p_phone text, p_lid text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by_phone uuid;
  v_by_lid uuid;
  v_id uuid;
  v_name text := nullif(trim(p_name), '');
begin
  -- Identificador fora do formato é descartado (em vez de derrubar a mensagem).
  if p_phone !~ '^[0-9]{6,20}$' then p_phone := null; end if;
  if p_lid !~ '^[0-9]{6,30}$' then p_lid := null; end if;
  if p_phone is null and p_lid is null then
    raise exception 'upsert_contact: informe telefone ou lid válidos';
  end if;

  perform pg_advisory_xact_lock(hashtext('crazypanel:upsert_contact'));

  if p_phone is not null then
    select id into v_by_phone from public.contacts where phone = p_phone;
  end if;
  if p_lid is not null then
    select id into v_by_lid from public.contacts where lid = p_lid;
  end if;

  if v_by_phone is not null and v_by_lid is not null and v_by_phone <> v_by_lid then
    perform public.merge_contacts(v_by_lid, v_by_phone);
    v_id := v_by_phone;
  else
    v_id := coalesce(v_by_phone, v_by_lid);
  end if;

  if v_id is null then
    insert into public.contacts (phone, lid, name)
    values (p_phone, p_lid, v_name)
    returning id into v_id;
  else
    update public.contacts set
      phone = coalesce(phone, p_phone),
      lid = coalesce(lid, p_lid),
      name = coalesce(v_name, name)
    where id = v_id;
  end if;

  return v_id;
end;
$$;

-- Texto curto para cards e listas.
create or replace function public.message_preview(p_kind public.message_kind, p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(nullif(trim(p_body), ''), case p_kind
    when 'image' then 'Imagem'
    when 'video' then 'Vídeo'
    when 'audio' then 'Áudio'
    when 'document' then 'Documento'
    when 'sticker' then 'Figurinha'
    when 'location' then 'Localização'
    when 'contact' then 'Contato'
    when 'poll' then 'Enquete'
    else 'Mensagem'
  end), 280);
$$;

-- Recebe uma mensagem de grupo escutado e decide o atendimento, tudo numa
-- transação. Regras:
--  1. Cita mensagem de um atendimento:
--     - do próprio autor e aberto: entra nele (aguardando resposta);
--     - do próprio autor e finalizado há pouco: reabre;
--     - de outra pessoa e aberto: entra como contexto (não mexe no SLA);
--     - da equipe: conta como resposta.
--  2. Sem citação: entra no atendimento aberto do autor naquele grupo, ou abre um.
--  3. Equipe (ou a própria conta, pelo celular) sem citação não abre atendimento.
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
  v_preview text := public.message_preview(p_kind, p_body);
  v_created boolean := false;
  v_reopened boolean := false;
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

  -- Serializa o roteamento por autor e grupo (evita dois atendimentos abertos
  -- quando o lead manda várias mensagens seguidas).
  perform pg_advisory_xact_lock(hashtext('crazypanel:route:' || p_group_jid || ':' || coalesce(v_contact_id::text, 'me')));

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
    if v_q_ticket.id is not null then
      if v_q_ticket.contact_id = v_contact_id then
        if v_q_ticket.status = 'open' then
          v_ticket_id := v_q_ticket.id;
          v_is_lead_message := true;
        else
          select reopen_window_hours into v_reopen_hours from public.app_settings where id = 1;
          if v_q_ticket.closed_at > now() - make_interval(hours => coalesce(v_reopen_hours, 24)) then
            update public.tickets set
              status = 'open', closed_at = null, closed_by = null,
              close_reason = null, close_note = null
            where id = v_q_ticket.id;
            insert into public.ticket_events (ticket_id, type, data)
            values (v_q_ticket.id, 'reopened', jsonb_build_object('message_id', v_message_id));
            v_ticket_id := v_q_ticket.id;
            v_is_lead_message := true;
            v_reopened := true;
          end if;
        end if;
      elsif v_q_ticket.status = 'open' then
        -- Outra pessoa da comunidade respondendo: contexto do atendimento.
        v_ticket_id := v_q_ticket.id;
      end if;
    end if;

    if v_ticket_id is null then
      select id into v_ticket_id
      from public.tickets
      where group_jid = p_group_jid and contact_id = v_contact_id and status = 'open'
      order by last_message_at desc
      limit 1;
      v_is_lead_message := true;
    end if;

    if v_ticket_id is null then
      insert into public.tickets (group_jid, contact_id, subject, opened_at, last_message_at)
      values (p_group_jid, v_contact_id, v_preview, p_sent_at, p_sent_at)
      returning id into v_ticket_id;
      insert into public.ticket_events (ticket_id, type, data)
      values (v_ticket_id, 'opened', jsonb_build_object('message_id', v_message_id));
      v_created := true;
    end if;
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
    'duplicate', false
  );
end;
$$;

-- Resposta enviada pelo painel: pausa o SLA e assume o atendimento se ninguém
-- estava com ele.
create or replace function public.register_ticket_reply(
  p_ticket_id uuid,
  p_author_id uuid,
  p_preview text,
  p_sent_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
begin
  select assignee_id into v_previous from public.tickets where id = p_ticket_id for update;

  update public.tickets set
    waiting_since = null,
    first_response_at = coalesce(first_response_at, p_sent_at),
    assignee_id = coalesce(assignee_id, p_author_id),
    last_message_at = greatest(last_message_at, p_sent_at),
    last_message_preview = left(p_preview, 280),
    message_count = message_count + 1
  where id = p_ticket_id;

  if v_previous is null then
    insert into public.ticket_events (ticket_id, type, actor_id, data)
    values (p_ticket_id, 'assigned', p_author_id, jsonb_build_object('assignee_id', p_author_id, 'auto', true));
  end if;
end;
$$;

-- "Puxar próximo da fila": o atendimento sem responsável esperando há mais
-- tempo. skip locked evita que dois atendentes peguem o mesmo.
create or replace function public.claim_next_ticket(p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.tickets
  where status = 'open' and assignee_id is null and waiting_since is not null
  order by waiting_since asc
  limit 1
  for update skip locked;

  if v_id is null then return null; end if;

  update public.tickets set assignee_id = p_profile_id where id = v_id;
  insert into public.ticket_events (ticket_id, type, actor_id, data)
  values (v_id, 'assigned', p_profile_id, jsonb_build_object('assignee_id', p_profile_id, 'claimed', true));
  return v_id;
end;
$$;

-- Recibos: o status só avança, nunca regride (eventos chegam fora de ordem).
create or replace function public.advance_message_status(p_wa_ids text[], p_status public.message_status)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.messages
    set status = p_status
    where wa_id = any(p_wa_ids)
      and from_me
      and (status is null or (status < p_status and status <> 'failed'))
    returning 1
  )
  select count(*)::integer from updated;
$$;

-- Sincroniza os membros de um grupo a partir do /group/info, numa chamada.
-- p_members: [{ "phone": "5511...", "lid": "1234...", "name": "...", "is_admin": true }]
-- Quem não está mais na lista recebe left_at.
create or replace function public.sync_group_members(p_group_jid text, p_members jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member jsonb;
  v_contact uuid;
  v_seen uuid[] := '{}';
begin
  for v_member in select * from jsonb_array_elements(p_members) loop
    if coalesce(v_member ->> 'phone', v_member ->> 'lid') is null then continue; end if;
    begin
      v_contact := public.upsert_contact(
        nullif(v_member ->> 'phone', ''),
        nullif(v_member ->> 'lid', ''),
        nullif(v_member ->> 'name', '')
      );
    exception when others then
      -- Um participante com dados inválidos não impede a sincronização dos demais.
      raise warning 'sync_group_members: participante ignorado (%): %', v_member, sqlerrm;
      continue;
    end;
    insert into public.group_members (group_jid, contact_id, is_admin, left_at)
    values (p_group_jid, v_contact, coalesce((v_member ->> 'is_admin')::boolean, false), null)
    on conflict (group_jid, contact_id) do update set is_admin = excluded.is_admin, left_at = null;
    v_seen := v_seen || v_contact;
  end loop;

  update public.group_members set left_at = now()
  where group_jid = p_group_jid and left_at is null and not (contact_id = any(v_seen));

  update public.wa_groups set member_count = cardinality(v_seen), members_synced_at = now()
  where jid = p_group_jid;

  return cardinality(v_seen);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sync_group_members(text, jsonb)',
    'public.merge_contacts(uuid, uuid)',
    'public.upsert_contact(text, text, text)',
    'public.ingest_group_message(text, text, text, text, text, boolean, public.message_kind, text, boolean, text, text, integer, text, timestamptz)',
    'public.register_ticket_reply(uuid, uuid, text, timestamptz)',
    'public.claim_next_ticket(uuid)',
    'public.advance_message_status(text[], public.message_status)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =============================================================================
-- Realtime
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['tickets', 'messages', 'message_reactions', 'ticket_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- Storage: mídias recebidas e enviadas (bucket privado). O navegador sobe por
-- URL assinada e lê por /api/media/:id, então nenhuma policy é necessária.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 104857600)
on conflict (id) do nothing;
