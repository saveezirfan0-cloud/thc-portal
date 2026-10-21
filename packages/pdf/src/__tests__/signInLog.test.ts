import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { A4_POINTS, countPdfPages, pdfPageSizes } from '../SheetDocument';
import { renderSignInLogPdf } from '../SignInLogDocument';
import {
  logNotes,
  logTime,
  overrunNote,
  signInLogFileName,
  signInLogRow,
  signInLogSections,
} from '../signInLog';
import type { InvoiceDocumentData, InvoiceLineData } from '../invoice';

/**
 * ADR-0176 (amended 20.10.2026): the log attached to the invoice, so the
 * client can cross-check each charged shift against when the worker
 * actually signed in and out. BST dates (October 2026, +01:00).
 */
const EV1 = '11111111-1111-4111-8111-111111111111';
const EV2 = '22222222-2222-4222-8222-222222222222';

function line(over: Partial<InvoiceLineData>): InvoiceLineData {
  return {
    date: '2026-10-14',
    staffName: 'Grace Lindqvist',
    employeeId: 619,
    role: 'Team Leader',
    startsAt: '2026-10-14T11:00:00+01:00',
    endsAt: '2026-10-14T16:00:00+01:00',
    breakMin: 30,
    payableMin: 270,
    rate: '23.80',
    amount: '107.10',
    kind: 'worked',
    eventId: EV1,
    checkInAt: '2026-10-14T10:52:00+01:00',
    checkOutAt: '2026-10-14T16:04:00+01:00',
    late: false,
    leftEarly: false,
    finishByOffice: false,
    floorApplied: false,
    ...over,
  };
}

const DATA: InvoiceDocumentData = {
  id: 'inv',
  number: 4000,
  invoiceDate: '2026-10-15',
  dueDate: '2026-10-22',
  periodFrom: '2026-10-14',
  periodTo: '2026-10-15',
  poNumber: 'MO-7731',
  payableMin: 270 + 240 + 600,
  net: '0',
  vatRate: '20',
  vat: '0',
  total: '0',
  termsDays: 7,
  billTo: { name: 'Mandarin Oriental' },
  seller: { company: { name: 'THE HOSPITALITY COMPANY (London) Ltd' } },
  recipients: [],
  events: [
    { id: EV1, title: 'Corporate Lunch', date: '2026-10-14', venue: 'Ballroom' },
    { id: EV2, title: 'Gala Dinner', date: '2026-10-15', venue: 'Ballroom' },
  ],
  lines: [
    line({}),
    line({
      staffName: 'Luca Moretti',
      employeeId: 701,
      checkInAt: '2026-10-14T11:20:00+01:00',
      late: true,
      breakMin: 0,
      payableMin: 240,
      floorApplied: true,
    }),
    line({
      eventId: EV2,
      date: '2026-10-15',
      staffName: 'Priya Sharma',
      employeeId: 655,
      startsAt: '2026-10-15T17:00:00+01:00',
      endsAt: '2026-10-16T02:00:00+01:00',
      checkInAt: '2026-10-15T16:55:00+01:00',
      checkOutAt: '2026-10-16T02:00:00+01:00',
      finishByOffice: true,
      breakMin: 0,
      payableMin: 540,
    }),
  ],
};

describe('sign-in and sign-out log rows (ADR-0176)', () => {
  it('writes the booked window, the actual sign-in and sign-out, the break and the hours', () => {
    expect(signInLogRow(DATA.lines[0]!)).toEqual([
      'Grace Lindqvist',
      '619',
      'Team Leader',
      '11:00–16:00',
      '10:52',
      '16:04',
      '30 mins',
      '4.50',
      '',
    ]);
  });

  it('marks a time after midnight with the day it fell on', () => {
    expect(logTime('2026-10-16T02:00:00+01:00', '2026-10-15')).toBe('02:00 (+1)');
    expect(signInLogRow(DATA.lines[2]!)[3]).toBe('17:00–02:00 (+1)');
    expect(logTime(null, '2026-10-15')).toBe('—');
  });

  it('says why a line reads as it does', () => {
    expect(logNotes(DATA.lines[1]!)).toBe('Late · 4-hour minimum');
    expect(logNotes(DATA.lines[2]!)).toBe('No sign-out: finish time entered by THC');
    expect(logNotes(line({ kind: 'cancelled_on_day', checkInAt: null }))).toBe(
      'Cancelled on the day: charged in full',
    );
  });

  it("folds an overrun line into its shift: one row, both lines' hours, the overrun noted (ADR-0184)", () => {
    const shift = line({
      bookingId: 'b-1',
      checkOutAt: '2026-10-14T17:15:00+01:00',
      breakMin: 0,
      payableMin: 300,
    });
    const overrun = line({
      bookingId: 'b-1',
      kind: 'overrun',
      startsAt: '2026-10-14T16:00:00+01:00',
      endsAt: '2026-10-14T17:15:00+01:00',
      breakMin: 0,
      payableMin: 75,
    });
    const data = {
      ...DATA,
      lines: [shift, overrun, line({ bookingId: 'b-2', staffName: 'Luca Moretti' })],
    };
    const [section] = signInLogSections(data);
    expect(section!.rows).toHaveLength(2);
    expect(section!.rows[0]).toEqual([
      'Grace Lindqvist',
      '619',
      'Team Leader',
      '11:00–16:00',
      '10:52',
      '17:15',
      '—',
      '6.25',
      'Overrun 1 h 15 min',
    ]);
    // The log's hours are the invoice lines' hours.
    expect(section!.payableMin).toBe(300 + 75 + 270);
  });

  it('writes the overrun in hours and minutes', () => {
    expect(overrunNote(75)).toBe('Overrun 1 h 15 min');
    expect(overrunNote(45)).toBe('Overrun 45 min');
    expect(overrunNote(120)).toBe('Overrun 2 h');
    expect(logNotes(line({ late: true, floorApplied: true }), 30)).toBe(
      'Late · Overrun 30 min · 4-hour minimum',
    );
  });

  it('groups by event, each with its own hours', () => {
    const sections = signInLogSections(DATA);
    expect(sections.map((x) => x.heading)).toEqual([
      '14/10/2026 · Corporate Lunch · Ballroom',
      '15/10/2026 · Gala Dinner · Ballroom',
    ]);
    expect(sections.map((x) => x.payableMin)).toEqual([510, 540]);
  });

  it('is named after the invoice it supports', () => {
    expect(signInLogFileName('Invoice 4000 – Mandarin Oriental – PO MO-7731.pdf')).toBe(
      'Sign-in and sign-out log – Invoice 4000 – Mandarin Oriental – PO MO-7731.pdf',
    );
  });
});

describe('rendered log (ADR-0176)', () => {
  it('is an A4 landscape PDF', { timeout: 20_000 }, async () => {
    const pdf = await renderSignInLogPdf(DATA);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(countPdfPages(pdf)).toBeGreaterThanOrEqual(1);
    for (const size of pdfPageSizes(pdf)) {
      expect(size.width).toBeCloseTo(A4_POINTS.height, 1);
      expect(size.height).toBeCloseTo(A4_POINTS.width, 1);
    }
    if (process.env.SIGNIN_LOG_PREVIEW) writeFileSync(process.env.SIGNIN_LOG_PREVIEW, pdf);
  });
});
