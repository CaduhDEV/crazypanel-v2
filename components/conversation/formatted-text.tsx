import { Fragment, type ReactNode } from "react";

// Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```) e links,
// renderizada como elementos React (nunca HTML cru).

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

type Rule = { re: RegExp; wrap: (children: ReactNode, key: string) => ReactNode };

const RULES: Rule[] = [
  { re: /```([\s\S]+?)```/, wrap: (c, k) => <code key={k} className="rounded bg-muted px-1 font-mono text-[0.9em]">{c}</code> },
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/, wrap: (c, k) => <strong key={k} className="font-semibold">{c}</strong> },
  { re: /(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/, wrap: (c, k) => <em key={k}>{c}</em> },
  { re: /(?<![\w~])~(?!\s)([^~\n]+?)(?<!\s)~(?![\w~])/, wrap: (c, k) => <s key={k}>{c}</s> },
];

function formatInline(text: string, keyPrefix: string): ReactNode[] {
  // Acha a primeira marcação no texto e recursa antes, dentro e depois dela.
  let best: { rule: Rule; match: RegExpExecArray } | null = null;
  for (const rule of RULES) {
    const match = rule.re.exec(text);
    if (match && (!best || match.index < best.match.index)) best = { rule, match };
  }
  if (!best) return [text];
  const { rule, match } = best;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return [
    ...(before ? formatInline(before, `${keyPrefix}b`) : []),
    rule.wrap(rule.re === RULES[0].re ? match[1] : formatInline(match[1], `${keyPrefix}i`), `${keyPrefix}m`),
    ...(after ? formatInline(after, `${keyPrefix}a`) : []),
  ];
}

export function FormattedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-primary underline underline-offset-2 dark:text-[#8fb4f5]"
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{formatInline(part, `p${i}`)}</Fragment>
        ),
      )}
    </span>
  );
}

/** Texto sem marcações (para prévias e citações). */
export function stripFormatting(text: string): string {
  return text.replace(/```/g, "").replace(/[*_~]([^*_~\n]+)[*_~]/g, "$1");
}
