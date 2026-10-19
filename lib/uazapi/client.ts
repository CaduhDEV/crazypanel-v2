// Cliente HTTP da uazapi (somente servidor). Contrato: https://docs.uazapi.com
// Autenticação pelo header `token` da instância. Limite: 10 req/s por instância.

export const TRACK_SOURCE = "crazypanel";

const DEFAULT_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 45_000;

export class UazapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "UazapiError";
  }
}

// ---------------------------------------------------------------------------
// Tipos do contrato (apenas os campos usados)
// ---------------------------------------------------------------------------
export type UazInstanceStatus = "disconnected" | "connecting" | "connected" | "hibernated";

export interface UazInstance {
  id?: string;
  name?: string;
  status?: UazInstanceStatus;
  qrcode?: string;
  paircode?: string;
  profileName?: string;
  profilePicUrl?: string;
  owner?: string;
  lastDisconnectReason?: string;
}

export interface UazMessage {
  id?: string;
  messageid?: string;
  chatid?: string;
  sender?: string;
  senderName?: string;
  sender_pn?: string | null;
  sender_lid?: string | null;
  isGroup?: boolean;
  fromMe?: boolean;
  wasSentByApi?: boolean;
  messageType?: string;
  mediaType?: string;
  messageTimestamp?: number;
  status?: string;
  text?: string;
  quoted?: string;
  edited?: string;
  reaction?: string;
  content?: unknown;
  fileURL?: string;
  track_source?: string;
  track_id?: string;
  error?: string;
}

export interface UazGroupParticipant {
  JID?: string;
  LID?: string;
  PhoneNumber?: string;
  IsAdmin?: boolean;
  IsSuperAdmin?: boolean;
  DisplayName?: string;
}

export interface UazGroup {
  JID: string;
  Name?: string;
  Topic?: string;
  IsAnnounce?: boolean;
  IsParent?: boolean;
  ParticipantCount?: number;
  Participants?: UazGroupParticipant[] | null;
  image_url?: string;
  image_preview_url?: string;
  IsJoinApprovalRequired?: boolean;
  /** Pedidos de entrada pendentes, separados por vírgula (só para admin, com getRequestsParticipants). */
  request_participants?: string;
  request_participants_lid?: string;
}

export type UazParticipantAction = "add" | "remove" | "approve" | "reject" | "promote" | "demote";

export interface UazParticipantResult {
  JID?: string;
  /** 0 = sucesso; 403 = a privacidade da pessoa bloqueou (vem com AddRequest). */
  Error?: number;
  AddRequest?: { Code?: string; Expiration?: string } | null;
}

export interface UazPagination {
  totalRecords?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  nextOffset?: number;
}

export type UazMediaType = "image" | "video" | "document" | "audio" | "ptt" | "sticker";

