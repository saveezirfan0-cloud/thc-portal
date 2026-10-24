/**
 * The email modal's rules (ADR-0210), client-safe: no server imports, so the
 * modal, the server action and the tests share them.
 *
 * `queue_timesheet_invoice_email()` normalises (lower-case, de-duplicate) and
 * validates the addresses again; these say the same thing before the round
 * trip, and keep Bcc / signature memory out of the database (per user, in the
 * browser).
 */

const EMAIL = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$/;

export const MAX_ADDRESSES = 10;

export function isAddress(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** "a@x.co.uk, B@x.co.uk;  a@x.co.uk" → ["a@x.co.uk", "b@x.co.uk"]. */
export function parseAddresses(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const value = part.trim().toLowerCase();
    if (value) seen.add(value);
  }
  return [...seen];
}

export interface EmailDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
}

/** Visible text of an HTML fragment (for "is the body empty?"). */
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Why this email cannot be sent, or null when it can. */
export function emailProblem(draft: EmailDraft): string | null {
  if (draft.to.length === 0) return 'Add at least one address in To.';
  for (const [name, list] of [
    ['To', draft.to],
    ['Cc', draft.cc],
    ['Bcc', draft.bcc],
  ] as const) {
    if (list.length > MAX_ADDRESSES) return `Up to ${MAX_ADDRESSES} addresses in ${name}.`;
    const bad = list.find((address) => !isAddress(address));
    if (bad) return `“${bad}” in ${name} is not an email address. Check it and send again.`;
  }
  if (draft.subject.trim() === '') return 'The email needs a subject.';
  if (draft.subject.length > 300) return 'The subject is too long (300 characters at most).';
  if (htmlText(draft.bodyHtml) === '') return 'The email needs a message.';
  if (draft.bodyHtml.length > 50_000) return 'The message is too long.';
  return null;
}

/** localStorage keys: the Bcc and the signature are remembered per signed-in user. */
export const bccKey = (userId: string) => `thc.invoice.bcc:${userId}`;
export const signatureKey = (userId: string) => `thc.invoice.signature:${userId}`;

/** Bytes as the old tool wrote them: "1856 KB". */
export function fileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
