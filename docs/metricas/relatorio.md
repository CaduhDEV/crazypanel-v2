# Métricas de controle das comunidades DataCrazy

As comunidades são os grupos de WhatsApp do CRM, onde membros tiram dúvidas e se ajudam. Quando ninguém responde, um técnico entra pelo CrazyPanel. Este documento mostra o que os dados do painel permitem medir hoje, o que falta coletar e quais métricas acompanhar.

As queries estão em [`queries.sql`](queries.sql), com a mesma numeração usada aqui. Todas são somente leitura e rodam no SQL Editor do Supabase.

> **Leitura dos números:** os valores de exemplo vêm da base de 19/10/2026, sem o grupo de teste. São 26 threads, quase todas de um único dia (15/10/2026), então servem para validar as queries e ainda não para tirar conclusões. As métricas ficam estáveis depois de 3 a 4 semanas de uso real do painel.

---

## 1. Mapa dos dados

| Entidade | Tabela | Campos que ligam as peças |
|---|---|---|
| Comunidade | `wa_groups` | `jid`, `name`, `listening` (grupo escutado), `is_partner_group`, `member_count` |
| Membro | `contacts` | `kind` (customer / partner / team), `company_id` (empresa principal), `first_seen_at`, `last_message_at`, `left_community_at`, `email` |
| Participação no grupo | `group_members` | `group_jid`, `contact_id`, `joined_at`, `left_at`, `is_admin` |
| Empresa | `companies` | `external_id` (tenant), `cnpj`, nome |
| Thread (dúvida) | `tickets` | `contact_id` (quem perguntou), `group_jid`, `opened_at`, `first_response_at` (1ª resposta da equipe), `assignee_id`, `closed_at`, `closed_by`, `close_reason`, `category` |
| Mensagem / resposta | `messages` | `ticket_id`, `contact_id` (autor no grupo), `author_id` (técnico no painel), `from_me`, `quoted_wa_id` (citação), `sent_at`, `is_note` |
| Quem entrou na thread | `ticket_participants` | `ticket_id`, `contact_id`, `joined_at` |
| Reações | `message_reactions` | `message_id`, `contact_id`, `emoji` |
| Histórico da thread | `ticket_events` | `opened`, `reopened`, `assigned`, `closed`, `merged`, `participant_added` |
| Entradas e saídas | `community_events` | `joined_via_link`, `added_by_admin`, `invited_by_member`, `left`, `removed` |
| Técnicos | `profiles` | `id`, `name`, `active` |
| Tickets do Gleap | `gleap_tickets` | `type`, `status`, `session_email`, `has_agent_reply` |

### Como uma resposta vira dado

- **Membro que cita a mensagem** de uma dúvida entra na thread como participante. A resposta dele fica ligada à thread e pode ser medida.
- **Técnico pelo painel:** a resposta grava `first_response_at`, o técnico assume a thread e a mensagem leva `author_id`.
- **Técnico pelo próprio celular, citando a dúvida:** também conta como equipe (contato `kind = team`), mas não fica ligado a um técnico do painel.
- **Resposta sem citação** abre uma thread nova, separada da dúvida (ver lacuna 1).

Nas queries:
- **resposta** é qualquer mensagem na thread de alguém que não é o autor da dúvida;
- **equipe** é o painel, o número da comunidade ou um contato da equipe;
- **comunidade** são os membros e parceiros.

---

## 2. O que falta para medir bem

| # | Lacuna | Impacto | Sugestão |
|---|---|---|---|
| 1 | **Resposta sem citação vira thread nova.** Hoje cerca de **31%** das threads parecem ser respostas a outra (métrica 20). | Ajuda entre membros subcontada; "threads sem resposta" inflado. | Estender a "sugestão de contexto" (já existe para a equipe) para respostas de membros dadas logo depois de uma dúvida. |
| 2 | **Não há "resolvido por quem".** 35 de 37 threads foram fechadas com "Fila limpa pelo admin". | % resolvido pela comunidade e ranking de quem resolve dependem de proxies. | No fechamento: "resolvido por: comunidade / equipe" e a opção de marcar a mensagem que resolveu. Evitar "limpar fila" como fechamento de rotina. |
| 3 | **Tema só no fechamento "resolvido"**, com 10 categorias amplas. Hoje 96% das threads estão sem categoria. | Recorrência por tema é a métrica mais fraca. | Tornar a categoria obrigatória em todo fechamento e acrescentar um subtema (ex.: número do WhatsApp, integração, automação, Meta). |
| 4 | **Técnico respondendo pelo celular** não é ligado ao seu usuário no painel. | Carga por técnico mostra só o trabalho feito pelo painel. | Vincular o contato da equipe ao perfil do técnico. |
| 5 | **Entradas e saídas reais** só são registradas desde 19/10/2026, pelo webhook de grupos. O `joined_at` antigo é a data da sincronização. | Retenção e novos membros só valem daqui para frente. | Nada a fazer; o histórico se forma sozinho. Conferir se o webhook de grupos está ativo. |
| 6 | **Metade das dúvidas sem empresa** (14 de 26). | Recorrência por empresa incompleta. | Seguir vinculando leads (Gleap / CRM / formulário verificado). |

