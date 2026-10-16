/**
 * Turning an outbox row into something sendable — Scope §8, §9.12.
 *
 * The register in `templates.ts` is copy. This is the step between a row in
 * `notification_outbox` and a Web Push or a Resend call, and it is pure on
 * purpose: the Edge Function that drains the outbox needs a live database,
 * VAPID keys and a Resend key, none of which exist in CI, but the decisions
 * that actually go wrong — sending the wrong half of N9, emailing the
 * address the scope did not name, sending E1 at all — are decided here and
 * can be tested with nothing.
 */

import { isHttpUrl } from './email-html.ts';
import { templateEmailHtml } from './email-layouts.ts';
import { DEFAULT_SENDER_ADDRESSES } from './senders.ts';
import type { Channel, Sender, Template, TemplateCode } from './templates.ts';
import {
  PORTAL_LINK_CODES,
  TEMPLATES,
  body,
  render,
  title,
  withInterviewLink,
} from './templates.ts';

/** A claimed row, as `claim_outbox_batch` returns it. */
export interface OutboxRow {
  id: number;
  key: string;
  channel: Channel;
  template: string;
  recipient_staff_id: string | null;
  recipient_emails: readonly string[] | null;
  payload: Record<string, string>;
  attempts: number;
}

export interface PushMessage {
  kind: 'push';
  staffId: string;
  title: string;
  body: string;
  url?: string;
  /** The button's label (N8 "Re-upload"); the button opens `url`. */
  action?: string;
  /** The collapse tag; the service worker falls back to the url. */
  tag?: string;
}

export interface EmailMessage {
  kind: 'email';
  sender: Exclude<Sender, 'willo'>;
  to: readonly string[];
  subject: string;
  /** The plain-text body — the register's copy, as it always was. */
  body: string;
  /**
   * The same words in the THC Light HTML layout (ADR-0073). Its header
   * image is `cid:thc-mark`, so it is sent with `inlineLogoAttachment()`.
   */
  html: string;
}

/**
 * Render-time choices that depend on the settings row, not the outbox row.
 * `replyTo` is the monitored address the email names (its footer, and a
 * document email's signature): the sender's reply-to from `resolveSender`.
 * Absent, the seeded address for the template's sender is used.
 */
export interface RenderOptions {
  replyTo?: string;
  /**
   * The Client Portal's origin (CLIENT_PORTAL_URL), for the codes whose
   * `{link}` is the event's portal page (PORTAL_LINK_CODES, ADR-0135 §3).
   * Absent, their `{link}` stays unfilled; the drain holds such a row as
   * unconfigured rather than sending it.
   */
  clientPortalUrl?: string;
}

/** An event id, as client_lineup_notices() writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether the code's `{link}` is the Client Portal's event page (ADR-0135 §3). */
export function needsPortalLink(code: string): boolean {
  return (PORTAL_LINK_CODES as readonly string[]).includes(code);
}

/**
 * The origin from CLIENT_PORTAL_URL, or null when it is missing or not an
 * http(s) origin. A path or query on it is dropped: the link is always
 * `<origin>/client/events/<id>`.
 */
export function portalOrigin(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `<origin>/client/events/<id>` — the page the email points at. */
export function portalLink(origin: string, eventId: string): string {
  return `${origin}/client/events/${eventId}`;
}

export type OutboxMessage = PushMessage | EmailMessage;

/** Raised for a row that must never be retried — the row is wrong, not the network. */
export class UnsendableRow extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsendableRow';
  }
}

function templateFor(code: string): Template {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, code)) {
    throw new UnsendableRow(`${code} is not a code in the §8 register`);
  }
  return TEMPLATES[code as TemplateCode];
}

/**
 * The backoff curve, in milliseconds. It repeats `outbox_backoff()` in
 * 20260921130927_jobs_and_outbox_drain.sql, and `110_jobs_and_outbox.sql`
 * asserts the same numbers on the SQL side. The database is what actually
 * schedules a retry; this is here so a caller can say when the next attempt
 * is due without a round trip, and so the two cannot drift unnoticed.
 */
export function outboxBackoffMs(attempt: number): number {
  const minute = 60_000;
  const n = Math.max(Math.trunc(attempt), 1);
  return Math.min(30 * minute, minute * 2 ** (n - 1));
}

