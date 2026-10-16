-- =============================================================================
-- Notificações do navegador (definidas pelo admin, iguais para a equipe)
-- =============================================================================
-- Textos aceitam variáveis: {lead}, {empresa}, {grupo}, {mensagem}, {numero}.

alter table public.app_settings
  add column if not exists push_enabled boolean not null default true,
  add column if not exists push_sound boolean not null default true,
  add column if not exists push_new_title text not null default 'Novo atendimento · {grupo}'
    check (length(push_new_title) between 1 and 120),
  add column if not exists push_new_body text not null default '{lead}: {mensagem}'
    check (length(push_new_body) between 1 and 300),
  add column if not exists push_breach_title text not null default 'SLA estourado · #{numero}'
    check (length(push_breach_title) between 1 and 120),
  add column if not exists push_breach_body text not null default '{lead} está esperando resposta em {grupo}.'
    check (length(push_breach_body) between 1 and 300);
