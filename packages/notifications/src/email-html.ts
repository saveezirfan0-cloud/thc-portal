/**
 * The HTML side of every email — the look of the product, in an inbox.
 *
 * The register's copy (`templates.ts`, `documents.ts`) stays plain text: it
 * is what the tests pin, what a text-only client shows, and what Resend
 * sends as the `text` part. This file turns that same text into the `html`
 * part, so the two can never say different things — the HTML adds layout,
 * never words (apart from the fixed footer and a "button not working?"
 * fallback line under each button).
 *
 * The look is the app's (ADR-0007, docs/09): the warm cream ground, a white
 * rounded card with the soft warm shadow, Plus Jakarta Sans, pill buttons
 * with the teal→violet gradient primary. An inbox cannot read CSS custom
 * properties, so the values are restated below from
 * `packages/ui/src/styles/tokens.css` (warm light, and warm dark for the
 * clients that honour `prefers-color-scheme`). Change them together.
 *
 * How the text becomes layout, block by block (blocks are split on a blank
 * line):
 *
 *   "1. Set your password"   a numbered step: badge + title, the rest of the
 *   + lines                  block beneath it.
 *   every line "Label: …"    a details table (the office and payroll emails:
 *                            Name, Employee ID, …).
 *   anything else            a paragraph; single line breaks are kept.
 *
 * A URL that the template names as a button (`email.buttons`, keyed by the
 * placeholder that carries it) becomes a gradient pill button with the
 * sentence before it kept as text; any other URL is a plain link. Every
 * value is HTML-escaped — names and notes are typed by people — and only
 * http(s) URLs are ever put in an href.
 */

import type { DocumentEmailTemplate } from './documents.ts';
import { DOCUMENT_EMAILS, isDocumentEmail } from './documents.ts';
import type { Template, TemplateCode } from './templates.ts';
import { TEMPLATES, render } from './templates.ts';

/** Warm light — `:root[data-style='warm'][data-theme='light']` in tokens.css. */
export const EMAIL_LIGHT = {
  bg: '#faf7f4',
  panel: '#ffffff',
  panel2: '#f5f1eb',
  line: '#ebe4da',
  text: '#241d16',
  muted: '#7a6b5c',
  accentInk: '#0a6d79',
  gradFrom: '#0a6d79',
  gradTo: '#7758cd',
  onGrad: '#ffffff',
  shadow: '0 1px 2px rgba(36,29,22,0.05), 0 10px 26px -14px rgba(36,29,22,0.16)',
} as const;

/** Warm dark — `:root[data-style='warm'][data-theme='dark']`: navy ground. */
export const EMAIL_DARK = {
  bg: '#0a0e18',
  panel: '#171b26',
  panel2: '#1e2333',
  line: '#252a36',
  text: '#e9eef5',
  muted: '#8a97a3',
  accentInk: '#3edcec',
  gradFrom: '#3edcec',
  gradTo: '#8f7bff',
  onGrad: '#0a0e18',
} as const;

const FONT =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface EmailButton {
  label: string;
  href: string;
}

export interface EmailHtmlInput {
  subject: string;
  /** The plain-text body exactly as it is sent in the `text` part. */
  text: string;
  /** Large heading at the top of the card. Defaults to the subject. */
  heading?: string;
  /** Small pill above the heading. */
  eyebrow?: string;
  /** The inbox preview line. Defaults to the first sentence of the body. */
  preheader?: string;
  buttons?: readonly EmailButton[];
  /** File names, for the "Attached" list on a document email. */
  attachments?: readonly string[];
  /** Where a reply goes — named in the footer. */
  replyTo: string;
  /**
   * An email to THC's own office or payroll (the register pins its
   * recipients): the footer says where it came from instead of inviting a
   * reply to the address that sent it.
   */
  internal?: boolean;
  /** An absolute URL for the app icon, when the Staff App's origin is known. */
  logoUrl?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s"'<>]+$/i.test(value);
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

/** Escaped text with its URLs turned into links. */
function inline(text: string, c: typeof EMAIL_LIGHT): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0];
    const at = match.index ?? 0;
    out += escapeHtml(text.slice(last, at));
    out += `<a href="${escapeHtml(url)}" class="thc-link" style="color:${c.accentInk};text-decoration:underline;word-break:break-all;">${escapeHtml(url)}</a>`;
    last = at + url.length;
  }
  return out + escapeHtml(text.slice(last));
}

