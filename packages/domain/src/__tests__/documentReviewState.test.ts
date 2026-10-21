import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_REVIEW_STATUSES,
  IllegalTransitionError,
  assertDocumentReviewTransition,
  canTransitionDocumentReview,
  withdrawnCompletionStatus,
} from '../state';

/**
 * The review state of a document (ADR-0183). The same edges as
 * document_review_transition_allowed() in 20261022150100 — pgTAP 918 asks
 * the database the cases below.
 */
describe('document review state machine', () => {
  it('a pending document is verified, rejected or superseded', () => {
    for (const to of ['verified', 'rejected', 'superseded'] as const) {
      expect(canTransitionDocumentReview('passport', 'pending', to)).toBe(true);
    }
  });

  it('a verified document leaves only for superseded — rejected is the NI check’s alone', () => {
    expect(
      canTransitionDocumentReview('university_completion_letter', 'verified', 'superseded'),
    ).toBe(true);
    expect(
      canTransitionDocumentReview('university_completion_letter', 'verified', 'rejected'),
    ).toBe(false);
    expect(canTransitionDocumentReview('ni_evidence', 'verified', 'rejected')).toBe(true);
    expect(canTransitionDocumentReview('passport', 'verified', 'pending')).toBe(false);
  });

  it('nothing goes back to pending, and superseded is terminal', () => {
    for (const from of DOCUMENT_REVIEW_STATUSES) {
      if (from !== 'pending') {
        expect(canTransitionDocumentReview('passport', from, 'pending')).toBe(false);
      }
      if (from !== 'superseded') {
        expect(canTransitionDocumentReview('passport', 'superseded', from)).toBe(false);
      }
    }
    expect(() => assertDocumentReviewTransition('passport', 'rejected', 'verified')).toThrow(
      IllegalTransitionError,
    );
  });

  it('withdrawing a completion letter’s approval supersedes it, from verified only', () => {
    expect(withdrawnCompletionStatus('verified')).toBe('superseded');
    expect(() => withdrawnCompletionStatus('pending')).toThrow(IllegalTransitionError);
    expect(() => withdrawnCompletionStatus('superseded')).toThrow(IllegalTransitionError);
  });
});