interface CommonSendFields {
  number: string;
  replyid?: string;
  delay?: number;
  track_source?: string;
  track_id?: string;
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
export class UazapiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    opts: { timeoutMs?: number; retryOn429?: boolean } = {},
  ): Promise<T> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, retryOn429 = false } = opts;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            token: this.token,
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new UazapiError(
          timedOut ? "A uazapi não respondeu a tempo." : "Não foi possível alcançar a uazapi. Confira a Server URL.",
          0,
        );
      }

      // Só leituras repetem após 429 (envios nunca: o primeiro pode ter sido processado).
      if (res.status === 429 && retryOn429 && attempt === 0) {
        const wait = Math.min(Number(res.headers.get("retry-after") ?? 1), 3);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }

      const text = await res.text().catch(() => "");
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!res.ok) {
        throw new UazapiError(errorMessage(res.status, data), res.status, data);
      }
      return data as T;
    }
  }

  // --- Instância -----------------------------------------------------------
  status() {
    return this.request<{ instance?: UazInstance; status?: { connected?: boolean; loggedIn?: boolean; jid?: unknown } }>(
      "GET",
      "/instance/status",
      undefined,
      { retryOn429: true },
    );
  }

  connect(phone?: string) {
    return this.request<{ connected?: boolean; loggedIn?: boolean; instance?: UazInstance }>(
      "POST",
      "/instance/connect",
      phone ? { phone } : {},
    );
  }

  disconnect() {
    return this.request<{ instance?: UazInstance }>("POST", "/instance/disconnect", {});
  }

  setWebhook(url: string) {
    return this.request<unknown>("POST", "/webhook", {
      enabled: true,
      url,
      events: ["messages", "messages_update", "connection", "groups"],
      // Sem "wasSentByApi": os recibos das nossas mensagens precisam chegar. O eco
      // das mensagens enviadas pelo painel é reconhecido pelo track_id.
      excludeMessages: [],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    });
  }

  // --- Grupos ----------------------------------------------------------------
  listGroups(offset = 0, limit = 200) {
    return this.request<{ groups?: UazGroup[]; pagination?: UazPagination }>(
      "POST",
      "/group/list",
      { limit, offset, noParticipants: true },
      { retryOn429: true },
    );
  }

  groupInfo(groupjid: string, opts: { getRequestsParticipants?: boolean } = {}) {
    return this.request<UazGroup>("POST", "/group/info", { groupjid, ...opts }, { retryOn429: true, timeoutMs: 40_000 });
  }

  /** Adiciona, remove, aprova ou recusa pedidos de entrada (exige ser admin do grupo). */
  updateParticipants(groupjid: string, action: UazParticipantAction, participants: string[]) {
    return this.request<{ groupUpdated?: UazParticipantResult[] }>("POST", "/group/updateParticipants", { groupjid, action, participants }, { timeoutMs: 40_000 });
  }

  /** Link https://chat.whatsapp.com/<código> do grupo. */
  groupInviteLink(groupjid: string) {
    return this.request<{ InviteLink?: string; inviteLink?: string; link?: string }>("GET", `/group/invitelink/${encodeURIComponent(groupjid)}`, undefined, { retryOn429: true });
  }

  // --- Contatos ----------------------------------------------------------------
  /** Detalhes do chat; `image`/`imagePreview` são URLs temporárias da foto de perfil. */
  chatDetails(number: string) {
    return this.request<{ image?: string; imagePreview?: string }>(
      "POST",
      "/chat/details",
      { number, preview: true },
      { retryOn429: true },
    );
  }

  // --- Mensagens ---------------------------------------------------------------
  sendText(input: CommonSendFields & { text: string }) {
    return this.request<UazMessage>("POST", "/send/text", { ...input, linkPreview: true }, { timeoutMs: SEND_TIMEOUT_MS });
  }

  sendMedia(input: CommonSendFields & { type: UazMediaType; file: string; text?: string; docName?: string; mimetype?: string }) {
    return this.request<UazMessage>("POST", "/send/media", input, { timeoutMs: 90_000 });
  }

  react(id: string, emoji: string) {
    return this.request<unknown>("POST", "/message/react", { id, text: emoji });
  }

  editMessage(id: string, text: string) {
    return this.request<UazMessage>("POST", "/message/edit", { id, text });
  }

  deleteMessage(id: string) {
    return this.request<unknown>("POST", "/message/delete", { id });
  }

  /** URL pública do arquivo (válida por 2 dias): copie para o Storage. */
  download(id: string) {
    return this.request<{ fileURL?: string; mimetype?: string; transcription?: string }>(
      "POST",
      "/message/download",
      { id, generate_mp3: true, return_link: true },
      { retryOn429: true, timeoutMs: 60_000 },
    );
  }
}

function errorMessage(status: number, data: unknown): string {
  const raw =
    data && typeof data === "object"
      ? String((data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message ?? "")
      : typeof data === "string"
        ? data.slice(0, 200)
        : "";
  if (status === 401) return "Token da instância inválido para esta Server URL.";
  if (status === 404) return raw || "Recurso não encontrado na uazapi.";
  if (status === 429) return "Limite de requisições da uazapi atingido. Aguarde alguns segundos.";
  return raw || `A uazapi respondeu com erro ${status}.`;
}

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------
/** Dígitos de um JID de contato. "5511...@s.whatsapp.net" → "5511...". */
export function jidDigits(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return d || null;
}

/** Separa telefone e @lid a partir dos campos que a uazapi entrega. */
export function splitIdentity(...jids: (string | null | undefined)[]): { phone: string | null; lid: string | null } {
  let phone: string | null = null;
  let lid: string | null = null;
  for (const jid of jids) {
    if (!jid) continue;
    if (jid.endsWith("@lid")) lid ??= jidDigits(jid);
    else if (jid.endsWith("@s.whatsapp.net") || /^\d+$/.test(jid)) phone ??= jidDigits(jid);
  }
  return { phone, lid };
}
