-- Moderação por IA: as mensagens vão para o agente assim que chegam (webhook).
-- A rotina fica só como garantia, para reenviar o que falhou.
select cron.schedule('crazypanel-ai-moderate', '*/10 * * * *', $$select public.call_panel_cron('/api/cron/ai-moderate')$$);
