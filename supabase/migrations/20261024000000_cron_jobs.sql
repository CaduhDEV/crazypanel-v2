-- =============================================================================
-- Rotinas frequentes agendadas no próprio Supabase (pg_cron + pg_net)
-- =============================================================================
-- O plano grátis da Vercel só roda cron 1x por dia. As rotinas que precisam de
-- mais (pedidos de entrada, chamados do Gleap, relatório) são chamadas daqui,
-- com o mesmo cabeçalho que a Vercel mandaria: Authorization: Bearer <CRON_SECRET>.
--
-- O endereço do painel e o segredo ficam no Vault (nunca no código, o repositório
-- é público). Cadastre uma vez, no SQL Editor:
--   select vault.create_secret('https://SEU-DOMINIO', 'crazypanel_url');
--   select vault.create_secret('<CRON_SECRET da Vercel>', 'crazypanel_cron_secret');
-- Sem os dois, as rotinas não chamam nada (e não dão erro).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_panel_cron(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'crazypanel_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'crazypanel_cron_secret';
  if v_url is null or v_secret is null then return; end if;

  perform net.http_get(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.call_panel_cron(text) from public, anon, authenticated;

-- Reagenda sem duplicar (cron.schedule com o mesmo nome substitui).
select cron.schedule('crazypanel-join-requests', '*/5 * * * *', $$select public.call_panel_cron('/api/cron/join-requests')$$);
select cron.schedule('crazypanel-gleap-tickets', '*/10 * * * *', $$select public.call_panel_cron('/api/cron/gleap-tickets')$$);
select cron.schedule('crazypanel-report', '0 * * * *', $$select public.call_panel_cron('/api/cron/report')$$);
