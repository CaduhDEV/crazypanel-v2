"use client";

import { createContext, useContext, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FileText, Loader2, Mic, Paperclip, SendHorizontal, Smile, Square, StickyNote, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createMediaUpload, sendMediaMessage, sendTextMessage } from "@/lib/tickets/actions";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import { VOICE_NOTE_PREFIX, type Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Kbd, Tip } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiGrid } from "@/components/conversation/emoji-grid";
import { messageSnippet } from "@/components/conversation/message-utils";

export interface ComposerHandle {
  attach: (file: File) => void;
  focus: () => void;
}

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 600;

export function Composer({
  ref,
  ticketId,
  disabled,
  replyTo,
  replyAuthor,
  onCancelReply,
}: {
  ref?: Ref<ComposerHandle>;
  ticketId: string;
  disabled: boolean;
  replyTo: Message | null;
  replyAuthor: string | null;
  onCancelReply: () => void;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Troca o anexo e mantém a URL de prévia (imagem/vídeo) junto, liberando a anterior.
  const previewRef = useRef<string | null>(null);
  const setAttachment = (f: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = f && /^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : null;
    setPreview(previewRef.current);
    setFile(f);
  };

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const attach = (f: File) => {
    if (note) setNote(false);
    if (f.size > MAX_BYTES) return void toast.error("O arquivo passa do limite de 100 MB.");
    setAttachment(f);
  };

  useImperativeHandle(ref, () => ({ attach, focus: () => textareaRef.current?.focus() }));

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Altura automática (até ~8 linhas).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const uploadAndSend = async (f: File, caption: string | undefined, durationSeconds?: number) => {
    const mime = f.type || "application/octet-stream";
    const up = await createMediaUpload({ ticketId, fileName: f.name, mime, size: f.size });
    if (!up.ok) throw new Error(up.error);
    const { error } = await createClient()
      .storage.from(up.data.bucket)
      .uploadToSignedUrl(up.data.path, up.data.token, f, { contentType: mime });
    if (error) throw new Error("Não foi possível enviar o arquivo. Tente de novo.");
    const res = await sendMediaMessage({
      ticketId,
      path: up.data.path,
      fileName: f.name,
      mime,
      size: f.size,
      caption,
      replyToId: replyTo?.id,
      durationSeconds,
    });
    if (!res.ok) throw new Error(res.error);
    if (res.data.status === "failed") throw new Error(res.data.error ?? "Falha no envio.");
  };

  const submit = async () => {
    const body = text.trim();
    if (sending || disabled || (!body && !file)) return;
    setSending(true);
    const snapshot = { text, file, replyTo };
    setText("");
    setAttachment(null);
    onCancelReply();

    try {
      if (snapshot.file) {
        await uploadAndSend(snapshot.file, body || undefined);
      } else {
        const res = await sendTextMessage({ ticketId, text: body, replyToId: snapshot.replyTo?.id, note });
        if (!res.ok) throw new Error(res.error);
        if (res.data.status === "failed") toast.error(res.data.error ?? "Falha no envio. Use “Reenviar” na mensagem.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio.");
      setText(snapshot.text);
      setAttachment(snapshot.file);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const sendVoice = async (blob: Blob, seconds: number) => {
    setSending(true);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      const voice = new File([blob], `${VOICE_NOTE_PREFIX}${Date.now()}.${ext}`, { type: blob.type.split(";")[0] });
      await uploadAndSend(voice, undefined, seconds);
      onCancelReply();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar o áudio.");
    } finally {
      setSending(false);
    }
  };

  if (disabled) {
    return (
      <div className="border-t border-border px-4 py-3 text-center text-sm text-muted-foreground">
        Atendimento finalizado. Novas mensagens do lead reabrem ou criam outro atendimento.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      {replyTo && (
        <div className="flex items-start gap-2 rounded-md border border-border border-l-2 border-l-primary bg-muted/60 px-3 py-1.5 text-xs">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold text-primary dark:text-[#9fc0ef]">Respondendo a {replyAuthor ?? "mensagem"}</span>
            <span className="truncate text-muted-foreground">{messageSnippet(replyTo)}</span>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onCancelReply} aria-label="Cancelar resposta">
            <X />
          </Button>
        </div>
      )}

      {file && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 p-2">
          {preview && file.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-12 rounded object-cover" />
          ) : preview ? (
            <video src={preview} className="size-12 rounded object-cover" muted />
          ) : (
            <span className="flex size-12 items-center justify-center rounded bg-primary-soft text-primary dark:text-[#9fc0ef]">
              <FileText className="size-5" />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(file.size)} · o texto abaixo vira a legenda</span>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={() => setAttachment(null)} aria-label="Remover anexo">
            <X />
          </Button>
        </div>
      )}

      <VoiceRecorder disabled={sending} onRecorded={sendVoice}>
        <div
          className={cn(
            "flex items-end gap-1 rounded-lg border bg-card px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15",
            note ? "border-note-border bg-note" : "border-input",
          )}
        >
          <Tip label="Anexar arquivo">
            <Button variant="ghost" size="icon-sm" onClick={() => fileInputRef.current?.click()} disabled={note} aria-label="Anexar arquivo">
              <Paperclip />
            </Button>
          </Tip>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attach(f);
              e.target.value = "";
            }}
          />
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Emojis">
                <Smile />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-2">
              <EmojiGrid
                onPick={(e) => {
                  setText((t) => t + e);
                  textareaRef.current?.focus();
                }}
              />
            </PopoverContent>
          </Popover>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape" && replyTo) {
                onCancelReply();
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files][0];
              if (pasted) {
                e.preventDefault();
                attach(pasted);
              }
            }}
            rows={1}
            placeholder={note ? "Nota interna: só a equipe vê" : file ? "Legenda (opcional)" : "Mensagem"}
            aria-label={note ? "Nota interna" : "Mensagem"}
            className="scroll-thin max-h-[200px] min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground/80"
          />

          <Tip label={note ? "Voltar para mensagem" : "Nota interna (não vai para o WhatsApp)"}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setNote((n) => !n);
                setAttachment(null);
              }}
              aria-pressed={note}
              aria-label="Nota interna"
              className={cn(note && "bg-note-border/40 text-note-foreground hover:bg-note-border/60")}
            >
              <StickyNote />
            </Button>
          </Tip>
          {!text.trim() && !file && !note ? (
            <VoiceRecorder.Trigger />
          ) : (
            <Tip label="Enviar (Enter)">
              <Button size="icon-sm" onClick={submit} disabled={sending} aria-label="Enviar">
                {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
              </Button>
            </Tip>
          )}
        </div>
      </VoiceRecorder>

      {/* <p className="hidden text-[11px] text-muted-foreground sm:block">
        <Kbd>Enter</Kbd> envia · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> quebra linha · arraste ou cole arquivos na conversa
      </p> */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gravação de voz (MediaRecorder). Prefere OGG/Opus, formato nativo do WhatsApp.
// ---------------------------------------------------------------------------
const RecorderContext = createContext<{ start: () => void; disabled: boolean } | null>(null);

function pickMime(): string | undefined {
  const options = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
}

function VoiceRecorder({
  children,
  disabled,
  onRecorded,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onRecorded: (blob: Blob, seconds: number) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORDING_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => () => recorderRef.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: pickMime() });
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        if (!cancelledRef.current && chunksRef.current.length) {
          onRecorded(new Blob(chunksRef.current, { type: recorder.mimeType }), duration);
        }
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setSeconds(0);
      recorder.start(250);
      setRecording(true);
    } catch {
      toast.error("Não foi possível usar o microfone. Confira a permissão do navegador.");
    }
  };

  const stop = (cancel: boolean) => {
    cancelledRef.current = cancel;
    recorderRef.current?.stop();
  };

  if (recording) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive-soft px-3 py-2">
        <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
        <span className="flex-1 font-mono text-sm tabular text-destructive">Gravando {formatDuration(seconds)}</span>
        <Button variant="ghost" size="sm" onClick={() => stop(true)}>
          <Trash2 /> Descartar
        </Button>
        <Button size="sm" onClick={() => stop(false)}>
          <Square className="size-3.5 fill-current" /> Enviar áudio
        </Button>
      </div>
    );
  }

  return <RecorderContext.Provider value={{ start, disabled }}>{children}</RecorderContext.Provider>;
}

VoiceRecorder.Trigger = function VoiceTrigger() {
  const ctx = useContext(RecorderContext);
  return (
    <Tip label="Gravar áudio">
      <Button variant="ghost" size="icon-sm" onClick={ctx?.start} disabled={ctx?.disabled} aria-label="Gravar áudio">
        {ctx?.disabled ? <Loader2 className="animate-spin" /> : <Mic />}
      </Button>
    </Tip>
  );
};
