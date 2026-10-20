// Gera os templates de e-mail do Supabase Auth (supabase/templates/*.html)
// a partir de um layout só. Rode depois de mudar algo aqui:
//
//   npx tsx scripts/email-templates.mts
//
// E cole cada arquivo em Dashboard → Authentication → Emails (o nome do
// template e o assunto sugerido estão no comentário do topo de cada arquivo).

import { writeFileSync } from "node:fs";

const LOGO = "https://pourwqvtvnugydqsnugq.supabase.co/storage/v1/object/public/avatars/brand/datacrazy-mark.png";
const C = {
  navy: "#13284a",
  brand: "#2f62a8",
  soft: "#edf2fa",
  ink: "#131a24",
  text: "#3b4656",
  muted: "#6b7686",
  line: "#e3e8f0",
  page: "#f3f6fb",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

interface Template {
  file: string;
  /** Nome do template no Dashboard. */
  name: string;
  subject: string;
  /** Texto escondido que aparece na prévia da caixa de entrada. */
  preheader: string;
  eyebrow: string;
  title: string;
  intro: string;
  /** Botão com link (convite, recuperação, confirmação). */
  action?: { label: string; href: string };
  /** Código em destaque ({{ .Token }}). */
  code?: boolean;
  note: string;
}

const confirm = (type: string) => `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`;

const TEMPLATES: Template[] = [
  {
    file: "confirmation.html",
    name: "Confirm signup",
    subject: "Confirme seu e-mail no CrazyPanel",
    preheader: "Falta só confirmar o seu e-mail para entrar no CrazyPanel.",
    eyebrow: "Confirmação de cadastro",
    title: "Confirme o seu e-mail",
    intro: "Falta só um passo para ativar sua conta no CrazyPanel. Confirme que este e-mail é seu:",
    action: { label: "Confirmar meu e-mail", href: confirm("signup") },
    note: "Se você não criou uma conta, ignore este e-mail: nada vai acontecer.",
  },
  {
    file: "invite.html",
    name: "Invite user",
    subject: "Seu acesso ao CrazyPanel",
    preheader: "Você foi convidado para atender as comunidades DataCrazy.",
    eyebrow: "Convite",
    title: "Olá{{ if .Data.name }}, {{ .Data.name }}{{ end }}!",
    intro: "Você foi convidado para atender as comunidades DataCrazy no CrazyPanel. Defina sua senha para entrar:",
    action: { label: "Definir minha senha", href: confirm("invite") },
    note: "O link vale por 24 horas. Se expirar, peça um novo convite a um administrador.",
  },
  {
    file: "lead-code.html",
    name: "Magic Link",
    subject: "Seu código de verificação: {{ .Token }}",
    preheader: "Use este código para confirmar o seu e-mail na comunidade DataCrazy.",
    eyebrow: "Comunidade DataCrazy",
    title: "Seu código de verificação",
    intro: "Digite este código no formulário para confirmar o seu e-mail:",
    code: true,
    note: "O código vale por alguns minutos. Se você não pediu, ignore este e-mail.",
  },
  {
    file: "email-change.html",
    name: "Change Email Address",
    subject: "Confirme o novo e-mail do CrazyPanel",
    preheader: "Confirme a troca do e-mail da sua conta.",
    eyebrow: "Troca de e-mail",
    title: "Confirme o seu novo e-mail",
    intro:
      "Recebemos um pedido para trocar o e-mail da sua conta de <strong style=\"color:" +
      C.ink +
      "\">{{ .Email }}</strong> para <strong style=\"color:" +
      C.ink +
      "\">{{ .NewEmail }}</strong>. Confirme para concluir:",
    action: { label: "Confirmar novo e-mail", href: confirm("email_change") },
    note: "Se não foi você, ignore este e-mail e avise um administrador: o e-mail atual continua valendo.",
  },
  {
    file: "recovery.html",
    name: "Reset Password",
    subject: "Redefina sua senha do CrazyPanel",
    preheader: "Crie uma nova senha para a sua conta.",
    eyebrow: "Redefinição de senha",
    title: "Crie uma nova senha",
    intro: "Recebemos um pedido para criar uma nova senha para a sua conta no CrazyPanel:",
    action: { label: "Criar nova senha", href: confirm("recovery") },
    note: "O link vale por 1 hora. Se você não pediu, ignore este e-mail: sua senha continua a mesma.",
  },
  {
    file: "reauthentication.html",
    name: "Reauthentication",
    subject: "Código de confirmação: {{ .Token }}",
    preheader: "Confirme que é você para continuar no CrazyPanel.",
    eyebrow: "Confirmação de segurança",
    title: "Confirme que é você",
    intro: "Para concluir esta ação no CrazyPanel, digite o código abaixo:",
    code: true,
    note: "O código vale por alguns minutos. Se você não está fazendo nada no painel, troque sua senha.",
  },
];

function render(t: Template): string {
  const action = t.action
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
                <tr>
                  <td style="border-radius:10px; background:${C.brand};">
                    <a href="${t.action.href}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:${FONT}; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px;">${t.action.label}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px; font-family:${FONT}; font-size:12px; line-height:18px; color:${C.muted};">Se o botão não abrir, copie e cole este endereço no navegador:</p>
              <p style="margin:0 0 24px; font-family:${MONO}; font-size:11px; line-height:16px; color:${C.brand}; word-break:break-all;"><a href="${t.action.href}" target="_blank" style="color:${C.brand}; text-decoration:underline;">${t.action.href}</a></p>`
    : "";
  const code = t.code
    ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
                <tr>
                  <td align="center" style="background:${C.soft}; border:1px solid #d6e1f2; border-radius:12px; padding:22px 12px;">
                    <span style="font-family:${MONO}; font-size:34px; line-height:40px; font-weight:700; letter-spacing:10px; color:${C.navy};">{{ .Token }}</span>
                  </td>
                </tr>
              </table>`
    : "";

  return `<!--
  Template "${t.name}" do Supabase Auth.
  Dashboard → Authentication → Emails → ${t.name} → cole este HTML.
  Assunto: ${t.subject}
  Gerado por scripts/email-templates.mts (edite lá, não aqui).
-->
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${t.subject}</title>
  </head>
  <body style="margin:0; padding:0; background:${C.page};">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${t.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; background:#ffffff; border:1px solid ${C.line}; border-radius:16px; overflow:hidden;">
            <tr>
              <td style="background:${C.navy}; padding:22px 32px; border-bottom:3px solid ${C.brand};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;"><img src="${LOGO}" width="40" height="40" alt="DataCrazy" style="display:block; border:0; border-radius:10px;" /></td>
                    <td style="vertical-align:middle; padding-left:12px;">
                      <div style="font-family:${FONT}; font-size:17px; line-height:20px; font-weight:700; color:#ffffff;">DataCrazy</div>
                      <div style="font-family:${FONT}; font-size:12px; line-height:16px; color:#b9c8e2;">CrazyPanel · Comunidades no WhatsApp</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;">
              <p style="margin:0 0 8px; font-family:${FONT}; font-size:12px; line-height:16px; font-weight:600; letter-spacing:1.2px; text-transform:uppercase; color:${C.brand};">${t.eyebrow}</p>
              <h1 style="margin:0 0 14px; font-family:${FONT}; font-size:24px; line-height:30px; font-weight:700; color:${C.ink};">${t.title}</h1>
              <p style="margin:0 0 16px; font-family:${FONT}; font-size:15px; line-height:24px; color:${C.text};">${t.intro}</p>${code}${action}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-top:1px solid ${C.line}; padding-top:18px; font-family:${FONT}; font-size:13px; line-height:20px; color:${C.muted};">${t.note}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0; font-family:${FONT}; font-size:12px; line-height:18px; color:#94a0b2;">DataCrazy · Este é um e-mail automático, não responda.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

for (const t of TEMPLATES) {
  writeFileSync(new URL(`../supabase/templates/${t.file}`, import.meta.url), render(t));
  console.log(`${t.name.padEnd(22)} → supabase/templates/${t.file}  (assunto: ${t.subject})`);
}
