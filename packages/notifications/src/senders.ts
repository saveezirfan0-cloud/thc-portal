/**
 * Which address an email goes out from — Scope §9.12.
 *
 * The register names a sender by ROLE (`admin` or `timesheets`), never by
 * address. The address is a setting: `/settings` writes
 * `settings.senders = { admin, timesheets }`, and §9.12 says both are
 * configurable "without a release". So the drain reads that row at run time
 * and this module decides what to do with it.
 *
 * The defaults below are what 20260922180000 seeds and what the office's
 * settings screen falls back to. They are here so that a missing or broken
 * settings row still sends from a real, monitored mailbox rather than
 * failing every email — but they are the fallback, not the source.
 *
 * §9.12 also says "no-reply addresses are not used". `/settings` already
 * refuses one; a row written some other way (SQL, a restore) is refused
 * again here, because an email from a no-reply address is a reply that
 * nobody reads.
 */

import type { Sender } from './templates.ts';

export type ThcSender = Exclude<Sender, 'willo'>;

/** The display name every THC email carries. */
export const SENDER_NAME = 'The Hospitality Company';

/** Seeded by 20260922180000_staff_self_service.sql; the fallback only. */
export const DEFAULT_SENDER_ADDRESSES: Readonly<Record<ThcSender, string>> = {
  admin: 'admin@thehospitalitycompany.co.uk',
  timesheets: 'timesheets@thehospitalitycompany.co.uk',
};

const EMAIL = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$/;
const NO_REPLY = /^no-?reply@/i;

export interface ResolvedSender {
  /** The bare address. */
  address: string;
  /** `The Hospitality Company <admin@…>` — what goes in `from`. */
  from: string;
  /** Where the address came from, so a run can log a fallback. */
  source: 'settings' | 'default';
  /** Why the setting was not used, when it was not. */
  warning?: string;
}

/**
 * The address to send `sender`'s mail from, given the raw `settings.senders`
 * value (jsonb, so anything at all). Never throws: an unusable setting falls
 * back to the seeded address and says why.
 */
export function resolveSender(sender: ThcSender, setting: unknown): ResolvedSender {
  const fallback = (warning?: string): ResolvedSender => {
    const address = DEFAULT_SENDER_ADDRESSES[sender];
    return {
      address,
      from: `${SENDER_NAME} <${address}>`,
      source: 'default',
      ...(warning ? { warning } : {}),
    };
  };

  if (setting === null || setting === undefined) {
    return fallback('settings.senders is not set');
  }
  if (typeof setting !== 'object' || Array.isArray(setting)) {
    return fallback('settings.senders is not an object');
  }
  const raw = (setting as Record<string, unknown>)[sender];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fallback(`settings.senders.${sender} is not set`);
  }
  const address = raw.trim().toLowerCase();
  if (!EMAIL.test(address)) {
    return fallback(`settings.senders.${sender} is not an email address`);
  }
  if (NO_REPLY.test(address)) {
    return fallback(`settings.senders.${sender} is a no-reply address, which §9.12 rules out`);
  }
  return { address, from: `${SENDER_NAME} <${address}>`, source: 'settings' };
}