/**
 * Where a push lands: the row's `link` when the register lists it among the
 * code's `deepLinkOptions`, otherwise the register's own deep link.
 */
export function pushLink(entry: Template, values: Record<string, string>): string | undefined {
  const picked = values['link'];
  if (picked && entry.deepLinkOptions?.includes(picked)) return picked;
  return entry.deepLink ? render(entry.deepLink, values) : undefined;
}

/**
 * What to send for a row, or a throw saying why it can never be sent.
 *
 * Everything this rejects is a fault in the row rather than in the network,
 * so a caller should fail it outright rather than retry it six times.
 */
export function messageFor(row: OutboxRow, options: RenderOptions = {}): OutboxMessage {
  const entry = templateFor(row.template);

  if (entry.channel !== row.channel) {
    throw new UnsendableRow(
      `${row.template} is ${entry.channel} in the register but the row is ${row.channel}`,
    );
  }

  let values: Record<string, string> = row.payload ?? {};

  // ADR-0135 §3: the customer's link is built here, never taken from the
  // row — an event id the database wrote, under the configured origin.
  if (needsPortalLink(row.template)) {
    const eventId = values.eventId ?? '';
    if (!UUID.test(eventId)) {
      throw new UnsendableRow(`${row.template} needs the event's id in its payload`);
    }
    const origin = portalOrigin(options.clientPortalUrl);
    const { link: _ignored, ...rest } = values;
    values = origin ? { ...rest, link: portalLink(origin, eventId) } : rest;
  }

  // A code with variants (N9, N14, CL2, the OC chasers) has no single
  // body: the row names the half — or the rung — in `variant`.
  const variant = entry.variants ? values.variant : undefined;
  if (entry.variants && !variant) {
    throw new UnsendableRow(
      `${row.template} needs a variant in its payload: ${Object.keys(entry.variants).join(' | ')}`,
    );
  }
  let copy: string;
  try {
    copy = body(row.template as TemplateCode, variant);
  } catch (cause) {
    throw new UnsendableRow(`${row.template}: ${(cause as Error).message}`);
  }
  // ADR-0149: OC1 carries the interview's public link when the row has one.
  // A value that is not http(s) is ignored, so the copy never shows a raw
  // `{interviewLink}` and the email goes out as it always did.
  if (row.template === 'OC1' && isHttpUrl(values.interviewLink ?? '')) {
    copy = withInterviewLink(copy);
  }
  const heading = title(row.template as TemplateCode, variant);

  if (entry.channel === 'push') {
    if (!row.recipient_staff_id) {
      throw new UnsendableRow(`${row.template} is a push with no recipient_staff_id`);
    }
    const url = pushLink(entry, values);
    const tag = entry.tag ? render(entry.tag, values) : undefined;
    return {
      kind: 'push',
      staffId: row.recipient_staff_id,
      title: render(heading, values),
      body: render(copy, values),
      ...(url ? { url } : {}),
      ...(entry.action ? { action: entry.action } : {}),
      // An unfilled placeholder is not a tag: two different documents
      // would collapse into one notification.
      ...(tag && !/\{\w+\}/.test(tag) ? { tag } : {}),
    };
  }

  // Email. §8 names the recipients for the office and payroll sends; a row
  // may name its own only where the register does not.
  if (entry.sender === 'willo' || entry.sender === undefined) {
    throw new UnsendableRow(
      `${row.template} is not ours to send: §8 gives it no THC sender (E1 is Willo's)`,
    );
  }
  const to = entry.recipients ?? row.recipient_emails;
  if (!to || to.length === 0) {
    throw new UnsendableRow(`${row.template} is an email with no recipient`);
  }
  // IR1's button is its whole point (ADR-0122): without an http(s) link the
  // row is wrong, not late, so it fails once rather than retrying.
  if (row.template === 'IR1' && !isHttpUrl(values.applyLink ?? '')) {
    throw new UnsendableRow('IR1 needs an http(s) applyLink in its payload');
  }
  const subject = render(heading, values);
  const text = render(copy, values);
  return {
    kind: 'email',
    sender: entry.sender,
    to,
    subject,
    body: text,
    // Laid out from the template, not from `text`: a value never shapes the HTML.
    html: templateEmailHtml(
      row.template,
      subject,
      copy,
      values,
      text,
      options.replyTo ?? DEFAULT_SENDER_ADDRESSES[entry.sender],
    ),
  };
}
