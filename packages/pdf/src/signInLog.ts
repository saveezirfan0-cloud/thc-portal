/**
 * The sign-in / sign-out log attached to THC's invoice (ADR-0176, amended
 * 20.10.2026): one row per charged shift, as the invoice charges it, with
 * when the worker actually signed in and out in the Staff App and the
 * break deducted — so the client can cross-check the invoice line by line.
 *
 * Every figure comes from the invoice's own lines (`invoice_document_data`);
 * the hours here ARE the invoice's hours. Times are UK and 24-hour (§1.8).
 */

import {
  invoiceBreak,
  invoiceDate,
  invoiceEventDates,
  invoiceHours,
  invoiceTime,
} from './invoice.ts';
import type { InvoiceDocumentData, InvoiceLineData } from './invoice.ts';
import { UK_ZONE } from './format.ts';

export const SIGN_IN_LOG_COLUMNS = [
  'STAFF NAME',
  'EMP. ID',
  'ROLE',
  'BOOKED',
  'SIGNED IN',
  'SIGNED OUT',
  'BREAK',
  'HOURS',
  'NOTES',
] as const;

const ukDay = (instant: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: UK_ZONE }).format(new Date(instant));

/** "02:00 (+1)" when the time falls on a later UK day than the shift's date. */
export function logTime(instant: string | null | undefined, shiftDate: string): string {
  if (!instant) return '—';
  const days = Math.round(
    (Date.parse(`${ukDay(instant)}T00:00:00Z`) - Date.parse(`${shiftDate}T00:00:00Z`)) / 86_400_000,
  );
  const t = invoiceTime(instant);
  return days > 0 ? `${t} (+${days})` : days < 0 ? `${t} (${days})` : t;
}

/** What the client should know about a line, in the office's words. */
export function logNotes(l: InvoiceLineData): string {
  if (l.kind === 'cancelled_on_day') return 'Cancelled on the day: charged in full';
  const notes: string[] = [];
  if (l.late) notes.push('Late');
  if (l.leftEarly) notes.push('Left early');
  if (l.finishByOffice) notes.push('No sign-out: finish time entered by THC');
  if (l.floorApplied) notes.push('4-hour minimum');
  return notes.join(' · ');
}

/** One printed row per charged shift. */
export function signInLogRow(l: InvoiceLineData): string[] {
  return [
    l.staffName,
    l.employeeId === null || l.employeeId === undefined ? '—' : String(l.employeeId),
    l.role,
    `${logTime(l.startsAt, l.date)}–${logTime(l.endsAt, l.date)}`,
    logTime(l.checkInAt, l.date),
    logTime(l.checkOutAt, l.date),
    invoiceBreak(l.breakMin),
    invoiceHours(l.payableMin),
    logNotes(l),
  ];
}

export interface SignInLogSection {
  heading: string;
  rows: string[][];
  payableMin: number;
}

/**
 * The log's sections: one per event (date · title · venue), in the
 * invoice's line order, each with its own hours. A line without an event
 * id (an older snapshot) falls into a section per date.
 */
export function signInLogSections(data: InvoiceDocumentData): SignInLogSection[] {
  const byId = new Map(data.events.map((e) => [e.id, e]));
  const sections = new Map<string, SignInLogSection>();
  for (const l of data.lines) {
    const ev = l.eventId ? byId.get(l.eventId) : undefined;
    const key = ev ? ev.id : `date:${l.date}`;
    let s = sections.get(key);
    if (!s) {
      const parts = [invoiceDate(ev?.date ?? l.date), ev?.title, ev?.venue].filter(Boolean);
      s = { heading: parts.join(' · '), rows: [], payableMin: 0 };
      sections.set(key, s);
    }
    s.rows.push(signInLogRow(l));
    s.payableMin += l.payableMin;
  }
  return [...sections.values()];
}

/** "Sign-in and sign-out log – Invoice 4000 – Client – PO X.pdf". */
export function signInLogFileName(invoiceFile: string): string {
  return `Sign-in and sign-out log – ${invoiceFile}`;
}

/** The line under the title: what it supports and when. */
export function signInLogSubtitle(data: InvoiceDocumentData): string {
  const po = data.poNumber ? ` · PO ${data.poNumber}` : '';
  return `Supporting invoice ${data.number} · ${data.billTo.name}${po} · ${invoiceEventDates(data.periodFrom, data.periodTo)}`;
}
