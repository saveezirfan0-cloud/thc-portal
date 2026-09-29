/**
 * The HTML every THC email is sent in — THC Light (ADR-0073).
 *
 * Every email the drain sends carries two bodies: the plain text it always
 * had (the register's copy, unchanged) and this designed HTML version of the
 * same words. The look is the Back Office's warm light theme
 * (packages/ui/src/styles/tokens.css, `data-style="warm"` + `data-theme="light"`),
 * restated here as literal values because a mail client reads no tokens:
 *
 *   page #faf7f4 · card #ffffff, 1px #ebe4da, 18px radius, warm shadow ·
 *   5px top bar in the primary gradient #0a6d79 → #7758cd · text #241d16 ·
 *   muted #7a6b5c · eyebrow #0e7688 · facts box #f5f1eb · footer #fdfbf8.
 *
 * Light ONLY: there is no dark variant, and the `color-scheme` metas ask mail
 * apps not to invert it.
 *
 * Email-safe on purpose: table layout, 600px max and fluid below it, every
 * style inline on its element (the one <style> block holds resets and a
 * phone media query, which clients that drop it do not need), no external
 * CSS, no script, no `data:` image. Every gradient sits on a solid
 * #0a6d79 background, because Outlook for Windows draws no gradients.
 *
 * The logo is an inline CID attachment (`cid:thc-mark`): Gmail blocks
 * `data:` URIs and a remote image stays hidden until the reader allows it.
 * `inlineLogoAttachment()` in `email-logo.ts` is what the drain attaches for
 * it; the bytes live there, not here, so nothing that renders pulls them in.
 *
 * Every interpolated value is HTML-escaped — the values come from database
 * rows, and a worker's name or a manager's note is typed by a person. A
 * value is never split into paragraphs or rows and never linked: the layout
 * comes from the template (`templateToBlocks`). Only http(s) URLs in the
 * template's own words, and the placeholders `email-layouts.ts` names as
 * buttons, become links; a `mailto:` is allowed on a button the code itself
 * builds, nothing else.
 */

// ---------------------------------------------------------------------------
// palette — THC Light, from tokens.css (warm + light)
// ---------------------------------------------------------------------------

export const EMAIL_COLOURS = {
  page: '#faf7f4',
  card: '#ffffff',
  line: '#ebe4da',
  surface: '#f5f1eb',
  footer: '#fdfbf8',
  text: '#241d16',
  muted: '#7a6b5c',
  eyebrow: '#0e7688',
  link: '#0a6d79',
  primary: '#0a6d79',
  gradient: 'linear-gradient(135deg,#0a6d79 0%,#7758cd 100%)',
  shadow: '0 1px 2px rgba(36,29,22,0.05),0 10px 26px -14px rgba(36,29,22,0.16)',
} as const;

const C = EMAIL_COLOURS;
const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
export const THC_WEBSITE = 'www.thehospitalitycompany.co.uk';
export const THC_COMPANY_NUMBER = 'Registered Company in England and Wales 12411407';

// ---------------------------------------------------------------------------
// the inline logo
// ---------------------------------------------------------------------------

/** The Content-ID the header's `<img src="cid:…">` points at (`email-logo.ts`). */
export const LOGO_CONTENT_ID = 'thc-mark';

// ---------------------------------------------------------------------------
// escaping and links
// ---------------------------------------------------------------------------

