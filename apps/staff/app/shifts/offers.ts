import {
  ACCEPT_REFUSAL_COPY,
  APPLY_REFUSAL_COPY,
  UK_ZONE,
  canCancelShift,
  formatDateIn,
  formatTimeIn,
  needsDualZone,
} from '@thc/domain';

/**
 * Cover requests and office-opened offers, as the worker sees them —
 * ADR-0046 (amended), docs/19 §4, `wireframes/staff/offer-shift.html`.
 *
 * A worker cannot offer their shift to other workers (THC, 02.10.2026;
 * 20261002110000). More than 72 hours out with auto-assign on, Cancel shift
 * is their tool (RULE-04, `canCancelShift()`); otherwise they can ask the
 * office for cover, and only the office opens a shift to the pool.
 *
 * Pure, so the screens' choices are unit-tested; the database is what
 * decides a press (`request_cover`, `withdraw_shift_offer`,
 * `take_offered_shift`). What lives here is which panel a confirmed shift
 * shows and the words on it — the sentences docs/19 §4 fixes are copied
 * verbatim.
 */

export interface Refusal {
  title: string;
  body: string;
}

/** The worker's open offer on one booking (`staff_booking_offers()`). */
export interface BookingOffer {
  bookingId: string;
  /** Auto-assign on for the event AND the role — then, > 72 h out, Cancel shift is the tool. */
  autoAssign: boolean;
  offerId: string | null;
  /** `office`: a cover request. `pool`: one the office opened to other workers. */
  mode: 'pool' | 'office' | 'direct' | null;
  expiresAt: Date | null;
  note: string | null;
}

/** "Sat 20 Sep, 16:00" — the dialog's and the detail's UK date and time. */
export function ukDateTime(at: Date): string {
  return `${formatDateIn(at, UK_ZONE, { weekday: 'short' })}, ${formatTimeIn(at, UK_ZONE)}`;
}

/** "Sat 20, 16:00" — the chip's short form (wireframe (c), (d)). */
export function ukShortDateTime(at: Date): string {
  const [weekday = '', day = ''] = formatDateIn(at, UK_ZONE, { weekday: 'short' }).split(' ');
  return `${weekday} ${day}, ${formatTimeIn(at, UK_ZONE)}`;
}

/**
 * §1.8's second line for one scheduled instant — an offer's close, the end
 * of the check-out window — in the viewer's own zone: "Sat 20, 17:00 your
 * time" (`withDate`), or "17:00 your time", led by the viewer's day
 * ("Sun 21 · 01:00 your time") only when it is not the UK day. Null on UK
 * time: there is no second line to draw. The first line is always UK and
 * says so.
 */
export function yourTimeAt(at: Date, zone: string, withDate = true): string | null {
  if (!needsDualZone(zone)) return null;
  const [weekday = '', day = ''] = formatDateIn(at, zone, { weekday: 'short' }).split(' ');
  const time = `${formatTimeIn(at, zone)} your time`;
  if (withDate) return `${weekday} ${day}, ${time}`;
  const sameDay = formatDateIn(at, zone) === formatDateIn(at, UK_ZONE);
  return sameDay ? time : `${weekday} ${day} · ${time}`;
}

/** "Offered · open until Sat 20, 16:00 (UK time)" */
export function offeredChip(expiresAt: Date): string {
  return `Offered · open until ${ukShortDateTime(expiresAt)} (UK time)`;
}

/** Wireframe (c): the still-booked line under the chip. */
export function offeredLine(expiresAt: Date): string {
  return `You're still booked. If someone takes it before ${ukShortDateTime(expiresAt)} (UK time), it's theirs and we'll let you know. If nobody does, you keep it.`;
}

/** Wireframe (d): the line on the `/shifts` card. */
export function offeredCardLine(expiresAt: Date): string {
  return `Offered to other workers · open until ${ukShortDateTime(expiresAt)} (UK time)`;
}

export const WITHDRAW_OFFER_BUTTON = 'Withdraw offer';

/** docs/19 §4: "Can't make it? **Ask the office for cover**". */
export const COVER_LEAD = "Can't make it?";
export const COVER_BUTTON = 'Ask the office for cover';
export const COVER_EXPLAINER =
  'It’s less than 72 hours to the start, so the office arranges cover. You’re still booked until they confirm.';
export const COVER_EXPLAINER_AUTO_OFF =
  'The office is arranging this shift by hand, so it arranges cover too. You’re still booked until they confirm.';
export const COVER_NOTE_LABEL = 'Note to the office · optional';
/** docs/19 §4, verbatim. */
export const COVER_REQUESTED =
  "Cover requested — the office will be in touch. You're still booked until they confirm.";
export const COVER_CHIP = 'Cover requested';

