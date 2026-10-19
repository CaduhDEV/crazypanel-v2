// Somente servidor. Busca de leads (sessões) no Gleap, usada para descobrir
// e-mail e empresa (tenant do CRM) de um contato pelo telefone.
// O Gleap não guarda CNPJ: só companyId (tenant id) e companyName.

const GLEAP_APP_BASE = "https://appapi.gleap.io/v3";
const DEFAULT_PROJECT = "68f27a8b3fe77e96302c169c";

export interface GleapSession {
  id: string;
  companyId: string | null;
  companyName: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
}

export function gleapConfigured(): boolean {
  return !!process.env.GLEAP_API_TOKEN;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Busca "contém" do Gleap. Lança em falha (para não marcar como "não encontrado"). */
async function searchSessions(term: string): Promise<GleapSession[]> {
  const res = await fetch(`${GLEAP_APP_BASE}/sessions/search?searchTerm=${encodeURIComponent(term)}`, {
    headers: {
      Authorization: `Bearer ${process.env.GLEAP_API_TOKEN}`,
      project: process.env.GLEAP_PROJECT_ID || DEFAULT_PROJECT,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gleap respondeu ${res.status}`);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) throw new Error("resposta inesperada do Gleap");
  return (body as Record<string, unknown>[]).map((s) => ({
    id: String(s.id ?? s._id ?? ""),
    companyId: str(s.companyId),
    companyName: str(s.companyName),
    phone: str(s.phone),
    name: str(s.name),
    email: str(s.email)?.toLowerCase() ?? null,
  }));
}

/**
 * Chave de comparação de telefone BR: sem DDI 55 e sem o nono dígito do
 * celular, para casar "5543984244218", "(43) 98424-4218" e "4384244218".
 */
export function phoneKey(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d;
}

/** Sessões do Gleap cujo telefone é o mesmo do contato. */
export async function findGleapSessionsByPhone(phone: string): Promise<GleapSession[]> {
  const key = phoneKey(phone);
  if (key.length < 8) return [];
  const national = phone.startsWith("55") ? phone.slice(2) : phone;
  const terms = [...new Set([phone, national])];

  const byId = new Map<string, GleapSession>();
  for (const term of terms) {
    for (const s of await searchSessions(term)) {
      if (s.id && phoneKey(s.phone) === key) byId.set(s.id, s);
    }
  }
  return [...byId.values()];
}

// =============================================================================
// Base completa (export CSV) e sessões recentes, para a lista de convites
// =============================================================================
const GLEAP_API_BASE = "https://api.gleap.io/v3";

export interface GleapLeadRow {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company_tenant_id: string | null;
  company_name: string | null;
  last_activity_at: string | null;
  gleap_created_at: string | null;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.GLEAP_API_TOKEN}`,
    project: process.env.GLEAP_PROJECT_ID || DEFAULT_PROJECT,
  };
}

// O export usa "-" e "null" para campos vazios.
const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s && s !== "-" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined" ? s : null;
};
const isoOrNull = (v: unknown) => {
  const s = clean(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

function toLeadRow(r: Record<string, unknown>): GleapLeadRow | null {
  const userId = clean(r.userId);
  if (!userId) return null;
  return {
    user_id: userId,
    name: clean(r.name),
    email: clean(r.email)?.toLowerCase() ?? null,
    phone: clean(r.phone),
    company_tenant_id: clean(r.companyId),
    company_name: clean(r.companyName),
    last_activity_at: isoOrNull(r.lastActivity),
    gleap_created_at: isoOrNull(r.createdAt),
  };
}

/** CSV (RFC 4180): campos entre aspas podem ter vírgula, aspas dobradas e quebra de linha. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Base inteira pelo export do Gleap (dezenas de MB; leva alguns segundos). */
export async function exportAllGleapLeads(): Promise<GleapLeadRow[]> {
  const res = await fetch(`${GLEAP_API_BASE}/sessions/export`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`export do Gleap respondeu ${res.status}`);
  const [header, ...lines] = parseCsv(await res.text());
  if (!header?.includes("userId")) throw new Error("export do Gleap em formato inesperado");
  const out: GleapLeadRow[] = [];
  for (const line of lines) {
    if (line.length !== header.length) continue;
    const row = toLeadRow(Object.fromEntries(header.map((k, i) => [k, line[i]])));
    if (row) out.push(row);
  }
  return out;
}

/** As `count` sessões criadas mais recentemente (páginas de 100). */
export async function listRecentGleapLeads(count: number): Promise<GleapLeadRow[]> {
  const out: GleapLeadRow[] = [];
  for (let skip = 0; skip < count; skip += 100) {
    const limit = Math.min(100, count - skip);
    const res = await fetch(`${GLEAP_API_BASE}/sessions?limit=${limit}&skip=${skip}&sort=-createdAt`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Gleap respondeu ${res.status}`);
    const page = (await res.json()) as Record<string, unknown>[];
    for (const s of page) {
      const row = toLeadRow(s);
      if (row) out.push(row);
    }
    if (page.length < limit) break;
  }
  return out;
}

// =============================================================================
// Chamados ativos (conflito de canais)
// =============================================================================
export const ACTIVE_TICKET_STATUSES = ["OPEN", "INPROGRESS"] as const;

export interface GleapTicketRow {
  id: string;
  bug_id: number | null;
  type: string;
  board_name: string | null;
  url: string | null;
  status: string;
  title: string | null;
  session_user_id: string | null;
  session_email: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  has_agent_reply: boolean;
  gleap_created_at: string | null;
  gleap_updated_at: string | null;
}

/** Board do Gleap: o tipo do ticket, com o nome mostrado no painel e o caminho da URL. */
export interface GleapBoard {
  type: string;
  name: string;
  path: string;
}

export async function listGleapBoards(): Promise<Map<string, GleapBoard>> {
  const res = await fetch(`${GLEAP_API_BASE}/ticket-types`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`boards do Gleap responderam ${res.status}`);
  const list = (await res.json()) as Record<string, unknown>[];
  const boards = new Map<string, GleapBoard>();
  for (const b of list) {
    const type = clean(b.type);
    if (type) boards.set(type, { type, name: clean(b.menuName) ?? clean(b.name) ?? type, path: clean(b.path) ?? type.toLowerCase() });
  }
  return boards;
}

/** Link do ticket no painel do Gleap: /projects/<projeto>/<caminho do board>/<id>. */
export function gleapTicketUrl(path: string, ticketId: string): string {
  return `https://app.gleap.io/projects/${process.env.GLEAP_PROJECT_ID || DEFAULT_PROJECT}/${path}/${ticketId}`;
}

function toTicketRow(t: Record<string, unknown>, boards: Map<string, GleapBoard>): GleapTicketRow | null {
  const id = clean(t.id ?? t._id);
  if (!id) return null;
  const session = (t.session ?? {}) as Record<string, unknown>;
  const agent = (t.processingUser ?? null) as Record<string, unknown> | null;
  const agentName = agent ? [clean(agent.firstName), clean(agent.lastName)].filter(Boolean).join(" ") || null : null;
  const type = clean(t.type) ?? "UNKNOWN";
  const board = boards.get(type);
  return {
    id,
    bug_id: typeof t.bugId === "number" ? t.bugId : null,
    type,
    board_name: board?.name ?? null,
    url: board ? gleapTicketUrl(board.path, id) : null,
    status: clean(t.status) ?? "OPEN",
    title: clean(t.title),
    session_user_id: clean(session.userId),
    session_email: clean(session.email)?.toLowerCase() ?? null,
    assignee_name: agentName,
    assignee_email: agent ? (clean(agent.email)?.toLowerCase() ?? null) : null,
    has_agent_reply: t.hasAgentReply === true,
    gleap_created_at: isoOrNull(t.createdAt),
    gleap_updated_at: isoOrNull(t.updatedAt),
  };
}

/** Todos os tickets ativos (OPEN e INPROGRESS). Algumas centenas: páginas de 100. */
export async function listActiveGleapTickets(): Promise<GleapTicketRow[]> {
  // Sem os boards, os tickets entram sem nome de board e sem link.
  const boards = await listGleapBoards().catch(() => new Map<string, GleapBoard>());
  const out: GleapTicketRow[] = [];
  for (const status of ACTIVE_TICKET_STATUSES) {
    // A paginação do Gleap não passa de ~10 mil; os ativos ficam bem abaixo disso.
    for (let skip = 0; skip < 10_000; skip += 100) {
      const res = await fetch(`${GLEAP_API_BASE}/tickets?limit=100&skip=${skip}&status=${status}&sort=-updatedAt`, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`tickets do Gleap responderam ${res.status}`);
      const body = (await res.json()) as { tickets?: Record<string, unknown>[] };
      const page = body.tickets ?? [];
      for (const t of page) {
        const row = toTicketRow(t, boards);
        if (row) out.push(row);
      }
      if (page.length < 100) break;
    }
  }
  return out;
}

// =============================================================================
// Formulário verificado: sessões pelo e-mail e gravação do telefone
// =============================================================================
/** Sessões do Gleap com exatamente este e-mail. Lança se a busca falhar. */
export async function findGleapSessionsByEmail(email: string): Promise<GleapSession[]> {
  const target = email.trim().toLowerCase();
  if (!target.includes("@")) return [];
  return (await searchSessions(target)).filter((s) => s.id && s.email === target);
}

/** Grava o telefone (+55DDDNUMERO) numa sessão do Gleap. */
export async function updateGleapSessionPhone(sessionId: string, phone: string): Promise<void> {
  const res = await fetch(`${GLEAP_API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gleap respondeu ${res.status} ao gravar o telefone`);
}
