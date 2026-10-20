-- =============================================================================
-- Categorias e subcategorias editáveis pelo admin (Configurações)
-- =============================================================================
-- Antes as opções estavam fixas no código e em checks. Agora ficam em tabelas,
-- e tickets/mensagens apontam para elas por chave estrangeira:
--   • categoria com subcategoria ativa não pode ser apagada (o painel pede para
--     tirar as subcategorias antes);
--   • o que já foi usado em atendimento é arquivado em vez de apagado: some das
--     opções, mas o histórico e as métricas continuam com o nome.
-- As chaves são fixas (o que fica gravado); o nome pode ser trocado à vontade.

create table if not exists public.ticket_categories (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(trim(label)) between 2 and 40),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_topics (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  category_key text not null references public.ticket_categories (key) on delete restrict,
  label text not null check (length(trim(label)) between 2 and 40),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (key, category_key)
);

create index if not exists ticket_topics_category_idx on public.ticket_topics (category_key, position);

alter table public.ticket_categories enable row level security;
alter table public.ticket_topics enable row level security;
-- Leitura para a equipe; escrita só pelo servidor (ações do admin com a chave secreta).
drop policy if exists "ticket_categories: membros leem" on public.ticket_categories;
create policy "ticket_categories: membros leem" on public.ticket_categories for select to authenticated using (true);
drop policy if exists "ticket_topics: membros leem" on public.ticket_topics;
create policy "ticket_topics: membros leem" on public.ticket_topics for select to authenticated using (true);

-- Atuais + sugestões tiradas dos atendimentos (out/2026).
insert into public.ticket_categories (key, label, position) values
  ('duvida', 'Dúvida', 1),
  ('tecnico', 'Técnico', 2),
  ('comercial', 'Comercial', 3),
  ('comunidade', 'Comunidade', 4)
on conflict (key) do nothing;

insert into public.ticket_topics (key, category_key, label, position) values
  ('funil', 'duvida', 'Funil', 1),
  ('disparos', 'duvida', 'Disparos', 2),
  ('whatsapp', 'duvida', 'WhatsApp', 3),
  ('integracoes', 'duvida', 'Integrações', 4),
  ('automacoes', 'duvida', 'Automações', 5),
  ('api_oficial', 'duvida', 'API Oficial', 6),
  ('agentes_ia', 'duvida', 'Agentes de IA', 7),
  ('tags_campos', 'duvida', 'Tags e campos', 8),
  ('contatos', 'duvida', 'Contatos', 9),
  ('usuarios', 'duvida', 'Usuários', 10),
  ('envio', 'tecnico', 'Envio', 1),
  ('instancia', 'tecnico', 'Instância', 2),
  ('tela', 'tecnico', 'Tela', 3),
  ('restricao', 'tecnico', 'Restrição', 4),
  ('instabilidade', 'tecnico', 'Instabilidade', 5),
  ('automacao_erro', 'tecnico', 'Automação', 6),
  ('midia', 'tecnico', 'Mídia', 7),
  ('upgrade', 'comercial', 'Upgrade', 1),
  ('pagamento', 'comercial', 'Pagamento', 2),
  ('cancelamento', 'comercial', 'Cancelamento', 3),
  ('parcerias', 'comercial', 'Parcerias', 4),
  ('sugestao', 'comunidade', 'Sugestão', 1),
  ('elogio', 'comunidade', 'Elogio', 2),
  ('offtopic', 'comunidade', 'Off-topic', 3),
  ('reclamacao', 'comunidade', 'Reclamação', 4),
  ('eventos', 'comunidade', 'Eventos', 5)
on conflict (key) do nothing;

-- Checks fixos → chaves estrangeiras (a subcategoria tem de ser da categoria).
alter table public.tickets drop constraint if exists tickets_category_check;
alter table public.tickets drop constraint if exists tickets_topic_check;
alter table public.tickets drop constraint if exists tickets_topic_matches_category;
alter table public.tickets drop constraint if exists tickets_category_fkey;
alter table public.tickets drop constraint if exists tickets_topic_fkey;
alter table public.tickets add constraint tickets_category_fkey
  foreign key (category) references public.ticket_categories (key) on delete restrict;
alter table public.tickets add constraint tickets_topic_fkey
  foreign key (topic, category) references public.ticket_topics (key, category_key) on delete restrict;

alter table public.messages drop constraint if exists messages_category_check;
alter table public.messages drop constraint if exists messages_topic_check;
alter table public.messages drop constraint if exists messages_topic_matches_category;
alter table public.messages drop constraint if exists messages_category_fkey;
alter table public.messages drop constraint if exists messages_topic_fkey;
alter table public.messages add constraint messages_category_fkey
  foreign key (category) references public.ticket_categories (key) on delete restrict;
alter table public.messages add constraint messages_topic_fkey
  foreign key (topic, category) references public.ticket_topics (key, category_key) on delete restrict;

create index if not exists tickets_topic_idx on public.tickets (topic) where topic is not null;
create index if not exists messages_topic_idx on public.messages (topic) where topic is not null;
