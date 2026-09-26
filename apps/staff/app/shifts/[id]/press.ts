import { CHECK_OUT_FIX } from '../../../lib/geo';
import type { Fix, FixOptions } from '../../../lib/geo';

/**
 * The check-out press (§5.1), apart from React so the rule can be tested.
 *
 * Audit D14: `ShiftScreen` used to send `fix ?? await locate()` — whatever
 * reading the screen was holding, however old. A worker who opened the
 * screen on site and pressed Check out an hour later from the bus stop sent
 * the on-site reading, `check_out()` took it as an on-site press, and they
 * were paid to now.
 *
 * So the press takes its own reading and nothing else: this function is
 * handed no held fix to fall back on. A reading inside `CHECK_OUT_FIX`'s
 * eight seconds goes with the press; with none, the press goes with no
 * coordinates at all, and the server records the last on-site fix from the
 * ping trail or, with none of those, raises RULE-02's No check-out.
 */
export async function pressCheckOut<R>(
  bookingId: string,
  deps: {
    locate: (options: FixOptions) => Promise<Fix | null>;
    checkOut: (bookingId: string, lat: number | null, lng: number | null) => Promise<R>;
  },
): Promise<{ fix: Fix | null; result: R }> {
  const fix = await deps.locate(CHECK_OUT_FIX);
  const result = await deps.checkOut(bookingId, fix?.lat ?? null, fix?.lng ?? null);
  return { fix, result };
}
