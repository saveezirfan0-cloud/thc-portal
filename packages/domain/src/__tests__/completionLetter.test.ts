import { describe, expect, it } from 'vitest';
import { canRoster, weeklyCap } from '../cap';
import type { CapInput } from '../cap';
import { rotaGuardVerdict } from '../rotaGuard';
import {
  COMPLETION_EVIDENCE_FORMS,
  COMPLETION_UPLOAD_REASONS,
  EVIDENCE_MAX_BYTES,
  canSignOptOut,
  completionEffectiveFrom,
  evidenceFileProblem,
  evidenceObjectPath,
  optOutCancelledFrom,
  releaseBlockedByVisa,
  rtwAlertTier,
} from '../completionLetter';

/**
 * The seven acceptance criteria of
 * docs/scope/university-completion-letter-requirement.pdf §6, at the level of
 * the rule. Each is proved again against the real database — the upload RPC,
 * the approval, the booking trigger — in supabase/tests/361_completion_letter.sql,
 * where the same numbers are named the same way.
 */

// Monday 21 Sep 2026 … Sunday 27 Sep. The course completes on Wednesday
// 7 October, so the week of 5 October straddles it and 12 October is the
// first whole week after.
const TERM_STUDENT: CapInput = {
  visaLimited: true,
  termState: 'term',
  completionLetterVerified: false,
  optOut48h: false,
};

