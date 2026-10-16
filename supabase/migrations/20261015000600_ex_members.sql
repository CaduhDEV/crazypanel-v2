-- =============================================================================
-- Ex-membros: leads que já estiveram em alguma comunidade (grupo escutado) e
-- não estão mais em nenhuma.
-- =============================================================================
-- left_community_at é mantido pelo trigger em group_members, que reage tanto ao
-- evento de saída da uazapi quanto à sincronização de membros (quem sumiu da
-- lista recebe left_at). Voltar para qualquer comunidade limpa a marca.

alter table public.contacts
  add column if not exists left_community_at timestamptz;

create index if not exists contacts_left_community_idx
  on public.contacts (left_community_at desc) where left_community_at is not null;

create or replace function public.refresh_contact_community(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_last_left timestamptz;
begin
  select
    bool_or(gm.left_at is null),
    max(gm.left_at)
  into v_active, v_last_left
  from public.group_members gm
  join public.wa_groups g on g.jid = gm.group_jid and g.listening
  where gm.contact_id = p_contact_id;

  update public.contacts set
    left_community_at = case
      when v_active is null or v_active then null      -- nunca esteve ou ainda está
      else coalesce(left_community_at, v_last_left)     -- mantém a data da primeira saída definitiva
    end
  where id = p_contact_id
    and left_community_at is distinct from case
      when v_active is null or v_active then null
      else coalesce(left_community_at, v_last_left)
    end;
end;
$$;

create or replace function public.group_members_refresh_community()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_contact_community(coalesce(new.contact_id, old.contact_id));
  return null;
end;
$$;

drop trigger if exists group_members_community on public.group_members;
create trigger group_members_community
  after insert or delete or update of left_at on public.group_members
  for each row execute function public.group_members_refresh_community();

-- Ligar/desligar a escuta de um grupo muda quem conta como comunidade.
create or replace function public.wa_groups_refresh_community()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_contact_community(gm.contact_id)
  from public.group_members gm
  where gm.group_jid = new.jid;
  return null;
end;
$$;

drop trigger if exists wa_groups_community on public.wa_groups;
create trigger wa_groups_community
  after update of listening on public.wa_groups
  for each row when (old.listening is distinct from new.listening)
  execute function public.wa_groups_refresh_community();

revoke all on function public.refresh_contact_community(uuid) from public, anon, authenticated;
revoke all on function public.group_members_refresh_community() from public, anon, authenticated;
revoke all on function public.wa_groups_refresh_community() from public, anon, authenticated;

-- Estado inicial para quem já saiu.
select public.refresh_contact_community(c.id)
from public.contacts c
where exists (select 1 from public.group_members gm where gm.contact_id = c.id and gm.left_at is not null);