function inlineLines(lines: readonly string[], c: typeof EMAIL_LIGHT): string {
  return lines.map((l) => inline(l, c)).join('<br>');
}

function button(b: EmailButton, c: typeof EMAIL_LIGHT): string {
  const href = escapeHtml(b.href);
  // A table cell with a solid bgcolor is the button in clients that drop
  // gradients (Outlook, some Gmail views); the gradient layers over it
  // where it is supported. The pill radius is the design system's.
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 6px 0;">
  <tr>
    <td class="thc-btn" bgcolor="${c.gradFrom}" style="border-radius:999px;background-color:${c.gradFrom};background-image:linear-gradient(135deg,${c.gradFrom} 0%,${c.gradTo} 100%);">
      <a href="${href}" class="thc-btn-a" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:20px;color:${c.onGrad};text-decoration:none;border-radius:999px;">${escapeHtml(b.label)}&nbsp;&rarr;</a>
    </td>
  </tr>
</table>
<p class="thc-muted" style="margin:0 0 18px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${c.muted};">Button not working? Copy this link into your browser:<br><a href="${href}" class="thc-link" style="color:${c.accentInk};text-decoration:underline;word-break:break-all;">${escapeHtml(b.href)}</a></p>`;
}

/**
 * The lines of one block, with each button URL lifted out: the sentence
 * before it stays as text (a trailing ":" dropped), the button follows.
 */
function withButtons(
  lines: readonly string[],
  buttons: readonly EmailButton[],
  c: typeof EMAIL_LIGHT,
  paragraph: (lines: readonly string[]) => string,
): string {
  let html = '';
  let pending: string[] = [];
  const flush = () => {
    if (pending.length > 0) html += paragraph(pending);
    pending = [];
  };
  for (const line of lines) {
    const hit = buttons.find((b) => line.includes(b.href));
    if (!hit) {
      pending.push(line);
      continue;
    }
    const [before, after] = [
      line.slice(0, line.indexOf(hit.href)),
      line.slice(line.indexOf(hit.href) + hit.href.length),
    ];
    // "Set your password to sign in: <url>" reads "… to sign in." above
    // the button.
    const lead = before.replace(/[\s:–—-]+$/, '').trim();
    if (lead) pending.push(/[.!?]$/.test(lead) ? lead : `${lead}.`);
    flush();
    html += button(hit, c);
    const tail = after.replace(/^[\s.]+/, '').trim();
    if (tail) pending.push(tail);
  }
  flush();
  return html;
}

const STEP = /^(\d{1,2})\.\s+(.+)$/;
const FIELD = /^([^:\n]{1,48}):\s(.*)$/;

function renderBlock(
  block: string,
  buttons: readonly EmailButton[],
  c: typeof EMAIL_LIGHT,
): string {
  const lines = block.split('\n').map((l) => l.trimEnd());
  const p = (ls: readonly string[]) =>
    `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${c.text};" class="thc-text">${inlineLines(ls, c)}</p>`;

  const step = STEP.exec(lines[0] ?? '');
  if (step) {
    const [, n, title] = step;
    const rest = lines.slice(1);
    const pSmall = (ls: readonly string[]) =>
      `<p style="margin:0 0 4px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${c.muted};" class="thc-muted">${inlineLines(ls, c)}</p>`;
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="thc-step" style="margin:0 0 14px 0;background-color:${c.panel2};border:1px solid ${c.line};border-radius:18px;">
  <tr>
    <td valign="top" width="44" style="padding:20px 0 20px 20px;">
      <div class="thc-badge" style="width:32px;height:32px;line-height:32px;border-radius:999px;text-align:center;background-color:${c.gradFrom};background-image:linear-gradient(135deg,${c.gradFrom} 0%,${c.gradTo} 100%);color:${c.onGrad};font-family:${FONT};font-size:15px;font-weight:700;">${escapeHtml(n!)}</div>
    </td>
    <td valign="top" style="padding:20px 20px 16px 14px;">
      <p class="thc-text" style="margin:5px 0 6px 0;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${c.text};">${inline(title!, c)}</p>
      ${withButtons(rest, buttons, c, pSmall)}
    </td>
  </tr>
</table>`;
  }

  if (lines.length >= 2 && lines.every((l) => FIELD.test(l))) {
    const rows = lines
      .map((l, i) => {
        const [, label, value] = FIELD.exec(l)!;
        const border = i === lines.length - 1 ? '' : `border-bottom:1px solid ${c.line};`;
        return `
  <tr>
    <td valign="top" class="thc-muted thc-row" style="padding:10px 12px 10px 16px;${border}font-family:${FONT};font-size:13px;line-height:20px;color:${c.muted};width:38%;">${escapeHtml(label!)}</td>
    <td valign="top" class="thc-text thc-row" style="padding:10px 16px 10px 0;${border}font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${c.text};">${value!.trim() === '' ? '&mdash;' : inline(value!, c)}</td>
  </tr>`;
      })
      .join('');
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="thc-step" style="margin:0 0 18px 0;background-color:${c.panel2};border:1px solid ${c.line};border-radius:12px;">${rows}
</table>`;
  }

  return withButtons(lines, buttons, c, p);
}

