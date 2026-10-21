/**
 * The sign-in / sign-out log attached to THC's invoice (ADR-0176, amended
 * 20.10.2026): one row per charged shift, as the invoice charges it, with
 * when the worker actually signed in and out in the Staff App and the
 * break deducted — so the client can cross-check the invoice line by line.
 *
 * Every figure comes from the invoice's own lines (`invoice_document_data`);
 * the hours here ARE the invoice's hours. Times are UK and 24-hour (§1.8).
 *
 * A shift signed out more than 15 minutes late has two invoice lines, the
 * shift and its overrun (ADR-0184). The log keeps one row per shift — one
 * sign-in, one sign-out — so the overrun line is folded back into its
 * shift's row: the hours are both lines' together, and the note says
 * "Overrun 1 h 15 min". The log's total hours stay the invoice's.
 */

import {
  OVERRUN_KIND,
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

/** "Overrun 1 h 15 min", "Overrun 45 min", "Overrun 2 h" (ADR-0184). */
export function overrunNote(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean);
  return `Overrun ${parts.join(' ')}`;
}

/** What the client should know about a line, in the office's words. */
export function logNotes(l: InvoiceLineData, overrunMin = 0): string {
  if (l.kind === 'cancelled_on_day') return 'Cancelled on the day: charged in full';
  const notes: string[] = [];
  if (l.late) notes.push('Late');
  if (l.leftEarly) notes.push('Left early');
  if (overrunMin > 0) notes.push(overrunNote(overrunMin));
  if (l.finishByOffice) notes.push('No sign-out: finish time entered by THC');
  if (l.floorApplied) notes.push('4-hour minimum');
  return notes.join(' · ');
}

/**
 * One printed row per charged shift. `overrunMin` is the shift's overrun
 * line (ADR-0184), already part of the hours this row shows.
 */
export function signInLogRow(l: InvoiceLineData, overrunMin = 0): string[] {
  return [
    l.staffName,
    l.employeeId === null || l.employeeId === undefined ? '—' : String(l.employeeId),
    l.role,
    `${logTime(l.startsAt, l.date)}–${logTime(l.endsAt, l.date)}`,
    logTime(l.checkInAt, l.date),
    logTime(l.checkOutAt, l.date),
    invoiceBreak(l.breakMin),
    invoiceHours(l.payableMin + overrunMin),
    logNotes(l, overrunMin),
  ];
}

/** A shift's line with its overrun line folded in (ADR-0184). */
interface LogShift {
  line: InvoiceLineData;
  overrunMin: number;
}

/** The shift an overrun line belongs to: the line just before it, same booking. */
function ownsOverrun(shift: LogShift | undefined, l: InvoiceLineData): shift is LogShift {
  if (!shift || shift.line.kind === OVERRUN_KIND || shift.overrunMin > 0) return false;
  if (l.bookingId || shift.line.bookingId) return shift.line.bookingId === l.bookingId;
  // An older snapshot without booking ids: the same worker on the same day.
  return shift.line.staffName === l.staffName && shift.line.date === l.date;
}

export interface SignInLogSection {
  heading: string;
  rows: string[][];
  payableMin: number;
}

interface SectionDraft {
  heading: string;
  shifts: LogShift[];
  payableMin: number;
}

/**
 * The log's sections: one per event (date · title · venue), in the
 * invoice's line order, each with its own hours. A line without an event
 * id (an older snapshot) falls into a section per date.
 */
export function signInLogSections(data: InvoiceDocumentData): SignInLogSection[] {
  const byId = new Map(data.events.map((e) => [e.id, e]));
  const sections = new Map<string, SectionDraft>();
  for (const l of data.lines) {
    const ev = l.eventId ? byId.get(l.eventId) : undefined;
    const key = ev ? ev.id : `date:${l.date}`;
    let s = sections.get(key);
    if (!s) {
      const parts = [invoiceDate(ev?.date ?? l.date), ev?.title, ev?.venue].filter(Boolean);
      s = { heading: parts.join(' · '), shifts: [], payableMin: 0 };
      sections.set(key, s);
    }
    const last = s.shifts.at(-1);
    if (l.kind === OVERRUN_KIND && ownsOverrun(last, l)) last.overrunMin += l.payableMin;
    else s.shifts.push({ line: l, overrunMin: 0 });
    s.payableMin += l.payableMin;
  }
  return [...sections.values()].map((s) => ({
    heading: s.heading,
    rows: s.shifts.map((x) => signInLogRow(x.line, x.overrunMin)),
    payableMin: s.payableMin,
  }));
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

/** Under the title: the log's times are GPS-verified, not hand-written (THC, 20.10.2026). */
export const SIGN_IN_LOG_GPS_BADGE =
  'All times GPS-verified · recorded automatically by the THC Staff App';

/** How the times were taken, in full, for the client's accounts team. */
export const SIGN_IN_LOG_INTRO =
  'All sign-in and sign-out times on this log are recorded automatically by the THC Staff App and verified by GPS. ' +
  'A worker can only sign in when their phone\u2019s GPS places them at the venue. When they sign out, the app checks ' +
  'their GPS location again; if they have already left, the time recorded is the last moment GPS placed them on site. ' +
  'No time is written by hand, except where the notes say a finish time was entered by THC. Times are UK time (24-hour). ' +
  'Hours are the time worked within the booked shift, less unpaid breaks, and are the hours charged on the invoice. ' +
  'Where a worker signed out more than 15 minutes after the booked end, the hours run to their sign-out: the time past the booked end is noted as Overrun and charged on its own invoice line.';
