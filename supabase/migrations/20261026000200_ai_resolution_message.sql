-- A IA aponta a mensagem que resolveu a dúvida (resolution_message_id): fica na
-- sugestão do atendimento e, se a IA encerrar, vira a "mensagem que resolveu".
alter table public.tickets
  add column if not exists ai_resolution_message_id uuid references public.messages (id) on delete set null;
