/**
 * The allocation sheet and sign-out timesheet, laid out — Scope §11.3.
 *
 * "The format is 1:1 with THC's current form … We are not inventing our own
 * format." This module decides everything about the document that a test
 * can hold without a PDF reader: who is on it and in what order, what every
 * cell says, which page each row lands on, which section headings repeat,
 * where "(continued)" goes, and that the footer block is printed once, on
 * the last page. `SheetDocument.tsx` only draws what this returns, so the
 * golden files in `__tests__/__golden__/` are the contract for the document.
 *
 * The rules, in §11.3's terms:
 *
 *   · ONE document per EVENT, all roles together; title "Client – Event".
 *   · Header: logo + name · STAFF ALLOCATION · Date DD/MM/YYYY; PO Number.
 *   · Columns: Photo · Staff Name ("Name (Employee ID)" + "(Role)") ·
 *     Start Time (scheduled start + forecast finish in brackets) · Finish
 *     Time · Signature · Comments · Hours Worked.
 *   · At most 12 staff rows a page (`paginate`, `ROWS_PER_PAGE`); a row is
 *     never split; header and column headings repeat; "Page X of Y" on every
 *     page; every page after the first repeats the event name and date with
 *     "(continued)"; the footer — Total Hours (the whole event), Manager's
 *     Name (PRINT), Manager's Signature, Date, company details — appears
 *     once, on the final page.
 *   · Ordered by role section, then surname within the role.
 *   · Allocation: Finish · Signature · Comments · Hours blank, for the client
 *     to fill in by hand. Sign-out: filled from check-in/out and the break
 *     log; a worker with an unresolved No check-out gets blank Finish and
 *     Hours rather than a guess (RULE-02). Signature is blank in both.
 *   · A worker removed under §1.7 is "Deleted account #id" with no photo on
 *     any copy generated after the removal, sorted last in their role
 *     because the surname is gone. (The data arrives that way from
 *     `event_document_data`; this module never sees the real name.)
 *   · No money anywhere on the document (§11.1).
 */

import { employeeIdLabel, hoursMinutes, ukDateFromIsoDate, ukTime } from './format.ts';
import { ROWS_PER_PAGE, paginate } from './pagination.ts';

export type SheetKind = 'allocation' | 'signout';

export const COMPANY = {
  name: 'The Hospitality Company',
  strapline: 'Event staffing · London',
  registered: 'Registered Company 12411407',
  email: 'timesheets@thehospitalitycompany.co.uk',
  website: 'www.thehospitalitycompany.co.uk',
} as const;

export const COMPANY_LINE = [
  COMPANY.name,
  COMPANY.registered,
  COMPANY.email,
  COMPANY.website,
].join(' · ');

export const SHEET_TITLE = 'STAFF ALLOCATION';

export const SHEET_COLUMNS = [
  'Photo',
  'Staff Name',
  'Start Time',
  'Finish Time',
  'Signature',
  'Comments',
  'Hours Worked',
] as const;

export interface SheetEvent {
  title: string;
  clientName: string;
  /** ISO calendar date of the event. */
  eventDate: string;
  poNumber: string | null;
}

/** One booking, as `event_document_data()` returns it. */
export interface SheetPerson {
  bookingId: string;
  employeeId: number | null;
  /** Already "Deleted account #id" for a removed worker. */
  name: string;
  firstName?: string | null;
  /** Null for a removed worker: sorts last within the role. */
  surname: string | null;
  removed: boolean;
  photoPath: string | null;
  roleName: string;
  /** Stable id of the role section; falls back to role + window. */
  sectionId?: string | null;
  /** The ROLE SECTION's window (RULE-18), never the event's. */
  startsAt: string;
  endsAt: string;
  finishAt: string | null;
  workedMin: number | null;
  /** scheduled (not started) · settled · pending (No check-out) · no_show. */
  status: 'scheduled' | 'settled' | 'pending' | 'no_show';
  breakMin: number;
}

