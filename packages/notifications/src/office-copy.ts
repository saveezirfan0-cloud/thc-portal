/**
 * The office's hidden copy of every timesheet sent to a client (ADR-0179).
 *
 * THC, 21.10.2026: a colleague (Sam) receives a copy of every Allocation
 * Timesheet (D1) and Completed Allocation Timesheet (D2) that goes to a
 * client — the automatic send, the "(updated)" resend and the manual Send
 * buttons — without the client seeing the address.
 *
 *   settings.document_office_copy  { "emails": [] } — 0 to 5 addresses,
 *                                  lower-case, no repeats; empty = off.
 *                                  Owner-editable on /settings like every
 *                                  other row; the database refuses any other
 *                                  shape (settings_document_office_copy_guard).
 *
 * The addresses are read when the email is QUEUED (queue_event_document_
 * email / _autosend, through document_office_copy()) and written into the
 * outbox row's `payload.bcc`, so the row itself records who was copied. The
 * drain renders `payload.bcc` as Resend's `bcc`, never as `to` or `cc`. An
 * address already in To is left out — the same person never gets the email
 * twice, and an address the client chose is never hidden from them.
 *
 * Nothing the Client Portal reads carries them: `event_document_recipients`,
 * `client_events_v.timesheet_recipients` and `client_account_v` are unchanged,
 * and `notification_outbox` is admin-read only.
 */

import { UnsendableRow } from './outbox.ts';

/** The `settings` row. */
export const OFFICE_COPY_SETTING_KEY = 'document_office_copy';

/** At most this many addresses. */
export const OFFICE_COPY_MAX = 5;

/** The document emails that carry the copy: the two timesheets, not the invoice. */
export const OFFICE_COPY_TEMPLATES = ['D1', 'D2'] as const;

/**
 * An address as `set_event_document_recipients()` and the settings guard
 * accept one: something@something.something, no spaces, commas or semicolons.
 */
const ADDRESS = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

export function isOfficeCopyAddress(address: string): boolean {
  return address.length <= 254 && ADDRESS.test(address);
}

/** Trimmed, lower-cased, blanks dropped, repeats dropped, in the order given. */
export function normaliseAddresses(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const address = raw.trim().toLowerCase();
    if (address === '' || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

/**
 * The addresses in the settings row, as the database reads them: a JSON
 * object whose `emails` is a list of strings. Anything else is "off".
 */
export function readOfficeCopy(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const emails = (value as { emails?: unknown }).emails;
  if (!Array.isArray(emails)) return [];
  return normaliseAddresses(emails.filter((e): e is string => typeof e === 'string'));
}

/** The hidden copy for one email: the setting's addresses minus anyone already in To. */
export function officeCopyFor(value: unknown, to: readonly string[]): string[] {
  const inTo = new Set(to.map((address) => address.trim().toLowerCase()));
  return readOfficeCopy(value).filter((address) => !inTo.has(address));
}

/**
 * `payload.bcc` on a D1/D2 outbox row: a JSON array of addresses (or its
 * text form). Absent or empty is no copy. Anything else is a fault in the row
 * — the queue functions write only a clean list — and the row fails rather
 * than going out with a copy silently dropped.
 */
export function parseBcc(raw: unknown, code: string): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new UnsendableRow(`${code}: bcc is not JSON`);
    }
  }
  if (!Array.isArray(list) || list.some((a) => typeof a !== 'string' || !a.includes('@'))) {
    throw new UnsendableRow(`${code}: bcc is not a list of addresses`);
  }
  return normaliseAddresses(list as string[]);
}
