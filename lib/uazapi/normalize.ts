// Converte o payload `messages` da uazapi numa mensagem do domínio.
// O formato do `content` varia com o tipo; a leitura é defensiva e aceita
// chaves em camelCase ou PascalCase.

import { splitIdentity, type UazMessage } from "@/lib/uazapi/client";
import type { MessageKind } from "@/lib/types";

export interface NormalizedMessage {
  waId: string;
  chatId: string;
  isGroup: boolean;
  fromMe: boolean;
  wasSentByApi: boolean;
  phone: string | null;
  lid: string | null;
  senderName: string | null;
  kind: MessageKind;
  body: string | null;
  hasMedia: boolean;
  mime: string | null;
  fileName: string | null;
  durationSeconds: number | null;
  quotedWaId: string | null;
  /** Reação: id da mensagem alvo. emoji vazio = reação removida. */
  reaction: { targetWaId: string; emoji: string } | null;
  edited: boolean;
  sentAt: Date;
  trackSource: string | null;
  trackId: string | null;
}

const MEDIA_KINDS = new Set<MessageKind>(["image", "video", "audio", "document", "sticker"]);

// Tipos de sistema que nunca viram mensagem no painel.
const IGNORED_TYPES = ["protocol", "senderkeydistribution", "groupstatus", "pollupdate", "keepinchat", "pin", "call"];

export function normalizeMessage(msg: UazMessage | null | undefined): NormalizedMessage | null {
  if (!msg) return null;
  const waId = str(msg.messageid) ?? lastSegment(str(msg.id));
  const chatId = str(msg.chatid);
  if (!waId || !chatId) return null;

  const type = (str(msg.messageType) ?? "").toLowerCase();
  const mediaType = (str(msg.mediaType) ?? "").toLowerCase();
  const content = asObject(msg.content);

  const { phone, lid } = splitIdentity(str(msg.sender_pn), str(msg.sender_lid), str(msg.sender));

  // Reação: `reaction` traz o id da mensagem alvo e `text` o emoji.
  const reactionTarget = str(msg.reaction) ?? (type.includes("reaction") ? str(pick(asObject(pick(content, "key")), "id")) : null);
  const reaction = reactionTarget || type.includes("reaction")
    ? reactionTarget
      ? { targetWaId: reactionTarget, emoji: str(msg.text) ?? str(pick(content, "text")) ?? "" }
      : null
    : null;

  if (!reaction && IGNORED_TYPES.some((t) => type.includes(t))) return null;
  if (type === "error") return null;

  const kind = reaction ? "other" : detectKind(type, mediaType, content);
  const caption = str(pick(content, "caption"));
  const body = str(msg.text) ?? caption ?? (typeof msg.content === "string" ? str(msg.content) : null) ?? str(pick(content, "text"));
  const hasMedia = MEDIA_KINDS.has(kind);

  const contextInfo = asObject(pick(content, "contextInfo"));
  const quotedWaId = str(msg.quoted) ?? str(pick(contextInfo, "stanzaId")) ?? str(pick(contextInfo, "stanzaID"));

  const ts = typeof msg.messageTimestamp === "number" && msg.messageTimestamp > 0 ? msg.messageTimestamp : Date.now();
  const sentAt = new Date(ts < 1e12 ? ts * 1000 : ts);

  return {
    waId,
    chatId,
    isGroup: msg.isGroup === true || chatId.endsWith("@g.us"),
    fromMe: msg.fromMe === true,
    wasSentByApi: msg.wasSentByApi === true,
    phone,
    lid,
    senderName: str(msg.senderName),
    kind,
    body: body ?? (kind === "location" ? locationLabel(content) : null),
    hasMedia,
    mime: hasMedia ? str(pick(content, "mimetype")) : null,
    fileName: hasMedia ? str(pick(content, "fileName")) ?? str(pick(content, "title")) : null,
    durationSeconds: hasMedia ? num(pick(content, "seconds")) : null,
    quotedWaId,
    reaction,
    edited: !!str(msg.edited),
    sentAt,
    trackSource: str(msg.track_source),
    trackId: str(msg.track_id),
  };
}

function detectKind(type: string, mediaType: string, content: Record<string, unknown>): MessageKind {
  const t = `${type} ${mediaType}`;
  if (t.includes("sticker")) return "sticker";
  if (t.includes("image")) return "image";
  if (t.includes("video") || t.includes("ptv")) return "video";
  if (t.includes("audio") || t.includes("ptt") || t.includes("voice")) return "audio";
  if (t.includes("document")) return "document";
  if (t.includes("location")) return "location";
  if (t.includes("contact")) return "contact";
  if (t.includes("poll")) return "poll";
  if (t.includes("conversation") || t.includes("extendedtext") || t.includes("text")) return "text";
  // Tipo desconhecido com arquivo: decide pelo mime.
  const mime = (str(pick(content, "mimetype")) ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime) return "document";
  return "text";
}

function locationLabel(content: Record<string, unknown>): string | null {
  const lat = num(pick(content, "degreesLatitude"));
  const lng = num(pick(content, "degreesLongitude"));
  const name = str(pick(content, "name")) ?? str(pick(content, "address"));
  if (lat == null || lng == null) return name;
  return `${name ? `${name} · ` : ""}https://maps.google.com/?q=${lat},${lng}`;
}

// --- leitura defensiva --------------------------------------------------------
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v === "string" && v.startsWith("{")) {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Lê uma chave aceitando camelCase e PascalCase ("caption" ou "Caption"). */
function pick(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const pascal = key[0].toUpperCase() + key.slice(1);
  if (pascal in obj) return obj[pascal];
  const lower = key.toLowerCase();
  const found = Object.keys(obj).find((k) => k.toLowerCase() === lower);
  return found ? obj[found] : undefined;
}

function lastSegment(id: string | null): string | null {
  if (!id) return null;
  const parts = id.split(":");
  return parts[parts.length - 1] || null;
}