function firstSentence(text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim());
  const lead = blocks.find((b) => b !== '' && !/^(hello|hi|dear)\b[^\n]*,$/i.test(b)) ?? '';
  const line = lead.split('\n')[0] ?? '';
  const sentence = /^(.+?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  return sentence.replace(URL_IN_TEXT, '').trim().slice(0, 140);
}

const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .thc-body, .thc-bg { background-color: ${EMAIL_DARK.bg} !important; }
  .thc-card { background-color: ${EMAIL_DARK.panel} !important; border-color: ${EMAIL_DARK.line} !important; box-shadow: none !important; }
  .thc-step { background-color: ${EMAIL_DARK.panel2} !important; border-color: ${EMAIL_DARK.line} !important; }
  .thc-row { border-color: ${EMAIL_DARK.line} !important; }
  .thc-text, .thc-heading { color: ${EMAIL_DARK.text} !important; }
  .thc-muted { color: ${EMAIL_DARK.muted} !important; }
  .thc-link { color: ${EMAIL_DARK.accentInk} !important; }
  .thc-eyebrow { color: ${EMAIL_DARK.accentInk} !important; background-color: rgba(62,220,236,0.12) !important; border-color: rgba(62,220,236,0.35) !important; }
  .thc-btn, .thc-badge { background-color: ${EMAIL_DARK.gradFrom} !important; background-image: linear-gradient(135deg, ${EMAIL_DARK.gradFrom} 0%, ${EMAIL_DARK.gradTo} 100%) !important; }
  .thc-btn-a, .thc-badge { color: ${EMAIL_DARK.onGrad} !important; }
  .thc-rule { border-color: ${EMAIL_DARK.line} !important; }
}
@media (max-width: 600px) {
  .thc-pad { padding-left: 16px !important; padding-right: 16px !important; }
  .thc-card-pad { padding: 28px 20px !important; }
  .thc-heading { font-size: 22px !important; line-height: 30px !important; }
}`;

/** The full HTML document for one email. */
export function renderEmailHtml(input: EmailHtmlInput): string {
  const c = EMAIL_LIGHT;
  const buttons = (input.buttons ?? []).filter((b) => isHttpUrl(b.href));
  const heading = input.heading ?? input.subject;
  const preheader = input.preheader ?? firstSentence(input.text);

  const blocks = input.text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.replace(/^\n+|\n+$/g, ''))
    .filter((b) => b.trim() !== '');
  const content = blocks.map((b) => renderBlock(b, buttons, c)).join('\n');

  const attachments =
    input.attachments && input.attachments.length > 0
      ? `
