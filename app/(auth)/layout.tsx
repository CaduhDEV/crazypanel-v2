import { Logo } from "@/components/logo";
import { EmailLinkForwarder } from "@/components/auth/email-link-forwarder";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <EmailLinkForwarder />
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-10">{children}</div>
        </div>
        <p className="text-xs text-muted-foreground">Feito com ❤️ por <a href="https://github.com/CaduhDEV" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">CaduhDEV</a></p>
      </section>

      <aside className="relative hidden overflow-hidden border-l border-border bg-sidebar lg:flex lg:flex-col lg:justify-end lg:p-12">
        <AuthIllustration />
        <div className="relative flex max-w-md flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            Painel de atendimento para WhatsApp, com fila de leads e SLA em tempo real.
          </h2>
          <p className="text-sm text-muted-foreground">
            Fila com SLA ao vivo, conversa completa do WhatsApp e o vínculo de cada lead com a empresa dele.
          </p>
        </div>
      </aside>
    </main>
  );
}

/** Prévia estilizada da fila de atendimento (decorativa). */
function AuthIllustration() {
  const rows = [
    { name: "Guinho", group: "Comunidade CRM", tone: "bg-sla-ok text-sla-ok-foreground", label: "NO PRAZO 02:12" },
    { name: "Carlus", group: "API & Integrações", tone: "bg-sla-warn text-sla-warn-foreground", label: "EM ALERTA 04:05" },
    { name: "Stevam.ecom BR", group: "Comunidade CRM", tone: "bg-sla-breach text-sla-breach-foreground", label: "ESTOURADO 23:42" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-12 top-16 flex flex-col gap-3 opacity-90">
      {rows.map((r, i) => (
        <div
          key={r.name}
          className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
          style={{ marginLeft: `${i * 28}px`, marginRight: `${(2 - i) * 28}px` }}
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground">{r.group}</span>
          </div>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${r.tone}`}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
