-- =============================================================================
-- Dados do lead no CRM DataCrazy (tenant Pós Vendas), pelo telefone
-- =============================================================================
-- Consultado sob demanda ao abrir o lead (cache de alguns minutos). Traz o
-- documento (CNPJ/CPF), o responsável no CRM e o último contato pelo WhatsApp
-- do CRM, usado no aviso de conflito de canais.

alter table public.contacts
  add column if not exists crm_lead_id text,
  add column if not exists crm_tax_id text,
  add column if not exists crm_attendant_name text,
  add column if not exists crm_last_received_at timestamptz,
  add column if not exists crm_last_sent_at timestamptz,
  add column if not exists crm_pending boolean,
  add column if not exists crm_checked_at timestamptz;
