// Tipos das linhas do banco (espelham supabase/migrations) e constantes de domínio.

export type AppRole = "admin" | "attendant";
export type ContactKind = "customer" | "partner" | "team";
export type TicketStatus = "open" | "closed";
export type MessageKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "poll"
  | "other";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "played" | "failed";
export type InstanceStatus = "disconnected" | "connecting" | "connected" | "hibernated";

export interface Profile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: AppRole;
  active: boolean;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  sla_seconds: number;
  sla_warning_percent: number;
  sign_messages: boolean;
  typing_delay_ms: number;
  reopen_window_hours: number;
  join_window_minutes: number;
  /** Mensagens da mesma pessoa com até este intervalo são continuação (rajada). */
  burst_window_seconds: number;
  // Notificações do navegador (textos com {lead}, {empresa}, {grupo}, {mensagem}, {numero})
  push_enabled: boolean;
  push_sound: boolean;
  push_new_title: string;
  push_new_body: string;
  push_breach_title: string;
  push_breach_body: string;
  // Mensagens no privado da entrada na comunidade ({nome}, {grupo}, {email})
  join_msg_no_company: string;
  join_msg_rejected: string;
  join_msg_accepted: string;
  /** Resposta de membro sem citação vira sugestão na dúvida com atividade nesse intervalo. */
  member_reply_window_minutes: number;
  // Relatório oficial pelo WhatsApp
  report_enabled: boolean;
  /** 0 = domingo … 6 = sábado (horário de Brasília). */
  report_weekday: number;
  report_hour: number;
  report_period_days: number;
  report_recipients: string[];
  report_last_sent_at: string | null;
}

export interface WaGroup {
  jid: string;
  name: string | null;
  description: string | null;
  picture_url: string | null;
  member_count: number | null;
  is_announce: boolean;
  is_community: boolean;
  /** Membros (que não são equipe) viram parceiros. */
  is_partner_group?: boolean;
  listening: boolean;
  last_message_at: string | null;
  synced_at: string | null;
  members_synced_at: string | null;
}

export interface Company {
  id: string;
  name: string;
  external_id: string | null;
  email: string | null;
  cnpj?: string | null;
  notes: string | null;
}

export interface Contact {
  id: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  avatar_url: string | null;
  email?: string | null;
  gleap_status?: "linked" | "ambiguous" | "not_found" | null;
  /** Saiu de todas as comunidades (grupos escutados) em que esteve. */
  left_community_at?: string | null;
  /** Em quantas empresas o telefone aparece (Gleap + a vinculada). */
  companies_count?: number;
  // Lead no CRM DataCrazy (pelo telefone; ver lib/crm.ts)
  crm_lead_id?: string | null;
  crm_tax_id?: string | null;
  crm_attendant_name?: string | null;
  crm_last_received_at?: string | null;
  crm_last_sent_at?: string | null;
  crm_pending?: boolean | null;
  crm_checked_at?: string | null;
  kind: ContactKind;
  company_id: string | null;
  strikes: number;
  notes: string | null;
  message_count: number;
  first_seen_at: string;
  last_message_at: string | null;
}

export interface Ticket {
  id: string;
  number: number;
  group_jid: string;
  contact_id: string;
  status: TicketStatus;
  assignee_id: string | null;
  subject: string | null;
  waiting_since: string | null;
  last_customer_message_at: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  first_response_at: string | null;
  message_count: number;
  category: TicketCategory | null;
  /** Assunto do produto (obrigatório nas categorias de suporte). */
  topic?: TicketTopic | null;
  /** Quem resolveu, informado ao finalizar. */
  resolved_by?: ResolvedBy | null;
  resolution_message_id?: string | null;
  close_reason: CloseReason | null;
  close_note: string | null;
  closed_at: string | null;
  closed_by: string | null;
  opened_at: string;
}

/** Atendimento com os dados usados na fila e na lista da conversa. */
export interface TicketWithRelations extends Ticket {
  contact: (Pick<Contact, "id" | "name" | "phone" | "lid" | "kind" | "company_id" | "avatar_url"> & { company?: { name: string } | null }) | null;
  group: Pick<WaGroup, "jid" | "name"> | null;
}

export interface Message {
  id: string;
  wa_id: string | null;
  group_jid: string;
  ticket_id: string | null;
  contact_id: string | null;
  author_id: string | null;
  from_me: boolean;
  is_note: boolean;
  sender_name: string | null;
  kind: MessageKind;
  body: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_name: string | null;
  media_size: number | null;
  media_duration: number | null;
  media_status: "pending" | "ready" | "failed" | null;
  /** pending: o painel pergunta se a mensagem é deste atendimento. */
  context_check?: "pending" | "confirmed" | null;
  quoted_wa_id: string | null;
  status: MessageStatus | null;
  error: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  sent_at: string;
  created_at: string;
}

