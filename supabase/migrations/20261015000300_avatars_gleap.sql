-- =============================================================================
-- Fotos (contatos do WhatsApp e atendentes) e enriquecimento pelo Gleap
-- =============================================================================

-- Fotos ficam num bucket público: o <img> usa a URL direto, sem assinatura.
-- O caminho leva o uuid do dono e um carimbo de versão (não é adivinhável).
-- Sem policies: só o servidor (service role) grava.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A URL da foto no WhatsApp expira; a cópia é renovada no máximo 1x por semana.
alter table public.contacts
  add column if not exists avatar_checked_at timestamptz;

-- Dados vindos do Gleap (busca pelo telefone). gleap_status registra o
-- resultado da última varredura para não repetir quem já foi consultado.
alter table public.contacts
  add column if not exists email text,
  add column if not exists gleap_session_id text,
  add column if not exists gleap_checked_at timestamptz,
  add column if not exists gleap_status text
    check (gleap_status in ('linked', 'ambiguous', 'not_found'));

create index if not exists contacts_gleap_pending_idx
  on public.contacts (gleap_checked_at nulls first)
  where phone is not null and company_id is null;

-- external_id já guarda o tenant id do CRM (companyId no Gleap).
alter table public.companies
  add column if not exists cnpj text
    check (cnpj is null or cnpj ~ '^[0-9]{14}$');
