-- =============================================================================
-- Equipe pelo domínio do e-mail
-- =============================================================================
-- Lead com e-mail da DataCrazy é equipe: não abre atendimento e conta como
-- resposta da equipe quando cita uma mensagem. Vale para o e-mail do próprio
-- lead e para o do usuário do Gleap com o mesmo telefone. A empresa vinculada
-- continua (equipe pode ter empresa).

create table if not exists public.team_email_domains (
  domain text primary key check (domain = lower(domain))
);

insert into public.team_email_domains (domain)
values ('datacrazy.io'), ('datacrazy.com.br')
on conflict do nothing;

alter table public.team_email_domains enable row level security;
-- Sem policies: só service role e funções security definer.

create or replace function public.is_team_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_email is not null and exists (
    select 1 from public.team_email_domains d
    where d.domain = lower(split_part(trim(p_email), '@', 2))
  );
$$;

-- E-mail novo ou alterado: se for da equipe, o lead vira equipe.
create or replace function public.contacts_team_by_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'team' and public.is_team_email(new.email) then
    new.kind := 'team';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_team_by_email on public.contacts;
create trigger contacts_team_by_email
  before insert or update of email on public.contacts
  for each row execute function public.contacts_team_by_email();

-- Varredura: e-mail do próprio lead ou de um usuário do Gleap com o mesmo
-- telefone. Roda na importação do Gleap; devolve quantos viraram equipe.
create or replace function public.mark_team_by_email()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.contacts c set kind = 'team'
  where c.kind <> 'team'
    and (
      public.is_team_email(c.email)
      or (
        c.phone_key is not null
        and exists (
          select 1 from public.gleap_leads g
          where g.phone_key = c.phone_key and public.is_team_email(g.email)
        )
      )
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.is_team_email(text) from public, anon, authenticated;
revoke all on function public.contacts_team_by_email() from public, anon, authenticated;
revoke all on function public.mark_team_by_email() from public, anon, authenticated;
grant execute on function public.mark_team_by_email() to service_role;

-- Estado inicial.
select public.mark_team_by_email();
