/**
 * Name badges, laid out — ADR-0081 (THC, 02.10.2026).
 *
 * Some clients put THC's staff in their own badge holders. For those
 * clients (`clients.name_badges`), the Allocation Timesheet email (D1)
 * carries a second PDF: one badge per person on the sheet, the THC lockup
 * at the top and the worker's first name under it. The client prints it,
 * cuts along the lines and slides each badge into a holder.
 *
 *   · The same people as the Allocation Timesheet it travels with —
 *     confirmed and worked bookings from `event_document_data()` — in the
 *     same order (`orderPeople`), so the badges come off the printer in the
 *     order the sheet lists them.
 *   · A worker removed under §1.7 gets no badge: "Deleted account #id" is a
 *     row on a timesheet, not a person at the door.
 *   · First name only. A badge is worn in front of guests; the surname is
 *     on the timesheet, where the client needs it. A person with no first
 *     name on record falls back to the name the sheet prints.
 *   · Each badge is 86 × 54 mm — the standard card size most badge holders
 *     take — ten to an A4 page, two across and five down, with the cut
 *     lines shared between neighbours.
 *   · No money, no Employee ID, no role, no photo (§11.1; a badge is a name).
 *
 * `BadgesDocument.tsx` only draws what this returns, as `SheetDocument.tsx`
 * does for the sheet.
 */

import { orderPeople, safeFileName } from './sheet.ts';
import type { SheetEvent, SheetPerson } from './sheet.ts';
import { ukDateFromIsoDate } from './format.ts';
import { paginate } from './pagination.ts';

/** One millimetre in PDF points. */
const MM = 72 / 25.4;

/** The card a badge is printed on, in millimetres and points. */
export const BADGE_SIZE_MM = { width: 86, height: 54 } as const;
export const BADGE_SIZE = {
  width: BADGE_SIZE_MM.width * MM,
  height: BADGE_SIZE_MM.height * MM,
} as const;

export const BADGE_COLUMNS = 2;
export const BADGE_ROWS = 5;
export const BADGES_PER_PAGE = BADGE_COLUMNS * BADGE_ROWS;

/** What the product calls the file, in the email and on the event page. */
export const BADGES_DOCUMENT_NAME = 'Name Badges';

export interface Badge {
  bookingId: string;
  name: string;
}

export interface BadgePage {
  number: number;
  of: number;
  badges: Badge[];
}

export interface BadgeLayout {
  /** "Client – Event – Name Badges". */
  title: string;
  fileName: string;
  dateLabel: string;
  count: number;
  pages: BadgePage[];
}

export interface BadgeInput {
  event: SheetEvent;
  people: readonly SheetPerson[];
}

/** The name on the badge: the first name, or the sheet's name without one. */
export function badgeName(person: SheetPerson): string {
  const first = (person.firstName ?? '').trim();
  return first !== '' ? first : person.name.trim();
}

export function layoutBadges(input: BadgeInput, perPage: number = BADGES_PER_PAGE): BadgeLayout {
  const badges: Badge[] = orderPeople(input.people).flatMap((section) =>
    section.people
      .filter((person) => !person.removed)
      .map((person) => ({ bookingId: person.bookingId, name: badgeName(person) })),
  );
  const chunks = paginate(badges, perPage);
  const title = `${input.event.clientName} – ${input.event.title} – ${BADGES_DOCUMENT_NAME}`;
  return {
    title,
    fileName: safeFileName(title),
    dateLabel: ukDateFromIsoDate(input.event.eventDate),
    count: badges.length,
    pages: chunks.map((chunk, index) => ({
      number: index + 1,
      of: chunks.length,
      badges: chunk,
    })),
  };
}

/**
 * The type size for a name, so "Jo" and "Maximilian" both sit on one line
 * of an 86 mm badge. Helvetica-Bold averages about 0.6 em a character.
 */
export function badgeNameSize(name: string): number {
  const length = [...name].length;
  if (length <= 9) return 28;
  if (length <= 12) return 24;
  if (length <= 16) return 19;
  return 15;
}

/** A plain-text drawing of the layout, for tests and review. */
export function badgesText(layout: BadgeLayout): string {
  const out: string[] = [];
  for (const page of layout.pages) {
    out.push(`=== Page ${page.number} of ${page.of} · ${layout.title} · ${layout.dateLabel} ===`);
    for (let i = 0; i < page.badges.length; i += BADGE_COLUMNS) {
      out.push(
        page.badges
          .slice(i, i + BADGE_COLUMNS)
          .map((b) => `[THC] ${b.name}`)
          .join(' | '),
      );
    }
  }
  return `${out.join('\n')}\n`;
}