---

## 3. Métricas

Prioridade: **A** = controla a operação e deve ser acompanhada toda semana; **M** = diagnóstico mensal; **B** = contexto, ou risco de virar vaidade.

### Ajuda entre membros

**1. Ranking de quem mais ajuda** · A · viável hoje
- *Definição:* por membro, quantas threads de outras pessoas ele respondeu e quantas respostas deu.
- *Fórmula:* `count(distinct ticket_id)` e `count(*)` das respostas da comunidade, agrupados por `contact_id`.
- *Fonte:* `messages` × `tickets` × `contacts`.
- *Hoje:* 6 pessoas ajudaram, todas **parceiros** (Lucas Fernandes 3 threads, Tiago Lau Chaves 2, Marcell 2…).
- *Ação:* reconhecer e reter quem ajuda. Quando quem ajuda é parceiro, avaliar se isso é desejado, porque pode ser venda disfarçada de ajuda.

**2. Ranking de quem mais resolve (proxy)** · M · viável com proxy
- *Definição:* respostas da comunidade que receberam reação do autor da dúvida, ou que foram a última resposta antes de um fechamento "resolvido".
- *Fórmula:* reação de `tickets.contact_id` em `message_reactions`, ou a última resposta antes de `closed_at` com `close_reason = 'resolved'`.
- *Hoje:* Marcell 2 threads, Tiago 1. Todas pela reação, porque quase não há fechamento "resolvido".
- *Limite:* fica preciso quando houver "resolvido por" (lacuna 2).

**3. % resolvido pela comunidade** · A · viável hoje
- *Definição:* das threads que tiveram alguma resposta, quantas foram respondidas só pela comunidade, sem técnico.
- *Fórmula:* `só_comunidade ÷ (só_comunidade + só_equipe + ambos)`.
- *Hoje:* **46%** (6 só pela comunidade, 5 só pela equipe, 2 por ambos). Por grupo: #1 60%, #2 20%, #3 67%.
- *Ação:* é o principal indicador do modelo de comunidade. Se cair, a equipe vira o único suporte.

**4. Tempo até a 1ª resposta de um membro** · M · viável hoje
- *Fórmula:* mediana e p90 de `min(sent_at da resposta da comunidade) − opened_at`.
- *Hoje:* mediana de **4 min**, p90 de 24 min (8 threads).
- *Ação:* mostra quanto tempo o técnico pode esperar antes de entrar.

### Atuação da equipe

