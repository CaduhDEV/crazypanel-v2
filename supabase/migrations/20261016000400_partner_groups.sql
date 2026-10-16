-- =============================================================================
-- Grupos de parceiros
-- =============================================================================
-- Hierarquia do tipo do lead: equipe > parceiro > cliente.
-- Quem está num grupo marcado como "de parceiros" vira parceiro, a não ser que
-- já seja equipe. Só promove cliente: nunca rebaixa equipe nem desfaz parceiro
-- (sair do grupo não volta a cliente; isso fica a cargo do admin).

alter table public.wa_groups
  add column if not exists is_partner_group boolean not null default false;

-- O grupo de parceiros que já existe.
update public.wa_groups set is_partner_group = true
where name ilike '%partners crazy%' and not is_partner_group;

-- Promove os clientes ativos nos grupos de parceiros (todos, ou de um grupo).
create or replace function public.apply_partner_groups(p_group_jid text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.contacts c set kind = 'partner'
  where c.kind = 'customer'
    and exists (
      select 1
      from public.group_members gm
      join public.wa_groups g on g.jid = gm.group_jid and g.is_partner_group
      where gm.contact_id = c.id and gm.left_at is null
        and (p_group_jid is null or gm.group_jid = p_group_jid)
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Entrou (ou voltou) num grupo de parceiros: cliente vira parceiro.
create or replace function public.group_members_partner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.left_at is null and exists (
    select 1 from public.wa_groups g where g.jid = new.group_jid and g.is_partner_group
  ) then
    update public.contacts set kind = 'partner' where id = new.contact_id and kind = 'customer';
  end if;
  return null;
end;
$$;

drop trigger if exists group_members_partner on public.group_members;
create trigger group_members_partner
  after insert or update of left_at on public.group_members
  for each row execute function public.group_members_partner();

-- Grupo marcado como de parceiros: aplica a todos os membros dele.
create or replace function public.wa_groups_partner_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.apply_partner_groups(new.jid);
  return null;
end;
$$;

drop trigger if exists wa_groups_partner_flag on public.wa_groups;
create trigger wa_groups_partner_flag
  after update of is_partner_group on public.wa_groups
  for each row when (new.is_partner_group and not old.is_partner_group)
  execute function public.wa_groups_partner_flag();

revoke all on function public.apply_partner_groups(text) from public, anon, authenticated;
revoke all on function public.group_members_partner() from public, anon, authenticated;
revoke all on function public.wa_groups_partner_flag() from public, anon, authenticated;
grant execute on function public.apply_partner_groups(text) to service_role;

-- Estado inicial.
select public.apply_partner_groups();