export interface SheetInput {
  kind: SheetKind;
  event: SheetEvent;
  people: readonly SheetPerson[];
}

export interface SheetRow {
  bookingId: string;
  /** Storage path of the photo to draw, or null for an empty cell. */
  photoPath: string | null;
  name: string;
  idLabel: string;
  role: string;
  startTime: string;
  finishTime: string;
  signature: string;
  comments: string;
  hoursWorked: string;
}

export type SheetLine = { type: 'section'; label: string } | { type: 'row'; row: SheetRow };

export interface SheetPage {
  number: number;
  of: number;
  /** Every page after the first: the event name and date again, "(continued)". */
  continued: boolean;
  lines: SheetLine[];
  /** True only on the last page: the footer block is printed once. */
  footer: boolean;
}

export interface SheetLayout {
  kind: SheetKind;
  /** "Client – Event" (§11.3). */
  title: string;
  /** The same, as a file name that survives every mail client. */
  fileName: string;
  dateLabel: string;
  poNumber: string | null;
  rowCount: number;
  /** Whole event, not the page. Blank on the allocation sheet. */
  totalHours: string;
  pages: SheetPage[];
}

interface Section {
  key: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  people: SheetPerson[];
}

const collator = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true });

function sectionKey(person: SheetPerson): string {
  return person.sectionId ?? `${person.startsAt}|${person.endsAt}|${person.roleName}`;
}

/**
 * Role sections by their own start (RULE-18), then role name; within a
 * section, surname — with the removed, whose surname is gone, last.
 */
export function orderPeople(people: readonly SheetPerson[]): Section[] {
  const sections = new Map<string, Section>();
  for (const person of people) {
    const key = sectionKey(person);
    let section = sections.get(key);
    if (!section) {
      section = {
        key,
        roleName: person.roleName,
        startsAt: person.startsAt,
        endsAt: person.endsAt,
        people: [],
      };
      sections.set(key, section);
    }
    section.people.push(person);
  }

  const ordered = [...sections.values()].sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      collator.compare(a.roleName, b.roleName) ||
      a.key.localeCompare(b.key),
  );

  for (const section of ordered) {
    section.people.sort(
      (a, b) =>
        Number(a.removed) - Number(b.removed) ||
        collator.compare(a.surname ?? '', b.surname ?? '') ||
        collator.compare(a.firstName ?? a.name, b.firstName ?? b.name) ||
        (a.employeeId ?? 0) - (b.employeeId ?? 0) ||
        a.bookingId.localeCompare(b.bookingId),
    );
  }
  return ordered;
}

function comments(kind: SheetKind, person: SheetPerson): string {
  if (kind === 'allocation') return '';
  const parts: string[] = [];
  if (person.status === 'no_show') parts.push('No show');
  if (person.breakMin > 0) parts.push(`Break ${person.breakMin} min`);
  return parts.join(' · ');
}

function toRow(kind: SheetKind, person: SheetPerson): SheetRow {
  // RULE-02: an unresolved No check-out has no finish and no hours to print.
  const settled = kind === 'signout' && person.status === 'settled';
  return {
    bookingId: person.bookingId,
    photoPath: person.removed ? null : person.photoPath,
    name: person.name,
    idLabel: person.employeeId === null ? '' : `(${employeeIdLabel(person.employeeId)})`,
    role: `(${person.roleName})`,
    startTime: `${ukTime(person.startsAt)} (${ukTime(person.endsAt)})`,
    finishTime: settled ? ukTime(person.finishAt) : '',
    signature: '',
    comments: comments(kind, person),
    hoursWorked: settled ? hoursMinutes(person.workedMin) : '',
  };
}

