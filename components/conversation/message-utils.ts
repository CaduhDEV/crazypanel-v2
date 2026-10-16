import { contactLabel } from "@/lib/utils";
import type { Member } from "@/components/app/app-context";
import type { ContactLite, QuotedLite } from "@/components/conversation/use-thread";
import type { Message } from "@/lib/types";

export interface Author {
  name: string;
  seed: string;
  tag: "Equipe" | "Parceiro" | "Nota interna" | null;
}

type AuthorSource = Pick<Message, "from_me" | "is_note" | "author_id" | "contact_id" | "sender_name">;

export function resolveAuthor(
  m: AuthorSource,
  contacts: Map<string, ContactLite>,
  memberById: Map<string, Member>,
): Author {
  if (m.is_note) {
    const name = (m.author_id && memberById.get(m.author_id)?.name) || m.sender_name || "Equipe";
    return { name, seed: m.author_id ?? name, tag: "Nota interna" };
  }
  if (m.from_me) {
    const member = m.author_id ? memberById.get(m.author_id) : null;
    const name = member?.name ?? m.sender_name ?? "Equipe (pelo celular)";
    return { name, seed: m.author_id ?? "me", tag: null };
  }
  const contact = m.contact_id ? contacts.get(m.contact_id) : undefined;
  const name = contact?.name || m.sender_name || contactLabel(contact);
  const tag = contact?.kind === "team" ? "Equipe" : contact?.kind === "partner" ? "Parceiro" : null;
  return { name, seed: m.contact_id ?? name, tag };
}

const KIND_LABELS: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  poll: "Enquete",
};

/** Texto curto de uma mensagem (citações e banner de resposta). */
export function messageSnippet(m: Pick<QuotedLite, "body" | "kind" | "media_name">): string {
  if (m.body?.trim()) return m.body.trim();
  if (m.kind === "document" && m.media_name) return m.media_name;
  return KIND_LABELS[m.kind] ?? "Mensagem";
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Frequentes", emojis: ["👍", "🙏", "✅", "😉", "😊", "🙂", "👏", "🚀", "💙", "🔥", "🤝", "👀"] },
  { label: "Rostos", emojis: ["😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😇", "🥰", "😍", "🤩", "😎", "🤔", "🤨", "😐", "😶", "🙄", "😬", "😮", "😯", "😢", "😭", "😤", "😡", "🤯", "😱", "🥲", "😴"] },
  { label: "Gestos", emojis: ["👋", "🤚", "✋", "👌", "✌️", "🤞", "🤙", "👈", "👉", "👆", "👇", "☝️", "👎", "✊", "🙌", "💪"] },
  { label: "Símbolos", emojis: ["❤️", "🧡", "💛", "💚", "💜", "🖤", "💯", "⚠️", "❗", "❓", "⏳", "⌛", "📌", "📎", "🔗", "📞", "💬", "🎉", "✨", "⭐", "🐛", "🛠️", "📊", "🧩"] },
];
