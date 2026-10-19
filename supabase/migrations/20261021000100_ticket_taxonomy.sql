-- =============================================================================
-- Categorias e subcategorias dos atendimentos (palavras-chave)
-- =============================================================================
--   duvida      → funil, disparos, whatsapp, integracoes
--   tecnico     → envio, instancia, tela
--   comercial   → upgrade, pagamento, cancelamento
--   comunidade  → sugestao, elogio, offtopic
-- Toda categoria pede a subcategoria ao finalizar.

alter table public.tickets drop constraint if exists tickets_category_check;
alter table public.tickets drop constraint if exists tickets_topic_check;

-- Valores antigos → novos.
update public.tickets set
  topic = case
    when category in ('feedback') then 'sugestao'
    when category in ('elogio', 'agradecimento') then 'elogio'
    when category in ('divulgacao', 'outro') then 'offtopic'
    when topic = 'automacoes' then 'disparos'
    when topic = 'meta' then 'integracoes'
    when topic in ('funil', 'whatsapp', 'integracoes') then topic
    when topic = 'financeiro' then 'pagamento'
    else null
  end,
  category = case
    when category in ('duvida_basica', 'duvida_avancada', 'duvida_meta') then 'duvida'
    when category = 'bug' then 'tecnico'
    when category in ('reclamacao', 'feedback', 'elogio', 'agradecimento', 'divulgacao', 'outro') then 'comunidade'
    else category
  end
where category is not null or topic is not null;

alter table public.tickets add constraint tickets_category_check
  check (category in ('duvida', 'tecnico', 'comercial', 'comunidade'));

alter table public.tickets add constraint tickets_topic_check
  check (topic in (
    'funil', 'disparos', 'whatsapp', 'integracoes',
    'envio', 'instancia', 'tela',
    'upgrade', 'pagamento', 'cancelamento',
    'sugestao', 'elogio', 'offtopic'
  ));

-- A subcategoria pertence à categoria.
alter table public.tickets drop constraint if exists tickets_topic_matches_category;
alter table public.tickets add constraint tickets_topic_matches_category check (
  topic is null
  or (category = 'duvida' and topic in ('funil', 'disparos', 'whatsapp', 'integracoes'))
  or (category = 'tecnico' and topic in ('envio', 'instancia', 'tela'))
  or (category = 'comercial' and topic in ('upgrade', 'pagamento', 'cancelamento'))
  or (category = 'comunidade' and topic in ('sugestao', 'elogio', 'offtopic'))
);