export type OfferPanel =
  /** A cover request the office opened to other workers: the chip and Withdraw offer. */
  | 'offered'
  /** Inside 72 h, or auto-assign off: Ask the office for cover. */
  | 'cover'
  /** A cover request is open: "Cover requested". */
  | 'cover_requested'
  /**
   * Nothing here: not confirmed, the section has started, or more than
   * 72 h out with auto-assign on — Cancel shift (RULE-04) is the tool, and
   * a worker never offers a shift to other workers (THC, 02.10.2026).
   */
  | 'none';

/**
 * Which offer panel a booking shows (docs/19 §4). The server re-decides
 * every press; this only keeps the screen from offering one it would refuse.
 */
export function offerPanel(
  booking: { status: string; startsAt: Date },
  offer: Pick<BookingOffer, 'autoAssign' | 'offerId' | 'mode'> | null,
  now: Date = new Date(),
): OfferPanel {
  if (booking.status !== 'confirmed') return 'none';
  if (now.getTime() >= booking.startsAt.getTime()) return 'none';
  if (offer?.offerId) return offer.mode === 'office' ? 'cover_requested' : 'offered';
  if (canCancelShift(booking.startsAt, now) && offer?.autoAssign) return 'none';
  return 'cover';
}

// ---------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------

const NOT_YOURS: Refusal = {
  title: 'This shift is no longer yours',
  body: 'It may have been withdrawn by the office or released. Check your notifications.',
};

/** What `request_cover()` can refuse. */
export const COVER_REFUSAL_COPY: Readonly<Record<string, Refusal>> = {
  use_cancel: {
    title: 'You can still cancel this shift',
    body: 'More than 72 hours before the start, use “Cancel shift” and we’ll find someone else.',
  },
  note_too_long: {
    title: 'That note is too long',
    body: 'Please keep the note to the office to 300 characters.',
  },
  already_offered: {
    title: 'The office already has this shift',
    body: 'There is already an open offer or cover request on it. You’re still booked.',
  },
  recently_requested: {
    title: 'You asked for cover on this shift recently',
    body: 'You withdrew a cover request for this shift in the last 24 hours. If you still can’t make it, contact the office. You’re still booked.',
  },
  section_started: APPLY_REFUSAL_COPY.shift_started,
  not_confirmed: NOT_YOURS,
  event_cancelled: ACCEPT_REFUSAL_COPY.event_cancelled,
};

export function withdrawOfferRefusalCopy(): Refusal {
  return {
    title: 'This offer is no longer open',
    body: 'Somebody may have taken it, or it has closed. Check your shifts.',
  };
}

/**
 * `take_offered_shift()`'s refusals, each in Radar's existing words (no new
 * wording — wireframe (j)). An offer somebody else took, withdrew or let
 * lapse reads exactly as a Radar shift that filled while the worker looked.
 */
const TAKE_REFUSAL_COPY: Readonly<Record<string, Refusal>> = {
  event_cancelled: APPLY_REFUSAL_COPY.event_cancelled,
  offer_not_open: APPLY_REFUSAL_COPY.full,
  offer_expired: APPLY_REFUSAL_COPY.full,
  original_not_confirmed: APPLY_REFUSAL_COPY.full,
  not_yet: APPLY_REFUSAL_COPY.full,
  own_offer: APPLY_REFUSAL_COPY.already_has_booking,
  already_had_booking: APPLY_REFUSAL_COPY.already_has_booking,
  section_started: APPLY_REFUSAL_COPY.shift_started,
  not_bookable: ACCEPT_REFUSAL_COPY.not_bookable,
  wrong_role: APPLY_REFUSAL_COPY.wrong_role,
  male_only: APPLY_REFUSAL_COPY.male_only,
  female_only: APPLY_REFUSAL_COPY.female_only,
  gender_not_recorded: APPLY_REFUSAL_COPY.gender_not_recorded,
  language_not_spoken: APPLY_REFUSAL_COPY.language_not_spoken,
  languages_not_recorded: APPLY_REFUSAL_COPY.languages_not_recorded,
  do_not_return: APPLY_REFUSAL_COPY.do_not_return,
  blocked: APPLY_REFUSAL_COPY.blocked,
  self_cancelled: APPLY_REFUSAL_COPY.self_cancelled,
  overlap: APPLY_REFUSAL_COPY.booked_elsewhere,
  rtw_expired: APPLY_REFUSAL_COPY.rtw_expired,
  hours_limit: APPLY_REFUSAL_COPY.hours_limit,
};

export function takeRefusalCopy(reason: string): Refusal | undefined {
  return TAKE_REFUSAL_COPY[reason];
}

export const TAKE_BUTTON = 'Take this shift';
export const TAKE_NOTE =
  'Taking it books you straight away — it’s a confirmed shift, not an application.';
export const UP_FOR_GRABS = 'Up for grabs';
