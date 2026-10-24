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

const EDITOR_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI']);

/**
 * What the editors may start with (browser only): the allowed tags and a
 * safe `href`, everything else flattened to its text. The server cuts the
 * body to the same list before it is sent (`sanitiseEmailHtml`); this keeps
 * a remembered signature from putting markup into the page itself.
 */
export function safeEditorHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const clean = (node: Node, into: HTMLElement) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        into.append(doc.createTextNode(child.textContent ?? ''));
      } else if (child.nodeType === 1) {
        const el = child as HTMLElement;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(el.tagName)) return;
        if (!EDITOR_TAGS.has(el.tagName)) {
          clean(el, into);
          return;
        }
        const copy = doc.createElement(el.tagName.toLowerCase());
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') ?? '';
          if (/^(https?:\/\/|mailto:)\S+$/i.test(href)) copy.setAttribute('href', href);
        }
        clean(el, copy);
        into.append(copy);
      }
    });
  };
  const out = doc.createElement('div');
  clean(doc.body, out);
  return out.innerHTML;
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