describe('acceptance criteria (requirement §6), at the rule', () => {
  it('AC1 — a Student-visa worker without an approved completion letter cannot be rostered for more than 20 hours in any term week', () => {
    for (const weekStart of ['2026-09-21', '2026-10-05', '2027-03-01']) {
      const cap = weeklyCap({ ...TERM_STUDENT, weekStart });
      expect(cap.capHours).toBe(20);
      // …and the rota guard turns the 21st hour into a refusal, in either mode.
      for (const mode of ['block', 'warn'] as const) {
        expect(
          rotaGuardVerdict({
            canRoster: true,
            capHours: cap.capHours,
            band: cap.band,
            bookedHours: 16,
            shiftHours: 5,
            mode,
          }).verdict,
        ).toBe('block');
      }
    }
    // Even with a signed opt-out: that is Working Time, the 20 is immigration.
    expect(weeklyCap({ ...TERM_STUDENT, optOut48h: true, weekStart: '2026-09-21' }).capHours).toBe(
      20,
    );
  });

  it('AC2 — uploading a completion letter alone does not change the cap; approval does', () => {
    // An upload is a claimed date with no verification behind it.
    const uploaded = weeklyCap({
      ...TERM_STUDENT,
      weekStart: '2026-10-12',
      completionDate: '2026-10-07',
    });
    expect(uploaded).toEqual({ capHours: 20, band: 'student_term_20' });
    const approved = weeklyCap({
      ...TERM_STUDENT,
      completionLetterVerified: true,
      weekStart: '2026-10-12',
      completionDate: '2026-10-07',
    });
    expect(approved).toEqual({ capHours: 48, band: 'graduated_48' });
  });

  it('AC3 — on approval the cap becomes 48 hours/week from the completion date, never before it', () => {
    const at = (weekStart: string) =>
      weeklyCap({
        ...TERM_STUDENT,
        completionLetterVerified: true,
        completionDate: '2026-10-07',
        weekStart,
      }).capHours;
    expect(at('2026-09-28')).toBe(20);
    expect(at('2026-10-05')).toBe(20); // straddles the completion date: the lower cap
    expect(at('2026-10-12')).toBe(48);
    // The worker is told the first day it counts.
    expect(completionEffectiveFrom('2026-10-07', '2026-09-23')).toBe('2026-10-12');
    // A letter approved long after the date lifts from the Monday after the
    // approval — never retroactively, and never part-way through a week
    // (audit D35: approved on Wednesday 23.09, released Monday 28.09).
    expect(completionEffectiveFrom('2026-06-30', '2026-09-23')).toBe('2026-09-28');
    // Approved on a Monday: that week is whole, so it is released at once.
    expect(completionEffectiveFrom('2026-06-30', '2026-09-21')).toBe('2026-09-21');
    // A Monday completion date is its own first full week.
    expect(completionEffectiveFrom('2026-10-12', '2026-09-23')).toBe('2026-10-12');
  });

  it('AC3 — a completion date already in the past releases from the Monday after verification, not mid-week', () => {
    const verifiedOn = '2026-09-24'; // a Thursday
    const graduate = (weekStart: string) =>
      weeklyCap({
        ...TERM_STUDENT,
        completionLetterVerified: true,
        completionDate: '2025-12-19',
        verifiedOn,
        weekStart,
      });
    // The whole week of 21.09 stays at the term cap: one cap for Mon–Sun.
    expect(graduate('2026-09-21')).toEqual({ capHours: 20, band: 'student_term_20' });
    expect(graduate('2026-09-28')).toEqual({ capHours: 48, band: 'graduated_48' });
    // What the worker is told agrees with what the rota does.
    expect(completionEffectiveFrom('2025-12-19', verifiedOn)).toBe('2026-09-28');
  });

  it('AC4 — above 48 hours only with a valid, un-cancelled opt-out, and only for an 18+', () => {
    const graduate: CapInput = {
      ...TERM_STUDENT,
      completionLetterVerified: true,
      completionDate: '2026-07-01',
      weekStart: '2026-09-21',
    };
    expect(weeklyCap(graduate).capHours).toBe(48);
    expect(weeklyCap({ ...graduate, optOut48h: true }).capHours).toBeNull();
    expect(weeklyCap({ ...graduate, optOut48h: true, under18: true }).capHours).toBe(48);
    expect(
      weeklyCap({ ...graduate, optOut48h: true, optOutCancelledFrom: '2026-09-01' }).capHours,
    ).toBe(48);
    // Without the opt-out, 49 hours is refused in the default mode.
    expect(
      rotaGuardVerdict({
        canRoster: true,
        capHours: 48,
        band: 'graduated_48',
        bookedHours: 44,
        shiftHours: 5,
        mode: 'block',
      }),
    ).toEqual({ verdict: 'block', reason: 'wtr_cap' });
    // And the flow is not offered to an under-18 or an unknown age.
    expect(canSignOptOut('2008-09-24', '2026-09-23')).toBe(false);
    expect(canSignOptOut('2008-09-23', '2026-09-23')).toBe(true);
    expect(canSignOptOut(null, '2026-09-23')).toBe(false);
  });

  it('AC5 — cancelling an opt-out re-imposes the 48-hour cap after the notice period', () => {
    const from = optOutCancelledFrom('2026-09-23', 7);
    expect(from).toBe('2026-09-30');
    const at = (weekStart: string) =>
      weeklyCap({
        visaLimited: false,
        termState: 'none',
        completionLetterVerified: false,
        optOut48h: true,
        optOutCancelledFrom: from,
        weekStart,
      }).capHours;
    expect(at('2026-09-21')).toBeNull(); // wholly inside the notice period
    expect(at('2026-09-28')).toBe(48); // straddles the end of notice: the lower cap
    expect(at('2026-10-05')).toBe(48);
    expect(() => optOutCancelledFrom('2026-09-23', 3)).toThrow('invalid_notice_period');
    expect(optOutCancelledFrom('2026-09-23', 92)).toBe('2026-12-24');
  });

  it('AC6 — no worker can be rostered beyond their recorded visa expiry', () => {
    expect(canRoster('2026-11-30', '2026-11-30')).toBe(true);
    expect(canRoster('2026-12-01', '2026-11-30')).toBe(false);
    expect(
      weeklyCap({ ...TERM_STUDENT, weekStart: '2026-12-07', visaExpiry: '2026-11-30' }).capHours,
    ).toBe(0);
    for (const mode of ['block', 'warn'] as const) {
      expect(
        rotaGuardVerdict({
          canRoster: false,
          capHours: null,
          band: 'uncapped',
          bookedHours: 0,
          shiftHours: 1,
          mode,
        }),
      ).toEqual({ verdict: 'block', reason: 'rtw_expired' });
    }
    // §7: a visa ending before the release starts means the release never starts.
    expect(releaseBlockedByVisa('2026-10-12', '2026-10-10')).toBe(true);
    expect(releaseBlockedByVisa('2026-10-12', '2027-01-31')).toBe(false);
  });

  // AC7 (audit and export) is a property of the stored record, not of a rule:
  // see supabase/tests/361_completion_letter.sql and
  // apps/office/app/compliance/__tests__/auditCsv.test.ts.
});