/** Characters no mail client or file system argues with; the en dash stays. */
export function safeFileName(title: string): string {
  const printable = [...title].map((ch) => (ch.charCodeAt(0) < 0x20 ? ' ' : ch)).join('');
  const cleaned = printable
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cleaned || 'Timesheet'}.pdf`;
}

export function layoutSheet(input: SheetInput, perPage: number = ROWS_PER_PAGE): SheetLayout {
  const { kind, event } = input;
  const sections = orderPeople(input.people);

  const flat = sections.flatMap((section) =>
    section.people.map((person) => ({ section, person, row: toRow(kind, person) })),
  );

  const chunks = paginate(flat, perPage);
  const of = chunks.length;

  const pages: SheetPage[] = chunks.map((chunk, index) => {
    const lines: SheetLine[] = [];
    let current: Section | null = null;
    for (let i = 0; i < chunk.length; i += 1) {
      const entry = chunk[i]!;
      if (entry.section !== current) {
        current = entry.section;
        const onThisPage = chunk.filter((e) => e.section === current).length;
        const total = current.people.length;
        const window = `${ukTime(current.startsAt)} – ${ukTime(current.endsAt)}`;
        const startedEarlier = i === 0 && index > 0 && chunks[index - 1]!.some((e) => e.section === current);
        const continuesLater = index < of - 1 && chunks[index + 1]!.some((e) => e.section === current);
        let label = `${current.roleName} · ${window} · `;
        if (startedEarlier) {
          label += `continued (${onThisPage} of ${total})`;
        } else {
          label += `${total} staff`;
          if (continuesLater) label += ` (${onThisPage} on this page, continued on page ${index + 2})`;
        }
        lines.push({ type: 'section', label });
      }
      lines.push({ type: 'row', row: entry.row });
    }
    return { number: index + 1, of, continued: index > 0, lines, footer: index === of - 1 };
  });

  const totalMin =
    kind === 'signout'
      ? flat.reduce(
          (sum, { person }) =>
            sum + (person.status === 'settled' && person.workedMin !== null ? person.workedMin : 0),
          0,
        )
      : null;

  const title = `${event.clientName} – ${event.title}`;
  return {
    kind,
    title,
    fileName: safeFileName(title),
    dateLabel: ukDateFromIsoDate(event.eventDate),
    poNumber: event.poNumber && event.poNumber.trim() !== '' ? event.poNumber.trim() : null,
    rowCount: flat.length,
    totalHours: totalMin === null ? '' : hoursMinutes(totalMin),
    pages,
  };
}

/**
 * A plain-text drawing of the layout: what the golden files hold, so a
 * reviewer can read a three-page sheet in a diff. Photos print as [photo]
 * or [ ] (no photo — removed, or never taken).
 */
export function sheetText(layout: SheetLayout): string {
  const out: string[] = [];
  for (const page of layout.pages) {
    out.push(`=== Page ${page.number} of ${page.of} ===`);
    out.push(`[logo] ${COMPANY.name} · ${COMPANY.strapline} | ${SHEET_TITLE} | Date: ${layout.dateLabel}`);
    const eventLine = page.continued
      ? `${layout.title} · ${layout.dateLabel} (continued)`
      : layout.title;
    out.push(layout.poNumber ? `${eventLine} | PO Number: ${layout.poNumber}` : eventLine);
    out.push(SHEET_COLUMNS.join(' | '));
    for (const line of page.lines) {
      if (line.type === 'section') {
        out.push(`-- ${line.label}`);
      } else {
        const r = line.row;
        out.push(
          [
            r.photoPath ? '[photo]' : '[ ]',
            `${r.name} ${r.idLabel} ${r.role}`.replace(/\s+/g, ' ').trim(),
            r.startTime,
            r.finishTime,
            r.signature,
            r.comments,
            r.hoursWorked,
          ].join(' | '),
        );
      }
    }
    if (page.footer) {
      out.push(
        `Total Hours: ${layout.totalHours} | Manager's Name (PRINT): | Manager's Signature: | Date:`,
      );
      out.push(COMPANY_LINE);
    }
    out.push(`Page ${page.number} of ${page.of}`);
  }
  return `${out.join('\n')}\n`;
}