<p class="thc-muted" style="margin:8px 0 8px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.muted};">Attached</p>
${input.attachments
  .map(
    (name) =>
      `<p class="thc-text thc-step" style="margin:0 0 8px 0;padding:10px 14px;background-color:${c.panel2};border:1px solid ${c.line};border-radius:12px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${c.text};">&#128206;&nbsp; ${escapeHtml(name)}</p>`,
  )
  .join('\n')}`
      : '';

  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 14px 0;"><span class="thc-eyebrow" style="display:inline-block;padding:5px 12px;border-radius:999px;border:1px solid rgba(10,109,121,0.35);background-color:rgba(10,109,121,0.10);font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.04em;color:${c.accentInk};">${escapeHtml(input.eyebrow)}</span></p>`
    : '';

  // The app icon, on the icon's own cyan so an inbox that blocks images
  // still shows a tile with "THC" in it rather than a broken-image glyph.
  const logo =
    input.logoUrl && isHttpUrl(input.logoUrl)
      ? `<td valign="middle" width="40" height="40" bgcolor="#3edcec" style="width:40px;height:40px;border-radius:12px;background-color:#3edcec;text-align:center;"><img src="${escapeHtml(input.logoUrl)}" width="40" height="40" alt="THC" style="display:block;width:40px;height:40px;border:0;border-radius:12px;font-family:${FONT};font-size:12px;line-height:40px;font-weight:700;color:#04080f;text-align:center;"></td><td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>`
      : '';

  const footer = input.internal
    ? `Sent automatically by the THC staffing platform to the office. Replies go to <a href="mailto:${escapeHtml(input.replyTo)}" class="thc-link" style="color:${c.accentInk};text-decoration:underline;">${escapeHtml(input.replyTo)}</a>.`
    : `Questions? Just reply to this email &mdash; it goes to <a href="mailto:${escapeHtml(input.replyTo)}" class="thc-link" style="color:${c.accentInk};text-decoration:underline;">${escapeHtml(input.replyTo)}</a>.`;

  return `<!doctype html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
<style>${DARK_CSS}</style>
</head>
<body class="thc-body" style="margin:0;padding:0;background-color:${c.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="thc-bg" bgcolor="${c.bg}" style="background-color:${c.bg};">
  <tr>
    <td align="center" class="thc-pad" style="padding:32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 20px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${logo}
                <td valign="middle" class="thc-text" style="font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;letter-spacing:-0.01em;color:${c.text};">The Hospitality Company</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="thc-card thc-card-pad" bgcolor="${c.panel}" style="background-color:${c.panel};border:1px solid ${c.line};border-radius:18px;box-shadow:${c.shadow};padding:36px 36px 24px 36px;">
            ${eyebrow}
            <h1 class="thc-heading" style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;color:${c.text};">${escapeHtml(heading)}</h1>
            ${content}
            ${attachments}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0 8px;">
            <p class="thc-muted" style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${c.muted};">${footer}</p>
            <p class="thc-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${c.muted};">The Hospitality Company &middot; <a href="https://www.thehospitalitycompany.co.uk" class="thc-link" style="color:${c.muted};text-decoration:underline;">thehospitalitycompany.co.uk</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * The template's presentation (heading, eyebrow, preheader, buttons) with
 * its placeholders filled from the row. Codes with none get `{}` — the
 * subject becomes the heading and the body is laid out as-is.
 */
export function emailPresentationFor(
  code: string,
  values: Record<string, unknown>,
): {
  heading?: string;
  eyebrow?: string;
  preheader?: string;
  buttons: EmailButton[];
  internal: boolean;
} {
  let entry: DocumentEmailTemplate | Template | undefined;
  if (isDocumentEmail(code)) entry = DOCUMENT_EMAILS[code];
  else if (Object.prototype.hasOwnProperty.call(TEMPLATES, code)) {
    entry = TEMPLATES[code as TemplateCode];
  }
  const presentation = entry?.email;
  const strings: Record<string, string> = Object.fromEntries(
    Object.entries(values ?? {}).map(([k, v]) => [
      k,
      v === null || v === undefined ? '' : String(v),
    ]),
  );
  // A placeholder the row did not fill is dropped rather than shown as
  // "{name}" in a heading.
  const fill = (text?: string) =>
    text === undefined
      ? undefined
      : render(text, strings)
          .replace(/,?\s*\{\w+\}/g, '')
          .trim();
  const buttons: EmailButton[] = [];
  for (const [key, label] of Object.entries(presentation?.buttons ?? {})) {
    const href = strings[key];
    if (href && isHttpUrl(href)) buttons.push({ label, href });
  }
  return {
    ...(presentation?.heading ? { heading: fill(presentation.heading) } : {}),
    ...(presentation?.eyebrow ? { eyebrow: fill(presentation.eyebrow) } : {}),
    ...(presentation?.preheader ? { preheader: fill(presentation.preheader) } : {}),
    buttons,
    // Fixed recipients are THC's own inboxes (office, payroll).
    internal: (entry?.recipients?.length ?? 0) > 0,
  };
}