describe('§2.1 the upload contract S4 builds on', () => {
  it('accepts PDF, JPG and PNG up to 10 MB, and nothing else', () => {
    expect(evidenceFileProblem({ name: 'letter.pdf', type: 'application/pdf', size: 1 })).toBe(
      null,
    );
    expect(evidenceFileProblem({ name: 'a.JPG', type: 'image/jpeg', size: 10 })).toBe(null);
    expect(evidenceFileProblem({ name: 'a.jpeg', type: 'image/jpeg', size: 10 })).toBe(null);
    expect(
      evidenceFileProblem({ name: 'a.png', type: 'image/png', size: EVIDENCE_MAX_BYTES }),
    ).toBe(null);
    expect(
      evidenceFileProblem({ name: 'a.png', type: 'image/png', size: EVIDENCE_MAX_BYTES + 1 }),
    ).toBe('file_too_large');
    expect(evidenceFileProblem({ name: 'a.heic', type: 'image/heic', size: 10 })).toBe(
      'unsupported_file_type',
    );
    expect(evidenceFileProblem({ name: 'a.pdf', type: 'image/png', size: 10 })).toBe(
      'unsupported_file_type',
    );
    expect(evidenceFileProblem({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toBe(
      'file_empty',
    );
  });

  it('builds the object path the database checks', () => {
    expect(
      evidenceObjectPath(
        '20000000-0000-4000-8000-000000000001',
        'completion-letter',
        'f1a2',
        'My Letter.PDF',
      ),
    ).toBe('20000000-0000-4000-8000-000000000001/completion-letter/f1a2.pdf');
    expect(() => evidenceObjectPath('s', 'wtr-optout', '../x', 'a.pdf')).toThrow('invalid_path');
    expect(() => evidenceObjectPath('s', 'wtr-optout', 'x', 'a.gif')).toThrow(
      'unsupported_file_type',
    );
  });

  it('names the three acceptable forms and explains every refusal', () => {
    expect(COMPLETION_EVIDENCE_FORMS).toEqual(['letter', 'transcript', 'university_email']);
    for (const reason of [
      'not_student_visa',
      'invalid_form',
      'completion_date_required',
      'file_too_large',
      'unsupported_file_type',
      'already_pending',
    ]) {
      expect(COMPLETION_UPLOAD_REASONS[reason]).toMatch(/\w/);
    }
  });
});

describe('§2.3 right-to-work alerts at 60 / 30 / 14 days', () => {
  it('is a band, so a missed day never skips a rung', () => {
    expect(rtwAlertTier(61)).toBeNull();
    expect(rtwAlertTier(60)).toBe(60);
    expect(rtwAlertTier(31)).toBe(60);
    expect(rtwAlertTier(30)).toBe(30);
    expect(rtwAlertTier(15)).toBe(30);
    expect(rtwAlertTier(14)).toBe(14);
    expect(rtwAlertTier(0)).toBe(14);
    expect(rtwAlertTier(-1)).toBeNull();
  });
});
