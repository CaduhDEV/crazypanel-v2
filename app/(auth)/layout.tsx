import { Heart } from "lucide-react";
import { EmailLinkForwarder } from "@/components/auth/email-link-forwarder";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-between px-4 py-8 sm:px-6 md:py-12">
      <EmailLinkForwarder />
      <div className="flex flex-1 w-full items-center justify-center">
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
      <footer className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <span>Construído com</span>
        <Heart className="size-3 fill-primary text-primary" aria-hidden="true" />
        <span>por</span>
        <a
          href="https://github.com/CaduhDEV"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground hover:underline"
        >
          CaduhDEV
        </a>
        <span>· 2026</span>
      </footer>
    </main>
  );
}
