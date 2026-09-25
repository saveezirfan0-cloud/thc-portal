import {
  ACCEPT_REFUSAL_COPY,
  APPLY_REFUSAL_COPY,
  UK_ZONE,
  canOfferShift,
  formatDateIn,
  formatTimeIn,
  needsDualZone,
  offerExpiresAt,
} from '@thc/domain';

/**
 * Offer up a shift, as the worker sees it — ADR-0039, docs/18 §4,
 * `wireframes/staff/offer-shift.html`.
 *
 * Pure, so the screens' choices are unit-tested. The rule itself is
 * `canOfferShift()` (= `canCancelShift()`, RULE-04's 72 hours) and
 * `offerExpiresAt()` from `@thc/domain`; the database is what decides a
 * press (`offer_shift`, `request_cover`, `take_offered_shift`). What lives
 * here is which panel a confirmed shift shows and the words on it — the
 * sentences docs/18 §4 fixes are copied verbatim.
 */

export interface Refusal {
  title: string;
  body: string;
}

/** The worker's open offer on one booking (`staff_booking_offers()`). */
export interface BookingOffer {
  bookingId: string;
  /** Auto-assign on for the event AND the role — Offer shows only then. */
  autoAssign: boolean;
  offerId: string | null;
  /** `pool` / `direct`: offered to workers. `office`: a cover request. */
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

export const OFFER_BUTTON = 'Offer this shift';
export const OFFER_LEAD =
  'Can’t make it? Offer it to other workers — you stay booked until someone takes it.';
export const OFFER_DIALOG_TITLE = 'Offer this shift?';

/** docs/18 §4, verbatim, with the UK close time filled in. */
export function offerDialogBody(startsAt: Date): string {
  return `We'll offer this shift to other workers. You stay booked until someone takes it — then it's theirs, and you can't be booked on this event again. Offers close ${ukDateTime(offerExpiresAt(startsAt))} (UK time), 72 hours before the start.`;
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

/** docs/18 §4: "Can't make it? **Ask the office for cover**". */
export const COVER_LEAD = "Can't make it?";
export const COVER_BUTTON = 'Ask the office for cover';
export const COVER_EXPLAINER =
  'It’s less than 72 hours to the start, so the office arranges cover. You’re still booked until they confirm.';
export const COVER_EXPLAINER_AUTO_OFF =
  'The office is arranging this shift by hand, so it arranges cover too. You’re still booked until they confirm.';
export const COVER_NOTE_LABEL = 'Note to the office · optional';
/** docs/18 §4, verbatim. */
export const COVER_REQUESTED =
  "Cover requested — the office will be in touch. You're still booked until they confirm.";
export const COVER_CHIP = 'Cover requested';

export type OfferPanel =
  /** > 72 h, auto-assign on, no open offer: Offer this shift. */
  | 'offer'
  /** An open offer to other workers: the chip and Withdraw offer. */
  | 'offered'
  /** Inside 72 h, or auto-assign off: Ask the office for cover. */
  | 'cover'
  /** A cover request is open: "Cover requested". */
  | 'cover_requested'
  /** Nothing to offer: not confirmed, or the section has started. */
  | 'none';

/**
 * Which offer panel a booking shows (docs/18 §4). The server re-decides
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
  if (canOfferShift(booking.startsAt, now) && offer?.autoAssign) return 'offer';
  return 'cover';
}

// ---------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------

const NOT_YOURS: Refusal = {
  title: 'This shift is no longer yours to offer',
  body: 'It may have been withdrawn by the office or released. Check your notifications.',
};

/** What `offer_shift()` can refuse, in the worker's words. */
export const OFFER_REFUSAL_COPY: Readonly<Record<string, Refusal>> = {
  too_late: {
    title: 'Too close to the shift to offer it',
    body: 'Offering a shift to other workers closes 72 hours before the start. Ask the office for cover instead.',
  },
  auto_assign_off: {
    title: 'This shift can’t be offered to other workers',
    body: 'The office is arranging this one by hand. Ask the office for cover instead.',
  },
  already_offered: {
    title: 'This shift is already offered',
    body: 'It stays yours until someone takes it. You can withdraw the offer at any time.',
  },
  not_confirmed: NOT_YOURS,
  event_cancelled: ACCEPT_REFUSAL_COPY.event_cancelled,
};

/** What `request_cover()` can refuse. */
export const COVER_REFUSAL_COPY: Readonly<Record<string, Refusal>> = {
  use_offer: {
    title: 'You can offer this shift yourself',
    body: 'More than 72 hours before the start, use “Offer this shift” — other workers can take it straight away.',
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
