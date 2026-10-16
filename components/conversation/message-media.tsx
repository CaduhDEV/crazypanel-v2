"use client";

import { useState, useTransition } from "react";
import { Download, FileText, ImageOff, Loader2, MapPin, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { retryMediaDownload } from "@/lib/tickets/actions";
import { formatBytes } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const src = (m: Message, download = false) => `/api/media/${m.id}${download ? "?download" : ""}`;

export function MessageMedia({ message }: { message: Message }) {
  if (message.kind === "location") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <MapPin className="size-4" /> Localização
      </span>
    );
  }
  if (!["image", "video", "audio", "document", "sticker"].includes(message.kind)) return null;

  if (message.media_status === "pending" || (!message.media_path && message.media_status !== "failed")) {
    return (
      <div className="flex h-24 w-56 max-w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Baixando mídia…
      </div>
    );
  }
  if (message.media_status === "failed") return <FailedMedia message={message} />;

  switch (message.kind) {
    case "image":
    case "sticker":
      return <ImageMedia message={message} />;
    case "video":
      return (
        <video
          controls
          preload="metadata"
          src={src(message)}
          className="max-h-80 w-80 max-w-full rounded-md bg-black"
        />
      );
    case "audio":
      return <audio controls preload="metadata" src={src(message)} className="h-10 w-72 max-w-full" />;
    default:
      return (
        <a
          href={src(message, true)}
          className="flex w-72 max-w-full items-center gap-3 rounded-md border border-border bg-muted/60 p-2.5 transition-colors hover:bg-accent"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary dark:text-[#9fc0ef]">
            <FileText className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium">{message.media_name ?? "Documento"}</span>
            <span className="text-xs text-muted-foreground">
              {[message.media_name?.split(".").pop()?.toUpperCase(), formatBytes(message.media_size)].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Download className="size-4 shrink-0 text-muted-foreground" />
        </a>
      );
  }
}

function ImageMedia({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const isSticker = message.kind === "sticker";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block overflow-hidden rounded-md" aria-label="Ampliar imagem">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src(message)}
          alt={message.body ?? "Imagem"}
          loading="lazy"
          className={isSticker ? "size-32 object-contain" : "max-h-80 w-auto max-w-[min(20rem,100%)] object-cover"}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(64rem,calc(100vw-2rem))] gap-3 p-3">
          <DialogTitle className="sr-only">Imagem</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(message)} alt={message.body ?? "Imagem"} className="max-h-[80dvh] w-full rounded-md object-contain" />
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <a href={src(message, true)}>
                <Download /> Baixar
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FailedMedia({ message }: { message: Message }) {
  const [pending, start] = useTransition();
  const retry = () =>
    start(async () => {
      const res = await retryMediaDownload({ messageId: message.id });
      if (!res.ok) toast.error(res.error);
    });
  return (
    <div className="flex w-64 max-w-full items-center gap-3 rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
      <ImageOff className="size-4 shrink-0" />
      <span className="flex-1">Não foi possível baixar a mídia.</span>
      {!message.from_me && (
        <Button variant="ghost" size="icon-xs" onClick={retry} disabled={pending} aria-label="Tentar de novo">
          {pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
        </Button>
      )}
    </div>
  );
}
