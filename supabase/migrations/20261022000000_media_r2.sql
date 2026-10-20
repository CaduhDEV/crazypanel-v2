-- =============================================================================
-- Mídias no Cloudflare R2
-- =============================================================================
-- As mídias novas (recebidas, enviadas) e os PDFs do relatório vão para o R2
-- (bucket privado, prefixo R2_PREFIX). media_path continua sendo o caminho
-- relativo (in|out/AAAA/MM/<id>.<ext>); media_store diz onde o arquivo está.
-- As linhas antigas seguem no Supabase até o backfill (scripts/media-to-r2.mts).

alter table public.messages
  add column if not exists media_store text not null default 'supabase'
    check (media_store in ('supabase', 'r2'));

alter table public.reports
  add column if not exists file_store text not null default 'supabase'
    check (file_store in ('supabase', 'r2'));

-- Daqui em diante, o padrão é o R2 (linhas existentes ficam como 'supabase').
alter table public.messages alter column media_store set default 'r2';
alter table public.reports alter column file_store set default 'r2';
