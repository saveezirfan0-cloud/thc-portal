/**
 * Email through Resend — Scope §8, §9.12, §11.4.
 *
 * Like `webpush.ts`, this builds the request and reads the answer; the
 * drain makes the call. https://resend.com/docs/api-reference/emails/send-email
 *
 * `Idempotency-Key` is the outbox key. The lease in `claim_outbox_batch`
 * stops two drains sending the same row; this covers the other gap — a
 * send that reached Resend but whose answer was lost (a timeout, the
 * function killed mid-response). The retry carries the same key and Resend
 * returns the first result instead of mailing payroll twice.
 */

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface ResendAttachment {
  filename: string;
  /** base64 (standard alphabet), as Resend expects. */
  content: string;
}

export interface ResendEmail {
  from: string;
  to: readonly string[];
  subject: string;
  text: string;
  /** Replies go to the sender's monitored mailbox (§9.12). */
  replyTo?: string;
  attachments?: readonly ResendAttachment[];
}

export interface HttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** Resend caps an Idempotency-Key at 256 characters. */
function idempotencyKey(key: string): string {
  return key.length <= 256 ? key : key.slice(0, 256);
}

export function buildResendRequest(
  email: ResendEmail,
  apiKey: string,
  outboxKey: string,
): HttpRequest {
  const body: Record<string, unknown> = {
    from: email.from,
    to: [...email.to],
    subject: email.subject,
    text: email.text,
  };
  if (email.replyTo) body.reply_to = email.replyTo;
  if (email.attachments && email.attachments.length > 0) {
    body.attachments = email.attachments.map((a) => ({ filename: a.filename, content: a.content }));
  }
  return {
    url: RESEND_ENDPOINT,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey(outboxKey),
    },
    body: JSON.stringify(body),
  };
}

/**
 * What Resend's answer means for the row.
 *
 *   sent       2xx.
 *   permanent  400 / 422 — the message itself is invalid (a malformed
 *              recipient, an attachment Resend refuses). The same bytes will
 *              be refused again, so the row fails now rather than six times.
 *              409 is an idempotency-key reuse with a different body, which
 *              is also a fault in the row.
 *   retry      401/403 (a key or domain problem the owner can fix), 429,
 *              5xx, anything else.
 */
export type EmailVerdict = 'sent' | 'permanent' | 'retry';

export function classifyResendStatus(status: number): EmailVerdict {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 400 || status === 409 || status === 422) return 'permanent';
  return 'retry';
}

/** base64 for attachment bytes, without Node's Buffer (this also runs in Deno). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}
