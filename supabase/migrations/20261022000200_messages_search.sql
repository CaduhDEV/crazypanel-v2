-- =============================================================================
-- Página de mensagens (Admin → Mensagens): busca no texto e ordem por data
-- =============================================================================
-- Trigram deixa o "contém" (ilike '%termo%') rápido nas dezenas de milhares de
-- mensagens; o índice por data serve a lista geral, da mais recente para trás.

create extension if not exists pg_trgm with schema extensions;

create index if not exists messages_body_trgm_idx
  on public.messages using gin (body extensions.gin_trgm_ops);

create index if not exists messages_sender_name_trgm_idx
  on public.messages using gin (sender_name extensions.gin_trgm_ops);

create index if not exists messages_sent_idx
  on public.messages (sent_at desc, id desc);
