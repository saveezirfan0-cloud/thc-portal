import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DECLARATION_REVIEW_STATUSES,
  DECLARATION_REVIEW_TRANSITIONS,
  IllegalTransitionError,
  assertDeclarationReviewTransition,
  canTransitionDeclarationReview,
  isDeclarationReviewStatus,
} from '../state.ts';
import {
  UPDATE_DECLARATION_REASONS,
  canUpdateDeclaration,
  declarationReviewActions,
  updatePausesShifts,
} from '../declaration.ts';
import type { LatestDeclaration } from '../declaration.ts';

/** ADR-0180: a criminal declaration's review, held equal to the database's. */
describe('declaration review transitions (ADR-0180)', () => {
  it('a pending declaration is verified, rejected, or sent back for more details', () => {
    expect(canTransitionDeclarationReview('pending', 'verified')).toBe(true);
    expect(canTransitionDeclarationReview('pending', 'rejected')).toBe(true);
    expect(canTransitionDeclarationReview('pending', 'details_requested')).toBe(true);
  });

  it('a rejection can be reversed to verified, and nothing else', () => {
    expect(DECLARATION_REVIEW_TRANSITIONS.rejected).toEqual(['verified']);
    expect(canTransitionDeclarationReview('rejected', 'pending')).toBe(false);
    expect(canTransitionDeclarationReview('rejected', 'details_requested')).toBe(false);
  });

  it('verified and details_requested are terminal: the answer is a new declaration', () => {
    for (const from of ['verified', 'details_requested'] as const) {
      for (const to of DECLARATION_REVIEW_STATUSES) {
        expect(canTransitionDeclarationReview(from, to)).toBe(from === to);
      }
    }
    expect(() => assertDeclarationReviewTransition('details_requested', 'pending')).toThrow(
      IllegalTransitionError,
    );
    expect(() => assertDeclarationReviewTransition('verified', 'rejected')).toThrow(
      'Illegal declaration_review transition: verified → rejected',
    );
  });

  it('knows its own statuses', () => {
    expect(isDeclarationReviewStatus('details_requested')).toBe(true);
    expect(isDeclarationReviewStatus('superseded')).toBe(false);
  });

  it('lists exactly the pairs declaration_review_transitions() holds', () => {
    const sql = readFileSync(
      new URL(
        '../../../../supabase/migrations/20261022170100_declaration_more_details.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const body = sql.slice(sql.indexOf('function public.declaration_review_transitions()'));
    const values = body.slice(body.indexOf('(values'), body.indexOf(') v(from_status'));
    const pairs = [...values.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}→${m[2]}`);
    const ts = DECLARATION_REVIEW_STATUSES.flatMap((from) =>
      DECLARATION_REVIEW_TRANSITIONS[from].map((to) => `${from}→${to}`),
    );
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.sort()).toEqual(ts.sort());
  });
});

describe('declarationReviewActions (ADR-0180)', () => {
  const yes = (status: LatestDeclaration['status'], superseded = false) => ({
    answer: true,
    status,
    superseded,
  });

  it('offers Verify, Reject and Ask for more details on a pending Yes', () => {
    expect(declarationReviewActions(yes('pending'), 'documents')).toEqual({
      verify: true,
      reject: true,
      askForDetails: true,
      reverse: false,
    });
  });

  it('offers only Reverse rejection on a rejected Yes', () => {
    expect(declarationReviewActions(yes('rejected'), 'blocked')).toEqual({
      verify: false,
      reject: false,
      askForDetails: false,
      reverse: true,
    });
  });

  it('offers nothing on a No, a superseded row, a decided row, or a Rejected / Removed person', () => {
    const none = { verify: false, reject: false, askForDetails: false, reverse: false };
    expect(declarationReviewActions({ ...yes('verified'), answer: false }, 'compliant')).toEqual(
      none,
    );
    expect(declarationReviewActions(yes('pending', true), 'compliant')).toEqual(none);
    expect(declarationReviewActions(yes('superseded'), 'compliant')).toEqual(none);
    expect(declarationReviewActions(yes('details_requested'), 'blocked')).toEqual(none);
    expect(declarationReviewActions(yes('verified'), 'compliant')).toEqual(none);
    expect(declarationReviewActions(yes('pending'), 'rejected')).toEqual(none);
    expect(declarationReviewActions(yes('rejected'), 'removed')).toEqual(none);
  });
});

describe('canUpdateDeclaration (ADR-0180)', () => {
  const latest = (
    status: LatestDeclaration['status'],
    source: LatestDeclaration['source'],
  ): LatestDeclaration => ({ answer: true, source, status, superseded: false });

  it('lets a candidate answer a request for details, or a rejection', () => {
    for (const status of ['details_requested', 'rejected'] as const) {
      expect(
        canUpdateDeclaration({
          status: 'documents',
          blockKind: null,
          latest: latest(status, 'onboarding'),
        }),
      ).toBe(true);
    }
  });

  it('lets a worker paused for the review answer a request for details', () => {
    expect(
      canUpdateDeclaration({
        status: 'blocked',
        blockKind: 'conviction_review',
        latest: latest('details_requested', 'in_employment'),
      }),
    ).toBe(true);
  });

  it('lets staff with a rejected declaration update it, whichever its source', () => {
    for (const source of ['onboarding', 'in_employment'] as const) {
      expect(
        canUpdateDeclaration({
          status: 'compliant',
          blockKind: null,
          latest: latest('rejected', source),
        }),
      ).toBe(true);
      expect(
        canUpdateDeclaration({
          status: 'blocked',
          blockKind: 'auto_document',
          latest: latest('rejected', source),
        }),
      ).toBe(true);
    }
    expect(updatePausesShifts('compliant')).toBe(true);
    expect(updatePausesShifts('blocked')).toBe(false);
    expect(updatePausesShifts('documents')).toBe(false);
  });

  it('never under a manual hold — what a rejection in employment makes', () => {
    expect(
      canUpdateDeclaration({
        status: 'blocked',
        blockKind: 'manual',
        latest: latest('rejected', 'in_employment'),
      }),
    ).toBe(false);
    expect(
      canUpdateDeclaration({
        status: 'blocked',
        blockKind: 'manual',
        latest: latest('details_requested', 'in_employment'),
      }),
    ).toBe(false);
  });

  it('nothing to update while it is pending or verified, or without a Yes', () => {
    for (const status of ['pending', 'verified'] as const) {
      expect(
        canUpdateDeclaration({
          status: 'documents',
          blockKind: null,
          latest: latest(status, 'onboarding'),
        }),
      ).toBe(false);
    }
    expect(canUpdateDeclaration({ status: 'documents', blockKind: null, latest: null })).toBe(
      false,
    );
    expect(
      canUpdateDeclaration({
        status: 'documents',
        blockKind: null,
        latest: { ...latest('rejected', 'onboarding'), answer: false },
      }),
    ).toBe(false);
  });

  it('not past the documents stage of onboarding, nor for a leaver', () => {
    for (const status of ['quiz', 'contract', 'inactive', 'removed', 'rejected'] as const) {
      expect(
        canUpdateDeclaration({ status, blockKind: null, latest: latest('rejected', 'onboarding') }),
      ).toBe(false);
    }
  });

  it('words every refusal update_my_declaration() returns', () => {
    for (const code of [
      'not_eligible',
      'details_required',
      'details_too_long',
      'conviction_date_in_future',
      'unknown_staff',
    ]) {
      expect(UPDATE_DECLARATION_REASONS[code]).toBeTruthy();
    }
  });
});
