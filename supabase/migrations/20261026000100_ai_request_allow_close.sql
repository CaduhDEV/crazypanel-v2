-- Envio de teste (botão "Classificar com IA" na conversa): o retorno só deixa a
-- sugestão, nunca encerra o atendimento.
alter table public.ai_classification_requests
  add column if not exists allow_close boolean not null default true;