**5. % de threads com técnico** · A · viável hoje
- *Fórmula:* `threads com first_response_at ÷ threads`, por semana e por grupo.
- *Hoje:* 15% (#1 14%, #2 20%, #3 0%).

**6. Tempo até o técnico entrar** · A · viável hoje
- *Definição:* `first_response_at − opened_at`, separando as threads em que um membro respondeu antes das que ninguém respondeu.
- *Hoje:* mediana de **1,6 min**, p90 de 8 min, em 4 threads. Em todas, ninguém tinha respondido antes.
- *Ação:* se o técnico entra rápido demais, sobra pouco espaço para a comunidade responder (ver métricas 3 e 4).

**7. Dentro do SLA** · A · viável hoje
- *Fórmula:* `% com first_response_at − opened_at ≤ app_settings.sla_seconds` (hoje 30 min).
- *Hoje:* 100% (4 de 4).
- *Observação:* mede só as threads que a equipe respondeu. As que ninguém respondeu estão na métrica 14.

**8. Carga por técnico** · A · viável, só pelo painel
- *Definição:* threads assumidas, mensagens, notas, fechamentos, resolvidas, abertas agora e mediana da 1ª resposta, por técnico.
- *Fonte:* `tickets.assignee_id` / `closed_by`, `messages.author_id`.
- *Hoje:* Carlos Eduardo 5 threads e 4 mensagens; Leonardo e Murilo, 0.

### Tickets e problemas

**9. Recorrência por membro** · M · viável hoje
- *Fórmula:* threads por pessoa no período e quantas vezes ela voltou em até 7 dias (`lag(opened_at)`).
- *Hoje:* 1 pessoa com 2 threads em 7 dias.
- *Ação:* quem volta muito precisa de onboarding ou de contato direto do CS.

**10. Recorrência por empresa** · A · viável, mas parcial (lacuna 6)
- *Definição:* threads, pessoas com dúvida, threads por pessoa, com técnico, bugs e reclamações, por empresa (tenant).
- *Hoje:* 14 threads sem empresa; as demais empresas têm 1 cada.
- *Ação:* empresa com muitas dúvidas indica risco de churn ou falha de implantação. Levar ao CS.

**11. Recorrência por comunidade** · M · viável hoje
- *Fórmula:* `threads ÷ membros ativos no grupo × 100`.
- *Hoje:* #2 tem 1,55 threads por 100 membros, #1 0,78, #3 0,45 e #4 0.

**12. Recorrência por tema** · M · dado fraco (lacuna 3)
- *Hoje (painel):* 96% das threads sem categoria.
- *Complemento (12b):* tickets do Gleap por tipo e status, ligados à empresa pelo e-mail. Hoje são 385 FEATURE_REQUEST abertos, 147 BOT, 112 CS-QUALIDADE e 80 INQUIRY.
- *Ação:* temas recorrentes viram tutorial, mensagem fixada ou correção no produto.

**13. Reabertura** · M · viável hoje
- *Fórmula:* `threads com evento reopened ÷ threads fechadas`.
- *Hoje:* 4% (1 de 25).
- *Ação:* reabertura alta indica fechamento precoce ou resposta incompleta.

### Saúde da comunidade

**14. Threads sem resposta** · A · viável, mas inflado (lacuna 1)
- *Definição:* threads em que ninguém além do autor respondeu dentro de X horas (padrão 2 h), no período e abertas agora.
- *Hoje:* **50%** (13 de 26) nunca tiveram resposta. Parte delas são respostas sem citação (métrica 20).
- *Ação:* é o sinal mais direto de membro abandonado. Abertas agora sem resposta deveriam ser zero.

**15. Ativos vs. inativos** · M · viável hoje
- *Fórmula:* membros com mensagem nos últimos 30 dias ÷ membros no grupo (sem a equipe).
- *Hoje:* 1,4% no #2, 1,0% no #1, 0,6% no #3 e 0% no #4.
- *Leitura:* em comunidades grandes, poucos falam. O que importa é a tendência semanal, não o valor absoluto.

**16. Entradas, saídas e retenção** · M · viável desde 19/10/2026 (lacuna 5)
- *Fórmula:* entradas (link, adicionado, convidado por membro) e saídas por semana, com o saldo. A retenção (16b) é a % de quem entrou há 30 dias ou mais e continua no grupo.
- *Hoje:* sem eventos ainda.

**17. Horários de pico** · B · viável hoje
- *Fórmula:* mensagens de membros e threads abertas por dia da semana e hora (horário de Brasília).
- *Hoje:* pico na quinta às 16 h (53 mensagens e 13 threads).
- *Ação:* montar a escala dos técnicos.

**18. Dependência de "heróis"** · M · viável hoje
- *Fórmula:* % das respostas da comunidade feitas pelos 5 que mais respondem e pelos 10% que mais respondem, mais o índice HHI (0 a 10.000; acima de 2.500 é concentrado).
- *Hoje:* 6 pessoas ajudaram; os 5 maiores fizeram 96% das respostas, com HHI de 2.174.
- *Ação:* se um herói sai, a % resolvida pela comunidade cai junto. Incentivar novos ajudantes.

**19. Engajamento** · B · viável hoje
- *Definição:* mensagens por membro ativo e % dos ativos que já ajudaram alguém.
- *Hoje:* #1 tem 5,7 mensagens por ativo e 44% que ajudaram; #2, 2,1 e 14%.

**20. Ruído de roteamento** · A (qualidade do dado) · viável hoje
- *Definição:* threads abertas sem citação, até 5 min depois de outra thread de outra pessoa no mesmo grupo. Provavelmente são respostas que viraram thread separada.
- *Hoje:* **31%** (8 de 26); no #2 chega a 40%.
- *Ação:* enquanto estiver alto, as métricas 1, 3 e 14 ficam distorcidas. É a primeira lacuna a resolver.

### Métricas de vaidade (não acompanhar como meta)

Total de mensagens, total de membros e total de reações: crescem sozinhos e não dizem se a comunidade resolve dúvidas.

---

## 4. Painel mínimo recomendado (semanal)

1. **% resolvido pela comunidade** (3) e **% com técnico** (5)
2. **Threads sem resposta** (14), em especial as abertas agora
3. **Tempo até o técnico** (6) e **dentro do SLA** (7)
4. **Carga por técnico** (8)
5. **Top empresas com dúvida** (10)
6. **Ranking de quem ajuda** (1), com a **concentração** (18) ao lado
7. **Ruído de roteamento** (20), até cair para menos de 5%

## 5. Próximos passos sugeridos

Nenhum foi feito; cada um depende de confirmação.

1. Resolver a lacuna 1 (sugestão de contexto para respostas de membros) e a lacuna 2 ("resolvido por" no fechamento).
2. Categoria obrigatória com subtema em todo fechamento (lacuna 3).
3. Página **/metricas** no painel com o painel mínimo, ou um relatório semanal automático no Discord.
