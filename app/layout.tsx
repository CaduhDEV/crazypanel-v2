import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { Providers } from "@/components/providers";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "CrazyPanel", template: "%s · CrazyPanel" },
  description: "Atendimento das comunidades DataCrazy no WhatsApp.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf2fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f15" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        {/* Aplica o tema salvo antes da primeira pintura (sem piscar entre claro e escuro). */}
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
