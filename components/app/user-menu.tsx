"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme";
import { BellOff, BellRing, Camera, Loader2, LogOut, Monitor, Moon, Sun, Trash2, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/lib/auth/actions";
import { removeMyAvatar, updateMyAvatar } from "@/lib/profile/actions";
import { ROLE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/components/app/app-context";
import { useSoundEnabled } from "@/components/app/notifier";
import { usePushPermission } from "@/components/app/browser-notifications";

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { profile, settings } = useApp();
  const { theme, setTheme } = useTheme();
  const [sound, setSound] = useSoundEnabled();
  const [permission, requestPush] = usePushPermission();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Selecione uma imagem.");
    startUpload(async () => {
      try {
        const form = new FormData();
        form.set("file", await squareJpeg(file, 256), "avatar.jpg");
        const res = await updateMyAvatar(form);
        if (!res.ok) return void toast.error(res.error);
        toast.success("Foto atualizada.");
        router.refresh();
      } catch {
        toast.error("Não foi possível ler essa imagem.");
      }
    });
  };

  const removePhoto = () =>
    startUpload(async () => {
      const res = await removeMyAvatar();
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });

  return (
    <>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickPhoto} />
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card p-2 text-left transition-colors hover:bg-accent",
          collapsed && "justify-center border-transparent bg-transparent p-1",
        )}
      >
        <Avatar name={profile.name} src={profile.avatar_url} size="sm" />
        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{profile.name}</span>
            <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[profile.role]}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{profile.name}</span>
          <span className="truncate font-normal">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={uploading} onSelect={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Camera />}
          {profile.avatar_url ? "Trocar foto" : "Adicionar foto"}
        </DropdownMenuItem>
        {profile.avatar_url && (
          <DropdownMenuItem disabled={uploading} onSelect={removePhoto}>
            <Trash2 /> Remover foto
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4 text-muted-foreground" /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4 text-muted-foreground" /> Escuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4 text-muted-foreground" /> Sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSound(!sound); }}>
          {sound ? <Volume2 /> : <VolumeX />}
          {sound ? "Alertas sonoros ligados" : "Alertas sonoros desligados"}
        </DropdownMenuItem>
        {settings.push_enabled && permission !== "unsupported" && (
          <DropdownMenuItem
            disabled={permission !== "default"}
            onSelect={async (e) => {
              e.preventDefault();
              const result = await requestPush();
              if (result === "granted") toast.success("Notificações ativadas.");
              else if (result === "denied") toast.error("Notificações bloqueadas.");
            }}
          >
            {permission === "granted" ? <BellRing /> : <BellOff />}
            {permission === "granted" ? "Notificações ativas" : permission === "denied" ? "Notificações bloqueadas" : "Ativar notificações"}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => logout()}>
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

/** Recorta o centro em quadrado e reduz para `size` px (JPEG leve para o upload). */
async function squareJpeg(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
}