export interface MessageReaction {
  message_id: string;
  reactor_key: string;
  contact_id: string | null;
  author_id: string | null;
  reactor_name: string | null;
  emoji: string;
  reacted_at: string;
}

export interface TicketEvent {
  id: number;
  ticket_id: string;
  type:
    | "opened"
    | "reopened"
    | "assigned"
    | "unassigned"
    | "closed"
    | "merged"
    | "message_moved"
    | "participant_added"
    | "participant_removed";
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Categorias e motivos de encerramento (valores salvos no banco)
// ---------------------------------------------------------------------------
export const TICKET_CATEGORIES = [
  { value: "duvida_basica", label: "Dúvida básica" },
  { value: "duvida_avancada", label: "Dúvida avançada" },
  { value: "duvida_meta", label: "Dúvida Meta" },
  { value: "bug", label: "Bug" },
  { value: "reclamacao", label: "Reclamação" },
  { value: "feedback", label: "Feedback" },
  { value: "elogio", label: "Elogio" },
  { value: "agradecimento", label: "Agradecimento" },
  { value: "divulgacao", label: "Divulgação" },
  { value: "outro", label: "Outro" },
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]["value"];

/** Categorias de suporte: pedem o subtema (assunto do produto) ao finalizar. */
export const SUPPORT_CATEGORIES: readonly TicketCategory[] = ["duvida_basica", "duvida_avancada", "duvida_meta", "bug", "reclamacao", "feedback"];

export const TICKET_TOPICS = [
  { value: "whatsapp", label: "WhatsApp / número" },
  { value: "integracoes", label: "Integrações e API" },
  { value: "automacoes", label: "Automações e fluxos" },
  { value: "meta", label: "Meta / anúncios" },
  { value: "funil", label: "Funil e negócios" },
  { value: "importacao", label: "Importação e cadastro" },
  { value: "usuarios", label: "Usuários e acesso" },
  { value: "financeiro", label: "Plano e financeiro" },
  { value: "relatorios", label: "Relatórios e dashboards" },
  { value: "outro", label: "Outro assunto" },
] as const;

export type TicketTopic = (typeof TICKET_TOPICS)[number]["value"];

export const RESOLVED_BY = [
  { value: "community", label: "Comunidade", hint: "Um membro ou parceiro resolveu" },
  { value: "team", label: "Equipe", hint: "A equipe DataCrazy resolveu" },
  { value: "both", label: "Comunidade e equipe", hint: "Os dois ajudaram" },
] as const;

export type ResolvedBy = (typeof RESOLVED_BY)[number]["value"];

export const CLOSE_REASONS = {
  resolved: "Finalizado",
  parallel: "Assunto paralelo",
  sla_cleared: "Fila limpa pelo admin",
  merged: "Mesclado",
} as const;

export type CloseReason = keyof typeof CLOSE_REASONS;

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  customer: "Cliente",
  partner: "Parceiro",
  team: "Equipe",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  attendant: "Atendente",
};

/** Nome dos arquivos de voz gravados no painel (enviados como mensagem de voz). */
export const VOICE_NOTE_PREFIX = "gravacao-";

export const DEFAULT_SETTINGS: AppSettings = {
  sla_seconds: 300,
  sla_warning_percent: 75,
  sign_messages: true,
  typing_delay_ms: 1200,
  reopen_window_hours: 24,
  join_window_minutes: 30,
  burst_window_seconds: 180,
  push_enabled: true,
  push_sound: true,
  push_new_title: "Novo atendimento · {grupo}",
  push_new_body: "{lead}: {mensagem}",
  push_breach_title: "SLA estourado · #{numero}",
  push_breach_body: "{lead} está esperando resposta em {grupo}.",
  join_msg_no_company:
    "Olá, {nome}! Recebemos seu pedido para entrar na comunidade DataCrazy, mas não encontramos nenhuma empresa cadastrada com o e-mail {email}. Confira se é o mesmo e-mail que você usa no CRM DataCrazy e envie o formulário novamente.",
  join_msg_rejected: "Olá, {nome}! Seu pedido para entrar na comunidade DataCrazy não foi aprovado.",
  join_msg_accepted: "Olá, {nome}! Seu pedido foi aprovado e você entrou no grupo {grupo}. Seja bem-vindo(a) à comunidade DataCrazy!",
  member_reply_window_minutes: 10,
  report_enabled: false,
  report_weekday: 1,
  report_hour: 9,
  report_period_days: 7,
  report_recipients: [],
  report_last_sent_at: null,
};

/**
 * Configurações a partir da linha do banco, completando com o padrão o que não
 * vier (colunas novas antes da migration subir não quebram o painel).
 */
export function toSettings(row: Partial<Record<keyof AppSettings, unknown>> | null | undefined): AppSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (!row) return out;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const v = row[key];
    const d = DEFAULT_SETTINGS[key];
    // Padrão null (ex.: data do último envio): aceita o texto do banco.
    if (v !== undefined && v !== null && (d === null ? typeof v === "string" : typeof v === typeof d)) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}
