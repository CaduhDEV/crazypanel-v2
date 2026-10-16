-- =============================================================================
-- Logs de conexão do WhatsApp e alertas no Discord
-- =============================================================================

-- Cada mudança de status da instância vira uma linha, venha de onde vier
-- (evento do webhook, consulta de status, conectar/desconectar pelo painel).
create table if not exists public.connection_logs (
  id bigint generated always as identity primary key,
  status text not null,
  previous_status text,
  reason text,
  phone text,
  created_at timestamptz not null default now(),
  -- Alerta no Discord: null = ainda não avaliado; sent/skipped/failed depois.
  alert_status text check (alert_status in ('sent', 'skipped', 'failed')),
  alert_error text
);

create index if not exists connection_logs_created_idx on public.connection_logs (created_at desc);
create index if not exists connection_logs_pending_alert_idx on public.connection_logs (created_at) where alert_status is null;

alter table public.connection_logs enable row level security;
drop policy if exists "connection_logs: admins leem" on public.connection_logs;
create policy "connection_logs: admins leem"
  on public.connection_logs for select to authenticated
  using ((select public.is_admin()));

create or replace function public.log_connection_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.connection_logs (status, previous_status, reason, phone)
  values (new.status, old.status, new.last_disconnect_reason, coalesce(new.phone, old.phone));
  return new;
end;
$$;

drop trigger if exists whatsapp_instance_connection_log on public.whatsapp_instance;
create trigger whatsapp_instance_connection_log
  after update of status on public.whatsapp_instance
  for each row when (old.status is distinct from new.status)
  execute function public.log_connection_change();

revoke all on function public.log_connection_change() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Configuração dos alertas (só o servidor lê: a URL do webhook é um segredo)
-- -----------------------------------------------------------------------------
create table if not exists public.alert_settings (
  id smallint primary key default 1 check (id = 1),
  -- URL do webhook do Discord criptografada (AES-256-GCM, APP_ENCRYPTION_KEY).
  discord_webhook_encrypted text,
  discord_webhook_hint text,
  -- Texto antes do embed, ex.: @here ou <@&id-do-cargo>.
  discord_mention text,
  notify_disconnect boolean not null default true,
  notify_reconnect boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.alert_settings (id) values (1) on conflict do nothing;
alter table public.alert_settings enable row level security;
-- Sem policies: lida e gravada apenas pelo servidor (service role).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'connection_logs'
  ) then
    alter publication supabase_realtime add table public.connection_logs;
  end if;
end $$;
