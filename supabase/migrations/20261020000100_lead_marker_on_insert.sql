-- =============================================================================
-- Lead reconhecido já no INSERT do Auth
-- =============================================================================
-- O GoTrue insere o usuário e só depois grava o app_metadata personalizado, então
-- na hora dos triggers de INSERT a marca ainda não existe. O lead passa a ser
-- reconhecido também por raw_user_meta_data.kind = 'lead'. É seguro: quem se
-- marcar como lead sozinho só ganha um usuário SEM perfil, e sem perfil o painel
-- não abre (requireMemberPage); a equipe continua passando pela regra de domínio.

create or replace function public.is_lead_user(p_app_meta jsonb, p_user_meta jsonb default '{}'::jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_app_meta ->> 'kind', '') = 'lead' or coalesce(p_user_meta ->> 'kind', '') = 'lead';
$$;

create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_lead_user(new.raw_app_meta_data, new.raw_user_meta_data) then
    return new;
  end if;
  if new.email is null or not exists (
    select 1
    from public.allowed_email_domains d
    where d.domain = lower(split_part(new.email, '@', 2))
  ) then
    raise exception 'E-mail fora do domínio permitido: %', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_lead_user(new.raw_app_meta_data, new.raw_user_meta_data) then
    return new;
  end if;
  insert into public.profiles (id, email, name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop function if exists public.is_lead_user(jsonb);
revoke all on function public.is_lead_user(jsonb, jsonb) from public, anon, authenticated;