/** HTML-escape text or an attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'’"]+$/;

/** An http(s) URL, and only that. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s<>"']+$/i.test(value);
}

function safeHref(href: string): string | null {
  if (isHttpUrl(href)) return href;
  if (/^mailto:[^\s<>"]+$/i.test(href)) return href;
  return null;
}

function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" target="_blank" style="color:${C.link};text-decoration:underline;word-break:break-all;">${escapeHtml(text)}</a>`;
}

/** Escape a line of text, turning each http(s) URL in it into a link. */
export function linkify(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let url = match[0];
    const trail = TRAILING_PUNCTUATION.exec(url)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    const start = match.index ?? 0;
    out += escapeHtml(text.slice(last, start));
    out += isHttpUrl(url) ? link(url, url) : escapeHtml(url);
    last = start + url.length;
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * Escape a block of text, keeping its single line breaks. No links: this is
 * how every VALUE is drawn — a URL typed into a note stays text.
 */
function lines(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fill a register template for HTML. The template's own words are escaped
 * and an http(s) URL written INTO the template is linked; each value is
 * escaped and its line breaks kept — never linked, never split. A
 * placeholder with no value stays as written, as `render()` leaves it.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const literal = (s: string) => s.split('\n').map(linkify).join('<br>');
  let out = '';
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const start = m.index ?? 0;
    out += literal(template.slice(last, start));
    const value = values[m[1]!];
    out += value === undefined ? literal(m[0]) : lines(value);
    last = start + m[0].length;
  }
  return out + literal(template.slice(last));
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

export interface EmailFact {
  label: string;
  value: string;
}

export interface EmailAttachmentCard {
  filename: string;
  /** e.g. "Allocation Timesheet · attached". */
  note: string;
}

export type EmailBlock =
  /** Plain text, escaped. Single line breaks are kept; nothing is linked. */
  | { kind: 'paragraph'; text: string }
  /**
   * A register template paragraph, filled by `fillTemplate()`: only a URL in
   * the template's own words is linked, never one inside a value.
   */
  | { kind: 'filled'; template: string; values: Readonly<Record<string, string>> }
  /**
   * Label/value rows in the surface box. An empty value drops its row
   * (the file emails' optional facts), unless `keepEmpty` — a register
   * email's rows are its copy, so an empty one stays, drawn as "—".
   */
  | { kind: 'facts'; rows: readonly EmailFact[]; keepEmpty?: boolean }
  /** A numbered list, with an optional lead-in line above it. */
  | { kind: 'steps'; lead?: string; items: readonly string[] }
  /** The files the email carries. */
  | { kind: 'attachments'; items: readonly EmailAttachmentCard[] }
  /**
   * The gradient pill button. `showUrl` prints the link under it as well,
   * for readers whose client will not open the button.
   */
  | { kind: 'button'; label: string; href: string; showUrl?: boolean };

export interface EmailLayout {
  /** The short uppercase label above the title. */
  eyebrow: string;
  title: string;
  blocks: readonly EmailBlock[];
  /** The monitored address the footer names (the sender's reply-to). */
  senderAddress: string;
  /** The <title>, usually the subject. Defaults to `title`. */
  documentTitle?: string;
  /** The inbox preview line. */
  preheader?: string;
  /**
   * The header image. `cid:thc-mark` by default (send it with
   * `inlineLogoAttachment()`); null draws the header without an image.
   */
  logoSrc?: string | null;
}

const P_STYLE = `margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.text};`;

function paragraph(text: string): string {
  return `<p style="${P_STYLE}">${lines(text)}</p>`;
}

function facts(rows: readonly EmailFact[], keepEmpty: boolean): string {
  const kept = keepEmpty ? rows : rows.filter((r) => r.value.trim() !== '');
  if (kept.length === 0) return '';
  const body = kept
    .map((r, i) => {
      const border = i === 0 ? '' : `border-top:1px solid ${C.line};`;
      const value =
        r.value.trim() === '' ? `<span style="color:${C.muted};">—</span>` : lines(r.value);
      return `<tr><td valign="top" width="38%" style="${border}padding:10px 12px 10px 16px;font-family:${FONT};font-size:13px;line-height:1.45;color:${C.muted};">${escapeHtml(r.label)}</td><td valign="top" style="${border}padding:10px 16px 10px 0;font-family:${FONT};font-size:14px;line-height:1.45;font-weight:600;color:${C.text};">${value}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="width:100%;margin:0 0 18px 0;background-color:${C.surface};border-radius:12px;border-collapse:separate;">${body}</table>`;
}

function steps(lead: string | undefined, items: readonly string[]): string {
  const head = lead ? paragraph(lead).replace('margin:0 0 16px 0', 'margin:0 0 10px 0') : '';
  const rows = items
    .map(
      (item, i) =>
        `<tr><td valign="top" width="34" style="width:34px;padding:0 0 10px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" valign="middle" width="24" height="24" bgcolor="${C.surface}" style="width:24px;height:24px;border-radius:999px;background-color:${C.surface};border:1px solid ${C.line};font-family:${FONT};font-size:12px;font-weight:700;line-height:24px;color:${C.eyebrow};">${i + 1}</td></tr></table></td><td valign="top" style="padding:2px 0 10px 0;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.text};">${lines(item)}</td></tr>`,
    )
    .join('');
  return `${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 8px 0;">${rows}</table>`;
}

function extension(filename: string): string {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(filename)?.[1];
  return ext ? ext.toUpperCase() : 'FILE';
}

function attachments(items: readonly EmailAttachmentCard[]): string {
  return items
    .map(
      (a) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.footer}" style="width:100%;margin:0 0 12px 0;background-color:${C.footer};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;"><tr><td valign="middle" width="44" style="width:44px;padding:12px 0 12px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" valign="middle" width="40" height="40" bgcolor="${C.primary}" style="width:40px;height:40px;border-radius:10px;background-color:${C.primary};background-image:${C.gradient};font-family:${FONT};font-size:10px;font-weight:800;letter-spacing:0.04em;color:#ffffff;">${escapeHtml(extension(a.filename))}</td></tr></table></td><td valign="middle" style="padding:12px 14px;font-family:${FONT};"><div style="font-size:14px;line-height:1.4;font-weight:700;color:${C.text};word-break:break-word;">${escapeHtml(a.filename)}</div><div style="font-size:12px;line-height:1.4;color:${C.muted};">${escapeHtml(a.note)}</div></td></tr></table>`,
    )
    .join('');
}

/** Bulletproof pill button: the cell carries the colour, so Outlook still draws it. */
function button(label: string, href: string, showUrl: boolean): string {
  const safe = safeHref(href);
  if (!safe) return '';
  const pill = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:4px 0 ${showUrl ? '10px' : '20px'} 0;"><tr><td align="center" valign="middle" bgcolor="${C.primary}" style="border-radius:999px;background-color:${C.primary};background-image:${C.gradient};"><a href="${escapeHtml(safe)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a></td></tr></table>`;
  if (!showUrl || !isHttpUrl(safe)) return pill;
  return `${pill}<p style="margin:0 0 20px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};word-break:break-all;">${link(safe, safe)}</p>`;
}

function block(b: EmailBlock): string {
  switch (b.kind) {
    case 'paragraph':
      return paragraph(b.text);
    case 'filled':
      return `<p style="${P_STYLE}">${fillTemplate(b.template, b.values)}</p>`;
    case 'facts':
      return facts(b.rows, b.keepEmpty ?? false);
    case 'steps':
      return steps(b.lead, b.items);
    case 'attachments':
      return attachments(b.items);
    case 'button':
      return button(b.label, b.href, b.showUrl ?? false);
  }
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

export function renderEmailHtml(layout: EmailLayout): string {
  const logoSrc = layout.logoSrc === undefined ? `cid:${LOGO_CONTENT_ID}` : layout.logoSrc;
  // A Content-ID or an http(s) URL; anything else (data:, javascript:) draws no image.
  const logo =
    logoSrc && (/^cid:[A-Za-z0-9._@-]+$/.test(logoSrc) || isHttpUrl(logoSrc))
      ? `<td valign="middle" width="36" style="width:36px;padding:0 12px 0 0;"><img src="${escapeHtml(logoSrc)}" width="36" height="36" alt="THC" style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none;"></td>`
      : '';
  const sender = layout.senderAddress.trim();
  const senderHtml = /^[^\s@<>"]+@[^\s@<>"]+$/.test(sender)
    ? `<a href="mailto:${escapeHtml(sender)}" style="color:${C.muted};text-decoration:none;">${escapeHtml(sender)}</a>`
    : escapeHtml(sender);
  const preheader = layout.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${escapeHtml(layout.preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.documentTitle ?? layout.title)}</title>
<style>
:root{color-scheme:light only;supported-color-schemes:light;}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
@media only screen and (max-width:620px){
.thc-outer{padding:12px 8px!important;}
.thc-pad{padding-left:20px!important;padding-right:20px!important;}
.thc-title{font-size:20px!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="width:100%;background-color:${C.page};">
<tr><td align="center" class="thc-outer" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:100%;max-width:600px;background-color:${C.card};border:1px solid ${C.line};border-radius:18px;border-collapse:separate;box-shadow:${C.shadow};">
<tr><td height="5" bgcolor="${C.primary}" style="height:5px;line-height:5px;font-size:0;mso-line-height-rule:exactly;background-color:${C.primary};background-image:${C.gradient};border-radius:17px 17px 0 0;">&nbsp;</td></tr>
<tr><td class="thc-pad" style="padding:22px 32px 0 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}<td valign="middle" style="font-family:${FONT};"><div style="font-size:15px;line-height:1.25;font-weight:800;color:${C.text};">The Hospitality Company</div><div style="font-size:12px;line-height:1.4;color:${C.muted};">Event staffing · London</div></td></tr></table>
</td></tr>
<tr><td class="thc-pad" style="padding:26px 32px 12px 32px;font-family:${FONT};">
<p style="margin:0 0 6px 0;font-family:${FONT};font-size:10.5px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.eyebrow};">${escapeHtml(layout.eyebrow)}</p>
<h1 class="thc-title" style="margin:0 0 18px 0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:800;color:${C.text};">${escapeHtml(layout.title)}</h1>
${layout.blocks.map(block).join('\n')}
</td></tr>
<tr><td class="thc-pad" bgcolor="${C.footer}" style="padding:16px 32px 18px 32px;background-color:${C.footer};border-top:1px solid ${C.line};border-radius:0 0 17px 17px;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.muted};">${senderHtml} · <a href="https://${THC_WEBSITE}" target="_blank" style="color:${C.muted};text-decoration:none;">${THC_WEBSITE}</a><br>${THC_COMPANY_NUMBER}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// the register's copy, laid out
// ---------------------------------------------------------------------------

/**
 * A template line made only of "Label: {value}" — the office emails' detail
 * rows. The label is the template's own words (no placeholder in it).
 */
const FACT_LINE = /^([A-Z][A-Za-z0-9 &()'’/-]{0,48}):\s(.*)$/;
/** A template line that ends in a placeholder: "Set your password to sign in: {link}". */
const TRAILING_PLACEHOLDER = /^(.*?)\s*\{(\w+)\}\s*$/;

export interface TemplateToBlocksOptions {
  /**
   * Placeholder name → button label, for the placeholders that ARE links by
   * design (E3's `link` and `installLink`, E11's `link`). Chosen by name,
   * never by what a value looks like; the value must still be an http(s)
   * URL, or the line is drawn as text.
   */
  buttons?: Readonly<Record<string, string>>;
}

/**
 * Lay out a register template without changing a word of it. The structure
 * is read from the TEMPLATE, with its placeholders still in place, and the
 * values are filled in afterwards — so nothing a person typed into a value
 * (a URL, a blank line, a "Label: value" line) can add a link, a paragraph
 * or a facts row:
 *
 * - paragraphs split on the template's blank lines, single breaks kept;
 * - a template paragraph of two or more "Label: {value}" lines becomes the
 *   facts box, every row kept even when its value is empty (the text keeps
 *   "Note: " too);
 * - a template line ending in a button placeholder whose value is an
 *   http(s) URL becomes the line's words, then the gradient button, with the
 *   URL printed under it.
 */
export function templateToBlocks(
  template: string,
  values: Readonly<Record<string, string>>,
  options: TemplateToBlocksOptions = {},
): EmailBlock[] {
  const buttons = options.buttons ?? {};
  const fill = (t: string) => t.replace(PLACEHOLDER, (m, key: string) => values[key] ?? m);
  const blocks: EmailBlock[] = [];
  const paragraphs = template
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '');

  for (const para of paragraphs) {
    const rows = para.split('\n');
    const matched = rows.map((row) => FACT_LINE.exec(row));
    if (rows.length >= 2 && matched.every((m) => m !== null)) {
      blocks.push({
        kind: 'facts',
        keepEmpty: true,
        rows: matched.map((m) => ({ label: m![1]!, value: fill(m![2]!) })),
      });
      continue;
    }
    let pending: string[] = [];
    const flush = () => {
      if (pending.length > 0) blocks.push({ kind: 'filled', template: pending.join('\n'), values });
      pending = [];
    };
    for (const row of rows) {
      const trailing = TRAILING_PLACEHOLDER.exec(row);
      const name = trailing?.[2];
      const label =
        name !== undefined && Object.prototype.hasOwnProperty.call(buttons, name)
          ? buttons[name]
          : undefined;
      const url = name !== undefined ? (values[name] ?? '').trim() : '';
      if (trailing && label && isHttpUrl(url)) {
        if (trailing[1]) pending.push(trailing[1]);
        flush();
        blocks.push({ kind: 'button', label, href: url, showUrl: true });
        continue;
      }
      pending.push(row);
    }
    flush();
  }
  return blocks;
}

/** The first readable sentence of some copy, for the inbox preview line. */
export function preheaderFrom(text: string, max = 140): string {
  const flat = text
    .replace(URL_IN_TEXT, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
