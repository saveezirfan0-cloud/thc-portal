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

import type { Channel, Sender, Template, TemplateCode } from './templates.ts';
import { TEMPLATES, body, render } from './templates.ts';

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
}

export interface EmailMessage {
  kind: 'email';
  sender: Exclude<Sender, 'willo'>;
  to: readonly string[];
  subject: string;
  body: string;
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
 * What to send for a row, or a throw saying why it can never be sent.
 *
 * Everything this rejects is a fault in the row rather than in the network,
 * so a caller should fail it outright rather than retry it six times.
 */
export function messageFor(row: OutboxRow): OutboxMessage {
  const entry = templateFor(row.template);

  if (entry.channel !== row.channel) {
    throw new UnsendableRow(
      `${row.template} is ${entry.channel} in the register but the row is ${row.channel}`,
    );
  }

  const values = row.payload ?? {};

  if (entry.channel === 'push') {
    if (!row.recipient_staff_id) {
      throw new UnsendableRow(`${row.template} is a push with no recipient_staff_id`);
    }
    // N9 is the one code with two halves; the row has to say which.
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
    return {
      kind: 'push',
      staffId: row.recipient_staff_id,
      title: render(entry.title, values),
      body: render(copy, values),
      ...(entry.deepLink ? { url: render(entry.deepLink, values) } : {}),
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
  if (entry.body === undefined) {
    throw new UnsendableRow(`${row.template} has no body to send`);
  }
  return {
    kind: 'email',
    sender: entry.sender,
    to,
    subject: render(entry.title, values),
    body: render(entry.body, values),
  };
}
