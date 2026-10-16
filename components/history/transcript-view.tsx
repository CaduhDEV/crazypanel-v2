"use client";

import { forwardRef, Fragment } from "react";
import { cn, formatDayLabel, formatDuration, formatPhone, formatTaxId, formatTime, nameColor } from "@/lib/utils";
import { CLOSE_REASONS, type Message, type MessageReaction } from "@/lib/types";
import { useApp, type Member } from "@/components/app/app-context";
import { Avatar } from "@/components/ui/avatar";
import { FormattedText } from "@/components/conversation/formatted-text";
import { MessageMedia } from "@/components/conversation/message-media";
import { messageSnippet, resolveAuthor } from "@/components/conversation/message-utils";
import { authorOf, categoryLabel, eventText, isTeamSide, type Transcript } from "@/components/history/use-transcript";

/** Reações agrupadas por emoji, com quem reagiu. */
function groupReactions(list: MessageReaction[]) {
  const map = new Map<string, string[]>();
  for (const r of list) map.set(r.emoji, [...(map.get(r.emoji) ?? []), r.reactor_name ?? (r.reactor_key === "me" ? "Equipe" : "Lead")]);
  return [...map.entries()].map(([emoji, names]) => ({ emoji, names }));
}

const MEDIA_LABEL: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  poll: "Enquete",
};

const fullDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const fmt = (iso: string | null) => (iso ? fullDate.format(new Date(iso)) : "—");

/** Resumo do atendimento (cabeçalho da tela e do PDF). */
export function transcriptSummary(t: Transcript, memberById: Map<string, Member>) {
  const k = t.ticket;
  const assignee = k.assignee_id ? memberById.get(k.assignee_id)?.name : null;
  const firstResponse =
    k.first_response_at && Date.parse(k.first_response_at) >= Date.parse(k.opened_at)
      ? formatDuration((Date.parse(k.first_response_at) - Date.parse(k.opened_at)) / 1000)
      : null;
  const duration = k.closed_at ? formatDuration((Date.parse(k.closed_at) - Date.parse(k.opened_at)) / 1000) : null;
  return {
    title: `Atendimento #${k.number}`,
    group: k.group?.name ?? "Grupo",
    status: k.status === "open" ? "Aberto" : (categoryLabel(k.category) ?? CLOSE_REASONS[k.close_reason ?? "resolved"]),
    assignee: assignee ?? "Sem responsável",
    opened: fmt(k.opened_at),
    closed: k.closed_at ? fmt(k.closed_at) : null,
    firstResponse,
    duration,
    closeNote: k.close_note,
  };
}

