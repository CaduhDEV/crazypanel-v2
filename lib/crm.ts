import { phoneKey } from "@/lib/gleap";

// Somente servidor. API do CRM DataCrazy (tenant Pós Vendas: os leads são os
// clientes da DataCrazy). Usada para achar o lead pelo telefone.

export function crmConfigured(): boolean {
  return !!process.env.DATACRAZY_API_URL && !!process.env.DATACRAZY_API_KEY;
}

export interface CrmLeadInfo {
  id: string;
  name: string | null;
  email: string | null;
  taxId: string | null;
  attendantName: string | null;
  lastReceivedAt: string | null;
  lastSentAt: string | null;
  pending: boolean | null;
}

type RawLead = {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  rawPhone?: string | null;
  taxId?: string | null;
  updatedAt?: string;
  attendant?: { name?: string | null } | null;
  contacts?: {
    platform?: string;
    lastContactStatus?: {
      isPending?: boolean;
      lastReceivedMessage?: { date?: string | null } | null;
      lastSendedMessage?: { date?: string | null } | null;
    } | null;
  }[];
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Lead do CRM com o mesmo telefone (o mais recente, se houver vários). null se não existe. */
export async function findCrmLeadByPhone(phone: string): Promise<CrmLeadInfo | null> {
  const key = phoneKey(phone);
  if (key.length < 10) return null;

  const url = `${process.env.DATACRAZY_API_URL!.replace(/\/+$/, "")}/leads?search=${encodeURIComponent(phone)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.DATACRAZY_API_KEY}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CRM respondeu ${res.status}`);
  const body = (await res.json()) as { data?: RawLead[] };

  const matches = (body.data ?? [])
    .filter((l) => phoneKey(l.phone ?? l.rawPhone) === key)
    .sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
  const lead = matches[0];
  if (!lead?.id) return null;

  const whatsapp = (lead.contacts ?? []).find((c) => c.platform === "WHATSAPP")?.lastContactStatus ?? null;
  const taxId = str(lead.taxId)?.replace(/\D/g, "") || null;
  return {
    id: lead.id,
    name: str(lead.name),
    email: str(lead.email)?.toLowerCase() ?? null,
    taxId,
    attendantName: str(lead.attendant?.name),
    lastReceivedAt: date(whatsapp?.lastReceivedMessage?.date),
    lastSentAt: date(whatsapp?.lastSendedMessage?.date),
    pending: typeof whatsapp?.isPending === "boolean" ? whatsapp.isPending : null,
  };
}
