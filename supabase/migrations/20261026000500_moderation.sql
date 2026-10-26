-- =============================================================================
-- Moderação: flags (advertências), inaptos e remoção da comunidade
-- =============================================================================
-- contacts.strikes já existia (advertências do sistema antigo): passa a ser o
-- número de flags. Com mod_strike_limit flags (3), o lead fica inapto.
-- Mensagens no privado: advertência e expulsão. Mensagem vazia = não envia
-- (vale também para as de entrada na comunidade).

-- Mensagens de entrada podem ficar vazias (desligadas).
alter table public.app_settings drop constraint if exists app_settings_join_msg_no_company_check;
alter table public.app_settings drop constraint if exists app_settings_join_msg_rejected_check;
alter table public.app_settings drop constraint if exists app_settings_join_msg_accepted_check;
alter table public.app_settings add constraint app_settings_join_msg_no_company_check check (length(join_msg_no_company) <= 1000);
alter table public.app_settings add constraint app_settings_join_msg_rejected_check check (length(join_msg_rejected) <= 1000);
alter table public.app_settings add constraint app_settings_join_msg_accepted_check check (length(join_msg_accepted) <= 1000);

alter table public.app_settings
  add column if not exists mod_strike_limit integer not null default 3 check (mod_strike_limit between 1 and 10),
  add column if not exists mod_msg_warning text not null default
    'Olá, {nome}. Você recebeu uma advertência na comunidade DataCrazy por não seguir as diretrizes do grupo. Motivo: {motivo}. Você está com {flags} de {limite} advertências; ao chegar no limite, sua participação na comunidade será suspensa.'
    check (length(mod_msg_warning) <= 1000),
  add column if not exists mod_msg_removed text not null default
    'Olá, {nome}. Você foi removido(a) da comunidade DataCrazy por violar as diretrizes do grupo. Motivo: {motivo}.'
    check (length(mod_msg_removed) <= 1000);

-- Removido da comunidade pela moderação (left_community_at diz só que saiu).
alter table public.contacts add column if not exists removed_from_community_at timestamptz;
create index if not exists contacts_strikes_idx on public.contacts (strikes desc) where strikes > 0;

-- Histórico de moderação de cada lead.
create table if not exists public.moderation_events (
  id bigint generated always as identity primary key,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  type text not null check (type in ('flag_added', 'flag_removed', 'removed', 'note')),
  reason text check (length(reason) <= 500),
  strikes_after integer,
  -- Mensagem no privado: enviada, desligada (template vazio), sem telefone ou falhou.
  message text check (message in ('sent', 'disabled', 'no_phone', 'failed')),
  actor_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists moderation_events_contact_idx on public.moderation_events (contact_id, created_at desc);
create index if not exists moderation_events_created_idx on public.moderation_events (created_at desc);

alter table public.moderation_events enable row level security;
drop policy if exists "moderation_events: admins leem" on public.moderation_events;
create policy "moderation_events: admins leem"
  on public.moderation_events for select to authenticated
  using ((select public.is_admin()));

-- Soma ou tira flags sem corrida (dois admins ao mesmo tempo). Nunca abaixo de 0.
create or replace function public.moderation_adjust_strikes(p_contact_id uuid, p_delta integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.contacts set strikes = greatest(0, strikes + p_delta)
  where id = p_contact_id
  returning strikes;
$$;

revoke all on function public.moderation_adjust_strikes(uuid, integer) from public, anon, authenticated;
grant execute on function public.moderation_adjust_strikes(uuid, integer) to service_role;
