-- =============================================================================
-- Importação do sistema antigo (groups / Evolution)
-- =============================================================================
-- Só texto (e legendas). Idempotente: atendimentos por legacy_id, mensagens
-- por wa_id (o mesmo id do WhatsApp nos dois sistemas). Script:
-- scripts/legacy-import/run.mts.

alter table public.tickets
  add column if not exists legacy_id text unique,
  add column if not exists legacy jsonb;

alter table public.messages
  add column if not exists legacy_id text;

create index if not exists messages_legacy_idx on public.messages (legacy_id) where legacy_id is not null;

create table if not exists public.legacy_import_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  dry_run boolean not null default false,
  counts jsonb not null default '{}'::jsonb,
  error text
);

alter table public.legacy_import_runs enable row level security;

-- -----------------------------------------------------------------------------
-- Contatos em lote: [{key, phone, lid, name}] → (key, contact_id)
-- -----------------------------------------------------------------------------
-- Igual ao upsert_contact, com duas diferenças: não sobrescreve o nome (o push
-- name antigo não vence o atual) e, sem o número exato, casa pelo phone_key
-- (mesmo número com/sem o 9º dígito) quando há um único candidato.
create or replace function public.legacy_import_contacts(p_rows jsonb)
returns table (key text, contact_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_phone text;
  v_lid text;
  v_name text;
  v_by_phone uuid;
  v_by_lid uuid;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('crazypanel:upsert_contact'));

  for r in select * from jsonb_array_elements(p_rows) loop
    v_phone := nullif(r->>'phone', '');
    v_lid := nullif(r->>'lid', '');
    v_name := nullif(trim(r->>'name'), '');
    if v_phone !~ '^[0-9]{6,20}$' then v_phone := null; end if;
    if v_lid !~ '^[0-9]{6,30}$' then v_lid := null; end if;
    if v_phone is null and v_lid is null then continue; end if;

    v_by_phone := null;
    v_by_lid := null;
    v_id := null;

    if v_phone is not null then
      select c.id into v_by_phone from public.contacts c where c.phone = v_phone;
      if v_by_phone is null then
        select (array_agg(c.id))[1] into v_by_phone
        from public.contacts c
        where c.phone_key = public.phone_key(v_phone)
        having count(*) = 1;
      end if;
    end if;
    if v_lid is not null then
      select c.id into v_by_lid from public.contacts c where c.lid = v_lid;
    end if;

    if v_by_phone is not null and v_by_lid is not null and v_by_phone <> v_by_lid then
      perform public.merge_contacts(v_by_lid, v_by_phone);
      v_id := v_by_phone;
    else
      v_id := coalesce(v_by_phone, v_by_lid);
    end if;

    if v_id is null then
      insert into public.contacts (phone, lid, name)
      values (v_phone, v_lid, v_name)
      returning id into v_id;
    else
      update public.contacts c set
        phone = coalesce(c.phone, v_phone),
        lid = coalesce(c.lid, v_lid),
        name = coalesce(c.name, v_name)
      where c.id = v_id;
    end if;

    key := r->>'key';
    contact_id := v_id;
    return next;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agregados depois da importação (contagens e últimas mensagens)
-- -----------------------------------------------------------------------------
create or replace function public.legacy_refresh_aggregates()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tickets integer;
  v_contacts integer;
  v_groups integer;
begin
  with s as (
    select m.ticket_id,
      count(*) filter (where not m.is_note) as n,
      max(m.sent_at) as last_at,
      max(m.sent_at) filter (where not m.from_me and not m.is_note) as last_customer,
      (array_agg(public.message_preview(m.kind, m.body) order by m.sent_at desc) filter (where not m.is_note))[1] as preview
    from public.messages m
    join public.tickets t on t.id = m.ticket_id
    where t.legacy_id is not null
    group by m.ticket_id
  )
  update public.tickets t set
    message_count = s.n,
    last_message_at = coalesce(s.last_at, t.last_message_at),
    last_customer_message_at = s.last_customer,
    last_message_preview = left(s.preview, 280)
  from s
  where s.ticket_id = t.id
    and (t.message_count is distinct from s.n or t.last_message_at is distinct from coalesce(s.last_at, t.last_message_at));
  get diagnostics v_tickets = row_count;

  with s as (
    select m.contact_id, count(*) as n, min(m.sent_at) as first_at, max(m.sent_at) as last_at
    from public.messages m
    where m.contact_id is not null and not m.from_me
    group by m.contact_id
  )
  update public.contacts c set
    message_count = s.n,
    first_seen_at = least(c.first_seen_at, s.first_at),
    last_message_at = greatest(coalesce(c.last_message_at, s.last_at), s.last_at)
  from s
  where s.contact_id = c.id
    and (c.message_count is distinct from s.n or c.first_seen_at > s.first_at or c.last_message_at is null or c.last_message_at < s.last_at);
  get diagnostics v_contacts = row_count;

  update public.wa_groups g set last_message_at = s.last_at
  from (select m.group_jid, max(m.sent_at) as last_at from public.messages m group by m.group_jid) s
  where s.group_jid = g.jid and (g.last_message_at is null or g.last_message_at < s.last_at);
  get diagnostics v_groups = row_count;

  return jsonb_build_object('tickets', v_tickets, 'contacts', v_contacts, 'groups', v_groups);
end;
$$;

revoke all on function public.legacy_import_contacts(jsonb) from public, anon, authenticated;
revoke all on function public.legacy_refresh_aggregates() from public, anon, authenticated;
grant execute on function public.legacy_import_contacts(jsonb) to service_role;
grant execute on function public.legacy_refresh_aggregates() to service_role;
