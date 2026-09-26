import { describe, expect, it } from 'vitest';
import { ukRoleWindow } from '@thc/domain';
import { TEMPLATES } from '@thc/notifications';
import { type StoredSection, planReconfirmations, reconfirmOutboxRows } from '../reconfirm';

/**
 * §3.5 re-confirmation after an event save (audit D34): who is asked, what
 * the card says, which push, and that every save is its own message.
 */
const DATE = '2026-10-02';
const stored = (
  start: string,
  end: string,
  dress: string | null = 'Black & whites',
): StoredSection => {
  const w = ukRoleWindow(DATE, start, end);
  return {
    id: 'sec-1',
    starts_at: w.startsAt.toISOString(),
    ends_at: w.endsAt.toISOString(),
    dress_code: dress,
  };
};
const unchanged = { dateChanged: false, venueChanged: false, venueBefore: '1 Test Street' };
const role = (start: string, end: string, dressCode = 'Black & whites') => ({
  id: 'sec-1',
  start,
  end,
  dressCode,
});

describe('planReconfirmations', () => {
  it('asks nobody when nothing that matters changed (headcount, buffer, charge are silent)', () => {
    expect(
      planReconfirmations(DATE, [role('09:00', '14:00')], [stored('09:00', '14:00')], unchanged),
    ).toEqual([]);
  });

  it('a start move: N11, and the card line the scope quotes', () => {
    const [plan] = planReconfirmations(
      DATE,
      [role('10:00', '14:00')],
      [stored('09:00', '14:00')],
      unchanged,
    );
    expect(plan!.code).toBe('N11');
    expect(plan!.reason).toBe('Start time moved by the office (was 09:00–14:00)');
    expect(plan!.window).toBe('10:00 – 14:00 (UK)');
  });

  it('an end move is N11 too — either end triggers it (§8 N11)', () => {
    const [plan] = planReconfirmations(
      DATE,
      [role('09:00', '15:00')],
      [stored('09:00', '14:00')],
      unchanged,
    );
    expect(plan!.code).toBe('N11');
    expect(plan!.reason).toBe('End time moved by the office (was 09:00–14:00)');
  });

  it('a dress-code change is N11b, never "Shift time changed"', () => {
    const [plan] = planReconfirmations(
      DATE,
      [role('09:00', '14:00', 'Black tie')],
      [stored('09:00', '14:00')],
      unchanged,
    );
    expect(plan!.code).toBe('N11b');
    expect(plan!.reason).toBe('Dress code changed by the office (was Black & whites)');
  });

  it('a venue change asks the role too, with the old address', () => {
    const [plan] = planReconfirmations(DATE, [role('09:00', '14:00')], [stored('09:00', '14:00')], {
      ...unchanged,
      venueChanged: true,
    });
    expect(plan!.code).toBe('N11b');
    expect(plan!.reason).toBe('Venue changed by the office (was 1 Test Street)');
  });

  it('a section added in this save asks nobody', () => {
    expect(
      planReconfirmations(DATE, [{ ...role('10:00', '14:00'), id: null }], [], unchanged),
    ).toEqual([]);
  });
});

describe('reconfirmOutboxRows — every save is its own message', () => {
  const booking = { id: 'bk-1', staff_id: 'st-1' };

  it('keys on start, end and the save, so a second end-time change is not swallowed', () => {
    const first = planReconfirmations(
      DATE,
      [role('09:00', '15:00')],
      [stored('09:00', '14:00')],
      unchanged,
    )[0]!;
    const second = planReconfirmations(
      DATE,
      [role('09:00', '16:00')],
      [stored('09:00', '15:00')],
      unchanged,
    )[0]!;
    const [a] = reconfirmOutboxRows(first, [booking], '2026-09-29T10:00:00.000Z');
    const [b] = reconfirmOutboxRows(second, [booking], '2026-09-29T10:05:00.000Z');
    // The old key was N11:booking:<id>:<new start> — identical for these two.
    expect(a!.key).not.toBe(b!.key);
    expect(a!.key.startsWith('N11:booking:bk-1:')).toBe(true);
  });

  it('a dress-code change after a time change is a message of its own', () => {
    const time = planReconfirmations(
      DATE,
      [role('10:00', '14:00')],
      [stored('09:00', '14:00')],
      unchanged,
    )[0]!;
    const dress = planReconfirmations(
      DATE,
      [role('10:00', '14:00', 'Black tie')],
      [stored('10:00', '14:00')],
      unchanged,
    )[0]!;
    const [a] = reconfirmOutboxRows(time, [booking], 'save-1');
    const [b] = reconfirmOutboxRows(dress, [booking], 'save-2');
    expect(a!.template).toBe('N11');
    expect(b!.template).toBe('N11b');
    expect(a!.key).not.toBe(b!.key);
  });

  it('carries the values the register renders, never rendered copy', () => {
    const plan = planReconfirmations(
      DATE,
      [role('10:00', '14:00')],
      [stored('09:00', '14:00')],
      unchanged,
    )[0]!;
    const [row] = reconfirmOutboxRows(plan, [booking], 'save-1');
    expect(row).toMatchObject({
      channel: TEMPLATES.N11.channel,
      recipient_staff_id: 'st-1',
      payload: {
        window: '10:00 – 14:00 (UK)',
        change: 'Start time moved by the office (was 09:00–14:00)',
        bookingId: 'bk-1',
      },
    });
    expect(JSON.stringify(row!.payload)).not.toMatch(/starts_at|ends_at/);
  });
});
