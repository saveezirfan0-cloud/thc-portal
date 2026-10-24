/**
 * The timesheet-invoice email (ADR-0210, INV2): the old tool's saved
 * template, and the allowlist that makes an office-composed rich-text body
 * safe to send.
 *
 * The office composes the message in the Back Office (To, Cc, Bcc, subject,
 * body, attachments); `queue_timesheet_invoice_email()` writes it to the
 * outbox as an INV2 row and the drain sends it as written. Two functions:
 *
 *   buildTimesheetInvoiceEmail()  the DEFAULT subject and body the compose
 *                                 screen opens with (audit §5).
 *   sanitiseEmailHtml()           what the drain does to the body before it
 *                                 leaves, whatever the office typed or pasted.
 *
 * The week-commencing rule (audit §10 item 15 flagged the old tool as
 * inconsistent): "w/c" is the MONDAY of the week that holds the first
 * event day, or the period start when the invoice has no event days. One
 * rule, here, for the subject, the PDF header and the Xero reference.
 */

import { escapeHtml } from './email-html.ts';

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parseIso(iso: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) throw new Error(`not an ISO date: ${iso}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`not a calendar date: ${iso}`);
  }
  return { y, m, d };
}

/** The Monday on or before an ISO date (calendar arithmetic, no time zone). */
export function mondayOf(iso: string): string {
  const { y, m, d } = parseIso(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return date.toISOString().slice(0, 10);
}

/** "12/10/26". */
export function shortDate(iso: string): string {
  const { y, m, d } = parseIso(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d)}/${two(m)}/${two(y % 100)}`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st, 22nd, 23rd. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/**
 * "15th, 17th October"; across months "30th September, 2nd October".
 * Days are de-duplicated and sorted; the month is named once after the last
 * day of each month's run.
 */
export function eventDaysLabel(eventDays: readonly string[]): string {
  const days = [...new Set(eventDays.map((iso) => parseIso(iso)))]
    .map((p) => ({ ...p, key: p.y * 10000 + p.m * 100 + p.d }))
    .sort((a, b) => a.key - b.key)
    .filter((p, i, all) => i === 0 || p.key !== all[i - 1]!.key);
  const groups: { y: number; m: number; days: number[] }[] = [];
  for (const p of days) {
    const last = groups[groups.length - 1];
    if (last && last.y === p.y && last.m === p.m) last.days.push(p.d);
    else groups.push({ y: p.y, m: p.m, days: [p.d] });
  }
  return groups.map((g) => `${g.days.map(ordinal).join(', ')} ${MONTHS[g.m - 1]}`).join(', ');
}

// ---------------------------------------------------------------------------
// the HTML allowlist
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li']);
const VOID_TAGS = new Set(['br']);
/** Elements whose whole content goes, not just their tags. */
const DROP_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  tab: '\t',
  newline: '\n',
};

/** Decode the entities a browser would, so a scheme check sees what it will. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function safeHref(raw: string): string | null {
  // Browsers ignore control characters and spaces inside a scheme.
  // eslint-disable-next-line no-control-regex
  const value = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, '');
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(value) ? value : null;
}

function hrefOf(attributes: string): string | null {
  const match = /(?:^|[\s/])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
  if (!match) return null;
  return safeHref(match[1] ?? match[2] ?? match[3] ?? '');
}

/**
 * The message body, cut down to p, br, b, strong, i, em, u, a[href], ul, ol, li.
 *
 * Every other tag is dropped and its text kept (script, style and the like
 * lose their content too); every attribute is dropped except an `href` that
 * is http, https or mailto; comments go; text is escaped; tags the writer
 * left open are closed and stray closing tags are ignored. Idempotent.
 */