// =============================================================================
// Tela: conversa em modo leitura
// =============================================================================
export function TranscriptView({ transcript: t }: { transcript: Transcript }) {
  const { memberById } = useApp();
  return (
    <div className="flex flex-col gap-2.5">
      {t.timeline.map((item, i) => {
        const prev = t.timeline[i - 1];
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(item.at).toDateString();
        return (
          <Fragment key={item.type === "message" ? item.message.id : `e${item.event.id}`}>
            {newDay && (
              <div className="flex justify-center py-1">
                <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {formatDayLabel(item.at)}
                </span>
              </div>
            )}
            {item.type === "message" ? (
              <ReadOnlyMessage message={item.message} t={t} memberById={memberById} />
            ) : (
              <div className="flex items-center gap-3 px-6 py-0.5 text-[11.5px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span className="text-center">
                  {eventText(item.event, t, memberById)} · {formatTime(item.at)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
          </Fragment>
        );
      })}
      {t.timeline.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Sem mensagens neste atendimento.</p>}
    </div>
  );
}

function ReadOnlyMessage({ message: m, t, memberById }: { message: Message; t: Transcript; memberById: Map<string, Member> }) {
  const team = isTeamSide(m, t);
  const author = authorOf(m, t, memberById);
  const reactions = groupReactions(t.thread.reactionsByMessage.get(m.id) ?? []);
  const quoted = m.quoted_wa_id ? t.thread.quotedByWaId.get(m.quoted_wa_id) : undefined;
  const quotedAuthor = quoted ? resolveAuthor({ ...quoted, is_note: false }, t.thread.contacts, memberById) : null;

  if (m.is_note) {
    return (
      <div className="mx-auto w-full max-w-[min(44rem,96%)] rounded-lg border border-note-border bg-note px-3 py-2 text-[13px] text-note-foreground">
        <span className="mb-0.5 block text-[11px] font-semibold">Nota interna · {author.name}</span>
        <FormattedText text={m.body ?? ""} className="whitespace-pre-wrap break-words" />
        <span className="mt-1 block text-right text-[10.5px] opacity-70">{formatTime(m.sent_at)}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full px-1", team ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[min(42rem,88%)] flex-col gap-1", team && "items-end")}>
        <div
          className={cn(
            "flex flex-col gap-1 rounded-xl border px-3 py-2 text-[13.5px] shadow-sm",
            team ? "rounded-tr-sm border-bubble-me-border bg-bubble-me" : "rounded-tl-sm border-border bg-bubble",
          )}
        >
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] font-semibold" style={team ? undefined : { color: nameColor(author.seed) }}>
            {author.name}
            {author.tag && <span className="text-[10.5px] font-medium text-muted-foreground">{author.tag}</span>}
            {author.company && <span className="text-[10.5px] font-normal text-muted-foreground">· {author.company}</span>}
          </span>
          {quoted && (
            <span className="rounded-md border-l-2 border-primary/60 bg-muted/60 px-2 py-1 text-[12px] text-muted-foreground">
              <span className="block font-medium text-foreground/80">{quotedAuthor?.name}</span>
              <span className="line-clamp-2">{messageSnippet(quoted)}</span>
            </span>
          )}
          {m.deleted_at ? (
            <span className="italic text-muted-foreground">Mensagem apagada</span>
          ) : (
            <>
              {m.kind !== "text" && <MessageMedia message={m} />}
              {m.body && <FormattedText text={m.body} className="whitespace-pre-wrap break-words" />}
            </>
          )}
          <span className="self-end text-[10.5px] text-muted-foreground">
            {m.edited_at && "editada · "}
            {formatTime(m.sent_at)}
          </span>
        </div>
        {reactions.length > 0 && (
          <span className={cn("-mt-2 flex flex-wrap gap-1 px-2", team && "justify-end")}>
            {reactions.map((r) => (
              <span key={r.emoji} title={r.names.join(", ")} className="rounded-full border border-border bg-card px-1.5 py-px text-[12px] shadow-sm">
                {r.emoji}
                {r.names.length > 1 && <span className="ml-0.5 text-[10.5px] text-muted-foreground">{r.names.length}</span>}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Lista de leads com empresa (cabeçalho do modal). */
export function LeadsSummary({ transcript: t }: { transcript: Transcript }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {t.leads.map((l) => (
        <li key={l.id} className={cn("flex items-center gap-2 rounded-md border border-border px-2 py-1", l.removed && "opacity-60")}>
          <Avatar name={l.name} src={l.avatarUrl} size="xs" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px] font-medium">
              {l.name}
              {l.owner && <span className="ml-1 text-[10.5px] font-normal text-muted-foreground">principal</span>}
              {l.removed && <span className="ml-1 text-[10.5px] font-normal text-muted-foreground">retirado</span>}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {[l.phone && formatPhone(l.phone), l.company?.name ?? (l.kind === "customer" ? "sem empresa" : l.kind === "team" ? "Equipe" : "Parceiro")]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// =============================================================================
// PDF: versão para impressão (A4, tema claro fixo, estilos inline)
// =============================================================================
const C = {
  text: "#131a24",
  muted: "#5b6779",
  border: "#dbe3ef",
  bubble: "#ffffff",
  bubbleMe: "#e3ecf9",
  bubbleMeBorder: "#c9d9f1",
  note: "#fdf4d3",
  noteBorder: "#ecd78f",
  primary: "#2f62a8",
  page: "#ffffff",
  soft: "#f4f7fc",
};

/** Largura de uma página A4 a 96 dpi. A altura é dividida em páginas na exportação. */
export const PDF_PAGE_WIDTH = 794;
export const PDF_PAGE_HEIGHT = 1123;

export const PrintableTranscript = forwardRef<HTMLDivElement, { transcript: Transcript; memberById: Map<string, Member>; generatedBy: string }>(
  function PrintableTranscript({ transcript: t, memberById, generatedBy }, ref) {
    const s = transcriptSummary(t, memberById);
    return (
      <div
        ref={ref}
        style={{
          width: PDF_PAGE_WIDTH,
          background: C.page,
          color: C.text,
          fontFamily: "Helvetica, Arial, 'Segoe UI', sans-serif",
          fontSize: 12.5,
          lineHeight: 1.45,
          padding: "0 44px",
          boxSizing: "border-box",
        }}
      >
        {/* Cabeçalho */}
        <div data-pdf-block style={{ paddingTop: 4, paddingBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `2px solid ${C.primary}`, paddingBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, color: C.muted, letterSpacing: 1, textTransform: "uppercase" }}>CrazyPanel · DataCrazy</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{s.title}</div>
              <div style={{ color: C.muted }}>{s.group}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: C.muted }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.status}</div>
              <div>Gerado por {generatedBy}</div>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 11.5 }}>
            <tbody>
              <tr>
                <Cell label="Responsável" value={s.assignee} />
                <Cell label="Aberto em" value={s.opened} />
                <Cell label="Finalizado em" value={s.closed ?? "—"} />
              </tr>
              <tr>
                <Cell label="1ª resposta" value={s.firstResponse ?? "—"} />
                <Cell label="Duração" value={s.duration ?? "—"} />
                <Cell label="Mensagens" value={String(t.thread.messages.filter((m) => !m.is_note).length)} />
              </tr>
            </tbody>
          </table>
          {s.closeNote && (
            <div style={{ marginTop: 8, fontSize: 11.5, background: C.soft, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px" }}>
              <b>Observação ao finalizar:</b> {s.closeNote}
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>Leads</div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4, fontSize: 11.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.muted }}>
                <th style={th}>Nome</th>
                <th style={th}>Telefone</th>
                <th style={th}>Empresa</th>
                <th style={th}>CNPJ</th>
              </tr>
            </thead>
            <tbody>
              {t.leads.map((l) => (
                <tr key={l.id}>
                  <td style={td}>
                    {l.name}
                    {l.owner ? " (principal)" : ""}
                    {l.removed ? " (retirado)" : ""}
                  </td>
                  <td style={td}>{l.phone ? formatPhone(l.phone) : "—"}</td>
                  <td style={td}>{l.company?.name ?? (l.kind === "team" ? "Equipe" : l.kind === "partner" ? "Parceiro" : "—")}</td>
                  <td style={td}>{l.company?.cnpj ? formatTaxId(l.company.cnpj) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Conversa */}
        {t.timeline.map((item, i) => {
          const prev = t.timeline[i - 1];
          const newDay = !prev || new Date(prev.at).toDateString() !== new Date(item.at).toDateString();
          return (
            <div key={item.type === "message" ? item.message.id : `e${item.event.id}`} data-pdf-block style={{ paddingBottom: 8 }}>
              {newDay && (
                <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
                  <span style={{ border: `1px solid ${C.border}`, borderRadius: 999, padding: "2px 10px", fontSize: 10.5, color: C.muted }}>
                    {formatDayLabel(item.at)}
                  </span>
                </div>
              )}
              {item.type === "message" ? (
                <PrintMessage message={item.message} t={t} memberById={memberById} />
              ) : (
                <div style={{ textAlign: "center", fontSize: 10.5, color: C.muted, padding: "2px 0" }}>
                  — {eventText(item.event, t, memberById)} · {formatTime(item.at)} —
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

const th: React.CSSProperties = { padding: "4px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 };
const td: React.CSSProperties = { padding: "4px 6px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" };

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <td style={{ padding: "3px 6px 3px 0", width: "33%" }}>
      <span style={{ color: C.muted }}>{label}: </span>
      <b>{value}</b>
    </td>
  );
}

function PrintMessage({ message: m, t, memberById }: { message: Message; t: Transcript; memberById: Map<string, Member> }) {
  const team = isTeamSide(m, t);
  const author = authorOf(m, t, memberById);
  const reactions = groupReactions(t.thread.reactionsByMessage.get(m.id) ?? []);
  const quoted = m.quoted_wa_id ? t.thread.quotedByWaId.get(m.quoted_wa_id) : undefined;
  const quotedAuthor = quoted ? resolveAuthor({ ...quoted, is_note: false }, t.thread.contacts, memberById) : null;
  const media = m.kind !== "text" && !m.deleted_at;
  const image = media && (m.kind === "image" || m.kind === "sticker") && m.media_status === "ready";

  if (m.is_note) {
    return (
      <div style={{ background: C.note, border: `1px solid ${C.noteBorder}`, borderRadius: 8, padding: "6px 10px", margin: "0 40px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700 }}>Nota interna · {author.name}</div>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
        <div style={{ textAlign: "right", fontSize: 10, color: C.muted }}>{formatTime(m.sent_at)}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: team ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: team ? "flex-end" : "flex-start" }}>
        <div
          style={{
            background: team ? C.bubbleMe : C.bubble,
            border: `1px solid ${team ? C.bubbleMeBorder : C.border}`,
            borderRadius: 10,
            [team ? "borderTopRightRadius" : "borderTopLeftRadius"]: 3,
            padding: "6px 10px",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: team ? C.primary : nameColor(author.seed) }}>
            {author.name}
            {author.tag && <span style={{ fontWeight: 400, color: C.muted }}> · {author.tag}</span>}
            {author.company && <span style={{ fontWeight: 400, color: C.muted }}> · {author.company}</span>}
          </div>
          {quoted && (
            <div style={{ borderLeft: `2px solid ${C.primary}`, background: C.soft, borderRadius: 4, padding: "3px 6px", margin: "3px 0", fontSize: 11, color: C.muted }}>
              <b style={{ color: C.text }}>{quotedAuthor?.name}</b>
              <div>{messageSnippet(quoted).slice(0, 200)}</div>
            </div>
          )}
          {m.deleted_at ? (
            <i style={{ color: C.muted }}>Mensagem apagada</i>
          ) : (
            <>
              {image && (
                // eslint-disable-next-line @next/next/no-img-element -- capturada pelo html-to-image
                <img src={`/api/media/${m.id}`} alt="" style={{ display: "block", maxWidth: 260, maxHeight: 260, borderRadius: 6, margin: "4px 0" }} />
              )}
              {media && !image && (
                <div style={{ fontSize: 11.5, color: C.muted, margin: "2px 0" }}>
                  [{MEDIA_LABEL[m.kind] ?? "Anexo"}
                  {m.media_name ? `: ${m.media_name}` : ""}]
                </div>
              )}
              {m.body && <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>}
            </>
          )}
          <div style={{ textAlign: "right", fontSize: 10, color: C.muted, marginTop: 2 }}>
            {m.edited_at ? "editada · " : ""}
            {formatTime(m.sent_at)}
          </div>
        </div>
        {reactions.length > 0 && (
          <div style={{ marginTop: -4, padding: "0 8px", display: "flex", gap: 4, flexWrap: "wrap", justifyContent: team ? "flex-end" : "flex-start" }}>
            {reactions.map((r) => (
              <span key={r.emoji} style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 999, padding: "0 6px", fontSize: 11 }}>
                {r.emoji} <span style={{ color: C.muted, fontSize: 10 }}>{r.names.join(", ")}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
