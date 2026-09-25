import { loadShift, supabaseConfigured } from '../data';
import { shiftScreenReachable, shiftPhase, isEndScreen } from '../phase';
import { buildShiftIcs, icsFilename } from '../ics';

/** A calendar entry is the state of right now; nothing may be cached. */
export const dynamic = 'force-dynamic';

/**
 * `GET /shifts/:id/calendar.ics` — "Add to calendar" on the shift screen.
 *
 * A route handler rather than a Blob built in the browser: iOS Safari, in
 * and out of a home-screen PWA, only offers its "Add to Calendar" sheet for
 * a `text/calendar` RESPONSE, and Android hands the same response to the
 * calendar app.
 *
 * The booking is read exactly as the screen reads it — `staff_shift_detail()`
 * with the caller's own session, which answers for their own bookings only
 * (another worker's id returns nothing, so 404). What the screen would not
 * show as a live shift — an invitation, a §10.4 dead end, a turn-away — gets
 * no calendar entry either.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const shift = await loadShift(id);
  if (!shift || shift.status === 'invited' || !shiftScreenReachable(shift)) {
    return new Response('Not found', { status: 404 });
  }
  const phase = shiftPhase({ shift, openBreak: false, now: new Date() });
  if (isEndScreen(phase)) return new Response('Not found', { status: 404 });

  const startsAt = new Date(shift.startsAt);
  const body = buildShiftIcs({
    bookingId: shift.bookingId,
    eventTitle: shift.eventTitle,
    roleName: shift.roleName,
    startsAt,
    endsAt: new Date(shift.endsAt),
    venueName: shift.venueName,
    venueAddress: shift.venueAddress,
    venueLat: shift.venueLat,
    venueLng: shift.venueLng,
    dressCode: shift.dressCode,
    onsiteContact: shift.onsiteContact,
    url: new URL(`/shifts/${shift.bookingId}`, request.url).toString(),
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // `inline`: iOS opens its Add to Calendar sheet for it; Android, which
      // cannot render text/calendar, downloads it under this name.
      'Content-Disposition': `inline; filename="${icsFilename(startsAt)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
