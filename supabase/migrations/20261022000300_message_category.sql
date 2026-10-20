-- =============================================================================
-- Categoria por mensagem
-- =============================================================================
-- A categoria nasce no atendimento, mas mensagens fora de atendimento (a maior
-- parte do histórico antigo) também precisam de assunto. Cada mensagem guarda
-- categoria/subcategoria e de onde veio:
--   atendimento → a do atendimento (mantida pelo gatilho abaixo)
--   regras      → categoria antiga + palavras-chave da própria mensagem
--   herdada     → resposta/contexto: o assunto da mensagem citada ou da conversa

alter table public.messages
  add column if not exists category text check (category in ('duvida', 'tecnico', 'comercial', 'comunidade')),
  add column if not exists topic text check (topic in (
    'funil', 'disparos', 'whatsapp', 'integracoes',
    'envio', 'instancia', 'tela',
    'upgrade', 'pagamento', 'cancelamento',
    'sugestao', 'elogio', 'offtopic'
  )),
  add column if not exists category_source text check (category_source in ('atendimento', 'regras', 'herdada'));

alter table public.messages drop constraint if exists messages_topic_matches_category;
alter table public.messages add constraint messages_topic_matches_category check (
  topic is null
  or (category = 'duvida' and topic in ('funil', 'disparos', 'whatsapp', 'integracoes'))
  or (category = 'tecnico' and topic in ('envio', 'instancia', 'tela'))
  or (category = 'comercial' and topic in ('upgrade', 'pagamento', 'cancelamento'))
  or (category = 'comunidade' and topic in ('sugestao', 'elogio', 'offtopic'))
);

create index if not exists messages_category_idx on public.messages (category, topic, sent_at desc) where category is not null;

-- Atendimento classificado (ao finalizar ou reclassificar): as mensagens dele seguem.
create or replace function public.tickets_propagate_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category is null then return new; end if;
  update public.messages set category = new.category, topic = new.topic, category_source = 'atendimento'
  where ticket_id = new.id
    and (category is distinct from new.category or topic is distinct from new.topic or category_source is distinct from 'atendimento');
  return new;
end;
$$;

drop trigger if exists tickets_propagate_category on public.tickets;
create trigger tickets_propagate_category
  after insert or update of category, topic on public.tickets
  for each row execute function public.tickets_propagate_category();

-- Lote do script de classificação: [{id, category, topic, source}].
create or replace function public.set_message_categories(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.messages m set
    category = r.category,
    topic = r.topic,
    category_source = r.source
  from jsonb_to_recordset(p_rows) as r(id uuid, category text, topic text, source text)
  where m.id = r.id
    and (m.category is distinct from r.category or m.topic is distinct from r.topic or m.category_source is distinct from r.source);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_message_categories(jsonb) from public, anon, authenticated;
grant execute on function public.set_message_categories(jsonb) to service_role;
