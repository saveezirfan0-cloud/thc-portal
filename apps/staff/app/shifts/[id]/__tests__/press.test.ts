import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CHECK_OUT_FIX } from '../../../../lib/geo';
import { pressCheckOut } from '../press';

/**
 * Audit D14 · check-out sends the reading taken AT the press, or nothing.
 *
 * The screen used to send `fix ?? await locate()`: whatever it was holding,
 * however old. A worker who opened the screen on site and pressed Check out
 * later from the bus stop sent the on-site reading, and `check_out()` paid
 * them to now as an on-site press.
 */
describe('pressCheckOut()', () => {
  it('takes a fresh reading with the check-out deadline and sends it', async () => {
    const locate = vi.fn().mockResolvedValue({ lat: 51.6, lng: -0.2, accuracyM: 10 });
    const checkOut = vi.fn().mockResolvedValue({ ok: true });
    await pressCheckOut('b1', { locate, checkOut });
    expect(locate).toHaveBeenCalledWith(CHECK_OUT_FIX);
    expect(checkOut).toHaveBeenCalledWith('b1', 51.6, -0.2);
  });

  it('with no reading in time, sends NO coordinates — the server uses the last on-site fix', async () => {
    const locate = vi.fn().mockResolvedValue(null);
    const checkOut = vi.fn().mockResolvedValue({ ok: true });
    const { fix } = await pressCheckOut('b1', { locate, checkOut });
    expect(fix).toBeNull();
    expect(checkOut).toHaveBeenCalledWith('b1', null, null);
  });

  it('is handed no held fix to fall back on, and the screen no longer keeps one for it', () => {
    // The signature is the guarantee: `deps` has no place for a held fix.
    expect(pressCheckOut.length).toBe(2);
    const here = dirname(fileURLToPath(import.meta.url));
    const screen = readFileSync(join(here, '..', 'ShiftScreen.tsx'), 'utf8');
    expect(screen).not.toMatch(/fix \?\? \(?await locate/);
    expect(screen).toContain('pressCheckOut(shift.bookingId');
  });
});
