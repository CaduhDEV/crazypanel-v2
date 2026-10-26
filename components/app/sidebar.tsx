"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Building2,
  ChevronsLeft,
  DoorOpen,
  Contact,
  History,
  Inbox,
  Menu,
  MessageSquareText,
  MessagesSquare,
  Plug2,
  ScrollText,
  ShieldAlert,
  Settings2,
  UserPlus,
  UsersRound,

  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "@/components/logo";
import { Tip } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/components/app/app-context";
import { useOpenTickets } from "@/components/app/use-open-tickets";
import { usePendingJoinRequests } from "@/components/community/use-pending-join-requests";
import { UserMenu } from "@/components/app/user-menu";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "open-tickets" | "join-requests";
  soon?: boolean;
}

interface NavSection {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  { label: "Atendimento", items: [{ href: "/atendimento", label: "Inbox", icon: Inbox, badge: "open-tickets" }] },
  {
    label: "Gestão",
    adminOnly: true,
    items: [
      { href: "/leads", label: "Leads", icon: Contact },
      { href: "/solicitacoes", label: "Solicitações", icon: DoorOpen, badge: "join-requests" },
      { href: "/moderacao", label: "Moderação", icon: ShieldAlert },
      { href: "/empresas", label: "Empresas", icon: Building2 },
      { href: "/convites", label: "Prospectos", icon: UserPlus },
      { href: "/historico", label: "Histórico", icon: History },
      { href: "/metricas", label: "Métricas", icon: BarChart3 },
    ],
  },
  {
    label: "Administração",
    adminOnly: true,
    items: [
      { href: "/admin/atendentes", label: "Atendentes", icon: UsersRound },
      { href: "/admin/whatsapp", label: "Conexões", icon: Plug2 },
      { href: "/admin/grupos", label: "Grupos", icon: MessagesSquare },
      { href: "/admin/mensagens", label: "Mensagens", icon: MessageSquareText },
      { href: "/admin/logs", label: "Logs", icon: ScrollText },
      { href: "/admin/configuracoes", label: "Configurações", icon: Settings2 },
    ],
  },
];

const COLLAPSE_COOKIE = "sidebar_collapsed";

export function Sidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${COLLAPSE_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center px-2" : "justify-between px-4")}>
        {collapsed ? <LogoMark /> : <Logo />}
        {!collapsed && (
          <Button variant="ghost" size="icon-xs" onClick={toggle} aria-label="Recolher menu">
            <ChevronsLeft />
          </Button>
        )}
      </div>
      {collapsed && (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="icon-xs" onClick={toggle} aria-label="Expandir menu">
            <ChevronsLeft className="rotate-180" />
          </Button>
        </div>
      )}
      <NavLinks collapsed={collapsed} />
      <div className="border-t border-border p-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}

/** Barra superior com o menu em gaveta (telas pequenas). */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-sidebar px-4 lg:hidden">
      <Logo />
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menu">
        <Menu />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showClose={false}
          className="left-0 top-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=open]:slide-in-from-left data-[state=open]:zoom-in-100"
        >
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <div className="flex h-14 items-center border-b border-border px-4">
            <Logo />
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto" onClick={() => setOpen(false)}>
            <NavLinks collapsed={false} />
          </div>
          <div className="border-t border-border p-2">
            <UserMenu collapsed={false} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NavLinks({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const { isAdmin } = useApp();
  const { data: tickets } = useOpenTickets();
  const openCount = tickets?.length ?? 0;
  const { data: pendingJoins = 0 } = usePendingJoinRequests(isAdmin);

  return (
    <nav className="scroll-thin flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-4">
      {SECTIONS.filter((s) => !s.adminOnly || isAdmin).map((section) => (
        <div key={section.label} className="flex flex-col gap-0.5">
          {!collapsed && (
            <span className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              {section.label}
            </span>
          )}
          {section.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.badge === "open-tickets" ? openCount : item.badge === "join-requests" ? pendingJoins : 0;
            const content = (
              <>
                <item.icon className="size-[18px] shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {!collapsed && count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-px text-[11px] font-semibold tabular",
                      active ? "bg-white text-primary" : "bg-muted text-foreground",
                    )}
                  >
                    {count > 999 ? "999+" : count}
                  </span>
                )}
                {!collapsed && item.soon && (
                  <span className="rounded border border-border px-1.5 text-[10px] text-muted-foreground">Em breve</span>
                )}
                {collapsed && count > 0 && (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" aria-hidden />
                )}
              </>
            );
            const className = cn(
              "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors",
              collapsed && "justify-center px-0",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              item.soon && "pointer-events-none opacity-55",
            );

            const link = item.soon ? (
              <span className={className} aria-disabled="true">
                {content}
              </span>
            ) : (
              <Link href={item.href} className={className} aria-current={active ? "page" : undefined}>
                {content}
              </Link>
            );

            return collapsed ? (
              <Tip key={item.href} label={item.soon ? `${item.label} (em breve)` : item.label} side="right">
                {link}
              </Tip>
            ) : (
              <div key={item.href}>{link}</div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
