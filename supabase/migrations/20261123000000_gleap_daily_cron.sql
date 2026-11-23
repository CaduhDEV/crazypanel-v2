-- =============================================================================
-- Rotina diária do Gleap no pg_cron
-- =============================================================================
-- Rodava pelo cron da hospedagem (vercel.json). Agora fica junto das outras
-- rotinas no pg_cron: todo dia às 9h UTC (6h em Brasília).

select cron.schedule('crazypanel-gleap', '0 9 * * *', $$select public.call_panel_cron('/api/cron/gleap')$$);
