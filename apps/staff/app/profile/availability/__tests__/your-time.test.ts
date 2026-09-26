import { describe, expect, it, vi } from 'vitest';
import type * as Domain from '@thc/domain';

/**
 * The Add sheet's "your time" line asks `needsDualZone()` whether the
 * phone is off UK time — the one §1.8 test every other screen uses — and
 * does not compare zone names itself. Pinned by overriding the domain
 * answer: if the screen kept its own `zone === UK_ZONE` test, flipping
 * `needsDualZone` would change nothing here.
 */
const dual = vi.hoisted(() => ({ answer: true }));

vi.mock('@thc/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>();
  return { ...actual, needsDualZone: vi.fn(() => dual.answer) };
});

const { addSheetYourTime } = await import('../model');
const { needsDualZone } = await import('@thc/domain');

const form = {
  mode: 'day' as const,
  fromDate: '2026-10-01',
  toDate: '2026-10-01',
  allDay: false,
  fromTime: '18:00',
  toTime: '23:00',
  repeatWeeks: 0,
};

describe('addSheetYourTime defers to needsDualZone (§1.8)', () => {
  it('draws no line when needsDualZone says the zone needs none, whatever its name', () => {
    dual.answer = false;
    expect(addSheetYourTime(form, 'Europe/Madrid')).toBeNull();
    expect(needsDualZone).toHaveBeenCalledWith('Europe/Madrid');
  });

  it('draws the line when needsDualZone says it is needed', () => {
    dual.answer = true;
    expect(addSheetYourTime(form, 'Europe/Madrid')).toBe('19:00 – 00:00 your time (Madrid)');
  });
});
