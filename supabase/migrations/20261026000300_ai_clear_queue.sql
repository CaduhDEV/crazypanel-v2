-- "Limpar fila" com a IA: cada atendimento vai para o agente e é finalizado
-- quando a classificação volta (como "Fila limpa pelo admin", já com categoria).
-- Sem resposta em 15 min, a rotina finaliza sem categoria.
alter table public.ai_classification_requests
  add column if not exists close_on_return boolean not null default false;

create index if not exists ai_requests_clear_idx on public.ai_classification_requests (sent_at)
  where close_on_return and status in ('sent', 'rejected', 'failed');

-- A rotina que fecha o que ficou para trás roda a cada 5 min (a de classificar segue a cada 30).
select cron.schedule('crazypanel-ai-clear-timeout', '*/5 * * * *', $$select public.call_panel_cron('/api/cron/ai-classify?so=limpeza')$$);
