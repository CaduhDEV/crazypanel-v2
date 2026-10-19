-- =============================================================================
-- Excluir lead
-- =============================================================================
-- Os atendimentos dependem do lead (tickets.contact_id é obrigatório), então a
-- exclusão leva junto os atendimentos em que ele é o principal, com as mensagens
-- deles. Mensagens dele em atendimentos de outros leads ficam (sem autor);
-- solicitações e o log da comunidade perdem só a ligação (on delete set null).

create or replace function public.contact_deletion_impact(p_contact_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tickets', (select count(*) from public.tickets where contact_id = p_contact_id),
    'messages', (
      select count(*) from public.messages m
      where m.ticket_id in (select id from public.tickets where contact_id = p_contact_id)
    ),
    'groups', (select count(*) from public.group_members where contact_id = p_contact_id and left_at is null)
  );
$$;

create or replace function public.delete_contact(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_impact jsonb := public.contact_deletion_impact(p_contact_id);
  v_tickets uuid[];
begin
  if not exists (select 1 from public.contacts where id = p_contact_id) then
    raise exception 'lead não encontrado' using errcode = 'no_data_found';
  end if;

  select coalesce(array_agg(id), '{}') into v_tickets from public.tickets where contact_id = p_contact_id;

  -- Mensagens dos atendimentos dele (reações vão junto por cascade).
  delete from public.messages where ticket_id = any(v_tickets);
  -- Sugestões e participantes caem por cascade com o atendimento.
  delete from public.tickets where id = any(v_tickets);
  delete from public.contacts where id = p_contact_id;

  return v_impact;
end;
$$;

revoke all on function public.contact_deletion_impact(uuid) from public, anon, authenticated;
revoke all on function public.delete_contact(uuid) from public, anon, authenticated;
grant execute on function public.contact_deletion_impact(uuid) to service_role;
grant execute on function public.delete_contact(uuid) to service_role;