export function sanitiseEmailHtml(input: string): string {
  const token =
    /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<[!?][^>]*>|[^<]+|</g;
  const open: string[] = [];
  let out = '';
  let skipping: string | null = null;
  for (const match of input.matchAll(token)) {
    const [whole, closing, rawName, attributes = ''] = match;
    if (!rawName) {
      // text, a comment, or malformed markup
      if (skipping || (whole.length > 1 && whole.startsWith('<'))) continue;
      // keep entities that are already entities; escape everything else
      out += escapeHtml(decodeEntities(whole));
      continue;
    }
    const name = rawName.toLowerCase();
    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    if (DROP_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(attributes)) skipping = name;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue;
    if (closing) {
      if (VOID_TAGS.has(name)) continue;
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    if (VOID_TAGS.has(name)) {
      out += '<br>';
      continue;
    }
    if (name === 'a') {
      const href = hrefOf(attributes);
      if (!href) continue; // no safe link: its text stays, as text
      open.push('a');
      out += `<a href="${escapeHtml(href)}">`;
      continue;
    }
    open.push(name);
    out += `<${name}>`;
  }
  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

/** The plain-text alternative of a sanitised body. */
export function emailHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br>/g, '\n')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<\/(ul|ol)>/g, '\n')
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_m, href: string, text: string) => {
      const url = decodeEntities(href);
      const label = text.replace(/<[^>]+>/g, '');
      const plain = decodeEntities(label);
      return plain.trim() === '' || plain === url || `mailto:${plain}` === url
        ? label || url
        : `${label} (${url.replace(/^mailto:/i, '')})`;
    })
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// the old tool's saved template (audit §5)
// ---------------------------------------------------------------------------

export interface TimesheetInvoiceEmailInput {
  /** The client's display name, as the old tool printed it. */
  displayName: string;
  invoiceNumber: number | string;
  /** The person written to; their first name opens the email. */
  contactName?: string | null;
  /**
   * Any date in the week to be named: the first event day, or the period
   * start. The subject prints the Monday of its week (see the file header).
   * Absent, the earliest of `eventDays` is used.
   */
  weekCommencing?: string | null;
  /** ISO dates of the event days, for the parenthetical. */
  eventDays?: readonly string[];
  poNumber?: string | null;
  /** The old tool's "omit event dates" tick: drops the parenthetical. */
  omitEventDates?: boolean;
  /** The sender's signature block, HTML (sanitised here). */
  signatureHtml?: string | null;
}

export interface TimesheetInvoiceEmail {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

function firstNameOf(contactName: string | null | undefined): string {
  const first = (contactName ?? '').trim().split(/\s+/)[0] ?? '';
  return first;
}

export function timesheetInvoiceSubject(input: TimesheetInvoiceEmailInput): string {
  const days = input.eventDays ?? [];
  const base = (input.weekCommencing ?? '').trim() || [...days].sort()[0] || '';
  const parts = [input.displayName.trim(), `Inv ${String(input.invoiceNumber).trim()}`];
  if (base) parts.push(`w/c ${shortDate(mondayOf(base))}`);
  if (!input.omitEventDates && days.length > 0) parts.push(`(${eventDaysLabel(days)})`);
  const po = (input.poNumber ?? '').trim();
  if (po) parts.push(po);
  return parts.join(' - ');
}

export function buildTimesheetInvoiceEmail(
  input: TimesheetInvoiceEmailInput,
): TimesheetInvoiceEmail {
  const subject = timesheetInvoiceSubject(input);
  const first = firstNameOf(input.contactName);
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const signature = sanitiseEmailHtml(input.signatureHtml ?? '');

  const paragraphs = [
    `<p>${escapeHtml(greeting)}</p>`,
    '<p>I hope you are well.</p>',
    '<p>Please find the staffing invoice attached:</p>',
    `<p><strong>${escapeHtml(subject)}</strong></p>`,
    '<p>The staff timesheets are attached for your reference.</p>',
    '<p>I would be grateful if you can please confirm that this invoice is processed and ready for payment.</p>',
    '<p>Many thanks.</p>',
    '<p>Best wishes,</p>',
  ];
  const bodyHtml = paragraphs.join('') + signature;
  return { subject, bodyHtml, bodyText: emailHtmlToText(bodyHtml) };
}
