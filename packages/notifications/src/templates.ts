/**
 * Notification register — Scope §8.
 *
 * Copy is DATA, not code. Every push (N*) and email (E*) in the scope gets one
 * entry here, and every send goes through `notification_outbox` with a unique
 * key so a job re-run can never double-send.
 *
 * Phase 0 seeds the shape and the handful of templates the foundation needs.
 * The `notifications` bot fills in the full N1–N15 / E2–E9 register as each
 * phase lands, taking the copy verbatim from §8.
 */

export type Channel = 'push' | 'email';

export interface Template {
  /** The register code, e.g. "N6b" or "E3". */
  code: string;
  channel: Channel;
  /** Verbatim from §8. Placeholders are `{name}` style. */
  title: string;
  body: string;
  /** Sender for emails (§9.12): admin@ or timesheets@. */
  sender?: 'admin' | 'timesheets';
  /** Where tapping the push should land the worker. */
  deepLink?: string;
}

export const TEMPLATES = {
  E3: {
    code: 'E3',
    channel: 'email',
    sender: 'admin',
    title: 'Activate your account',
    body: 'Your application was accepted. Set your password to start onboarding: {link}',
  },
  N8: {
    code: 'N8',
    channel: 'push',
    title: 'Document rejected',
    body: 'Document rejected — {reason}',
    deepLink: '/documents',
  },
} as const satisfies Record<string, Template>;

export type TemplateCode = keyof typeof TEMPLATES;

export function template(code: TemplateCode): Template {
  return TEMPLATES[code];
}

/**
 * The idempotency key for an outbox row. The same code for the same subject
 * is written once; a re-run of the job hits the unique index and does nothing.
 */
export function outboxKey(code: string, subject: string, id: string | number): string {
  return `${code}:${subject}:${id}`;
}

export function render(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
