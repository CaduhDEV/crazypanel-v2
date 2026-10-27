-- =============================================================================
-- Mídias recebidas: novas tentativas
-- =============================================================================
-- Logo depois do evento, a uazapi às vezes ainda não tem o arquivo (ou a rede
-- oscila). Antes, 3 tentativas em ~9 s e a mídia ficava "falhou" para sempre.
-- Agora a rotina tenta de novo a cada 5 min, enquanto a uazapi guarda o arquivo
-- (2 dias), e o motivo da última falha fica em media_error.

alter table public.messages
  add column if not exists media_attempts integer not null default 0,
  add column if not exists media_error text check (length(media_error) <= 300);

-- Falhou, ou ficou "baixando" (a função foi encerrada no meio do download).
create index if not exists messages_media_retry_idx on public.messages (sent_at)
  where media_status in ('failed', 'pending');

select cron.schedule('crazypanel-media-retry', '*/5 * * * *', $$select public.call_panel_cron('/api/cron/media-retry')$$);
