import { describe, expect, it } from 'vitest';
import {
  ACCEPT_APPLICATION_REFUSAL_COPY,
  APPLICATION_ACCEPT_REFUSALS,
  APPLICATION_NOT_TAKEN_CAUSE,
  CANCEL_EVENT_REFUSAL_COPY,
  acceptApplication,
  acceptApplicationRefusal,
  appliedAgo,
  cancelCauseStatus,
  cancelEventRefusal,
  canTransitionBooking,
  noSeatLeft,
  type ApplicationAcceptInput,
} from '../index';

/**
 * The office takes a Radar application forward (§3.3, §10.4, §8 N10/N10c).
 * The same order as accept_application() in 20260925100000; pgTAP 510 holds
 * the database to it.
 */
const NOW = new Date('2026-10-01T10:00:00Z');
const base: ApplicationAcceptInput = {
  status: 'applied',
  eventCancelled: false,
  shiftEndsAt: new Date('2026-10-02T22:00:00Z'),
  confirmed: 2,
  headcount: 3,
  gate: null,
};

describe('acceptApplication', () => {
  it('confirms a pending application with no gate while the role has room', () => {
    expect(acceptApplication({ ...base, confirmed: 1 }, NOW)).toEqual({
      ok: true,
      to: 'confirmed',
      closesApplications: false,
    });
    expect(canTransitionBooking('applied', 'confirmed')).toBe(true);
  });

  it('an application is for a seat: the one that takes the last seat of headcount closes the rest (N10c)', () => {
    expect(acceptApplication({ ...base, confirmed: 2 }, NOW)).toEqual({
      ok: true,
      to: 'confirmed',
      closesApplications: true,
    });
    // One threshold with Radar (D39): no seat left at headcount, whatever
    // the buffer — the buffer is filled by invitations.
    expect(acceptApplication({ ...base, confirmed: 3 }, NOW)).toEqual({
      ok: false,
      reason: 'full',
    });
  });

  it('refuses in the database order: cancelled, not applied, ended, full, then the gates', () => {
    const everything: ApplicationAcceptInput = {
      status: 'closed',
      eventCancelled: true,
      shiftEndsAt: new Date(NOW.getTime() - 1),
      confirmed: 9,
      headcount: 3,
      gate: 'blocked',
    };
    expect(acceptApplication(everything, NOW)).toEqual({ ok: false, reason: 'event_cancelled' });
    const a = { ...everything, eventCancelled: false };
    expect(acceptApplication(a, NOW)).toEqual({ ok: false, reason: 'not_applied' });
    const b = { ...a, status: 'applied' as const };
    expect(acceptApplication(b, NOW)).toEqual({ ok: false, reason: 'event_ended' });
    const c = { ...b, shiftEndsAt: base.shiftEndsAt };
    expect(acceptApplication(c, NOW)).toEqual({ ok: false, reason: 'full' });
    const d = { ...c, confirmed: 0 };
    expect(acceptApplication(d, NOW)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('names every hard gate, and treats a worker with no candidate row as not bookable', () => {
    for (const gate of [
      'wrong_role',
      'do_not_return',
      'blocked',
      'self_cancelled',
      'booked_elsewhere',
      'rtw_expired',
      'hours_limit',
    ]) {
      expect(acceptApplication({ ...base, gate }, NOW)).toEqual({ ok: false, reason: gate });
    }
    expect(acceptApplication({ ...base, gate: undefined }, NOW)).toEqual({
      ok: false,
      reason: 'not_bookable',
    });
  });

  it('no seat is left at headcount — the Radar threshold, not headcount + buffer', () => {
    expect(noSeatLeft(2, 3)).toBe(false);
    expect(noSeatLeft(3, 3)).toBe(true);
    expect(noSeatLeft(4, 3)).toBe(true);
  });

  it('closes a not-taken application with a `closed` cause (N10c), so the worker can apply again', () => {
    expect(cancelCauseStatus(APPLICATION_NOT_TAKEN_CAUSE)).toBe('closed');
    expect(canTransitionBooking('closed', 'applied')).toBe(true);
  });
});

describe('office copy', () => {
  it('has a sentence for every refusal, and never tells an expired right to work it is hours', () => {
    for (const reason of APPLICATION_ACCEPT_REFUSALS) {
      expect(acceptApplicationRefusal(reason)).toBe(ACCEPT_APPLICATION_REFUSAL_COPY[reason]);
    }
    expect(acceptApplicationRefusal('rtw_expired')).toMatch(/right-to-work/);
    expect(acceptApplicationRefusal('rtw_expired')).not.toMatch(/hours limit/);
    expect(acceptApplicationRefusal('something_new')).toContain('something_new');
  });

  it('cancel event: a reason is required, and a second press says so', () => {
    expect(cancelEventRefusal('reason_required')).toBe(CANCEL_EVENT_REFUSAL_COPY.reason_required);
    expect(cancelEventRefusal('already_cancelled')).toBe(
      CANCEL_EVENT_REFUSAL_COPY.already_cancelled,
    );
  });
});

describe('appliedAgo', () => {
  const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
  it('reads like the wireframe', () => {
    expect(appliedAgo(at(0), NOW)).toBe('Applied just now');
    expect(appliedAgo(at(40), NOW)).toBe('Applied 40 min ago');
    expect(appliedAgo(at(120), NOW)).toBe('Applied 2h ago');
    expect(appliedAgo(at(7 * 60 + 59), NOW)).toBe('Applied 7h ago');
    expect(appliedAgo(at(3 * 24 * 60), NOW)).toBe('Applied 3d ago');
  });
});
