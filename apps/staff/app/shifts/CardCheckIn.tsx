'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, GpsChip } from '@thc/ui';
import { CHECK_IN_OPENS_MIN, addMinutes } from '@thc/domain';
import { checkIn } from './[id]/actions';
import { CHECK_IN_MESSAGES } from './[id]/messages';
import { distanceM, formatDistance } from './[id]/phase';
import { checkInCaption } from './list';
import { useGeoFix } from './useGeoFix';

/**
 * Check-in inside the today card (§10.4: "today's shift carries check-in
 * inside the card"; wireframe shifts.html lines 41-43).
 *
 * The same control as the shift screen's, in the card: the GPS line, the
 * `Check in — verify GPS` button and the opens-now / starts-in caption.
 * The decision is `attempt_check_in`'s — the grace, the lock, the strict
 * buffer turn-away — and a successful press opens the shift screen, which
 * is where the on-shift state, the breaks and check-out live (§5).
 */
export function CardCheckIn({
  bookingId,
  startsAt,
  venue,
  radiusM,
}: {
  bookingId: string;
  /** The ROLE section's start (RULE-18), ISO. */
  startsAt: string;
  venue: { lat: number; lng: number } | null;
  radiusM: number;
}) {
  const router = useRouter();
  const { fix, gpsError, locate } = useGeoFix(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const start = new Date(startsAt);
  const open = now.getTime() >= addMinutes(start, -CHECK_IN_OPENS_MIN).getTime();
  const metres = fix && venue ? distanceM(fix, venue) : null;
  const inside = metres !== null && metres <= radiusM;

  async function press() {
    setBusy(true);
    setError(null);
    // A fresh fix at the moment of the tap, never the one from page load.
    const fresh = await locate();
    if (!fresh) {
      setBusy(false);
      return;
    }
    const result = await checkIn(bookingId, fresh.lat, fresh.lng);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    const key = String(result.result.messageKey ?? '');
    if (key === 'checked_in' || key === 'checked_in_late' || key.startsWith('turned_away')) {
      router.push(`/shifts/${bookingId}`);
      return;
    }
    setError(CHECK_IN_MESSAGES[key] ?? 'Check-in was not recorded. Try again.');
  }

  return (
    <>
      {gpsError ? <Alert tone="coral">{gpsError}</Alert> : null}
      {metres !== null ? (
        <GpsChip inside={inside}>
          {inside ? (
            <>
              <b>On site</b> · {formatDistance(metres)} from the venue centre
            </>
          ) : (
            <>
              <b>You’re {formatDistance(metres)} from the venue.</b> Check-in opens within {radiusM}{' '}
              m of the venue.
            </>
          )}
        </GpsChip>
      ) : null}
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <Button
        block
        size="lg"
        tone="primary"
        disabled={!open || !inside || busy}
        onClick={() => void press()}
      >
        {busy ? 'Checking in…' : 'Check in — verify GPS'}
      </Button>
      <p className="xs muted" suppressHydrationWarning>
        {checkInCaption(start, now)}
      </p>
    </>
  );
}
