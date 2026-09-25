import { describe, expect, it } from 'vitest';
import {
  RTW_DATE_MISSING,
  actionsFor,
  ageLabel,
  daysLabel,
  documentLine,
  filterQueue,
  filterRadar,
  foundLine,
  radarCounts,
  radarStatus,
  remindersLine,
  ukDate,
  ukStamp,
  uploadedLine,
  verifyHint,
  whoLine,
} from '../queue';
import { reviewErrorMessage } from '../messages';
import type { QueueRow, RadarRow } from '../types';

const ROW: QueueRow = {
  kind: 'document',
  item_id: 'i1',
  staff_id: 's1',
  display_name: 'Hana Kowalska',
  employee_id: null,
  status: 'documents',
  is_candidate: true,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'international_student',
  photo_path: null,
  item_type: 'university_term_dates_letter',
  item_label: 'University Term Dates Letter',
  submitted_at: '2026-09-15T20:07:00Z',
  file_path: 'x',
  ai_confidence: 0.94,
  needs_manual_review: false,
  expiry_date: null,
  term_dates: ['[2026-12-13,2027-01-11)', '[2027-04-01,2027-04-20)', '[2027-06-14,2027-09-20)'],
  doc_right_to_work_until: null,
  share_code: null,
  awarding_institution: 'Queen Mary University of London',
  is_reupload: false,
  previous_rejection: null,
  declaration_source: null,
  declaration_details: null,
  conviction_date: null,
  staff_right_to_work_until: '2028-03-31',
  evidence_form: null,
  completion_date_claimed: null,
  mime_type: 'application/pdf',
  size_bytes: 1_258_291,
  review_reason: null,
};

/** A share code verified before 23.09 with no date (20260927160000). */
const RTW_DATE: QueueRow = {
  ...ROW,
  kind: 'rtw_date',
  item_id: 'r1',
  status: 'compliant',
  is_candidate: false,
  rtw_branch: 'work_visa',
  item_type: 'share_code_report',
  item_label: 'Right to work · share code',
  submitted_at: '2026-08-20T09:30:00Z',
  ai_confidence: null,
  needs_manual_review: true,
  term_dates: null,
  share_code: 'W52400001',
  awarding_institution: null,
  staff_right_to_work_until: null,
  mime_type: null,
  size_bytes: null,
  review_reason: RTW_DATE_MISSING,
};

describe('Needs review (§4.1)', () => {
  it('lists oldest first — the one that has waited longest is next', () => {
    const rows = [
      { ...ROW, item_id: 'b', submitted_at: '2026-09-17T10:00:00Z' },
      { ...ROW, item_id: 'a', submitted_at: '2026-09-13T10:00:00Z' },
    ];
    expect(
      filterQueue(rows, { query: '', who: 'all', document: 'any' }).map((r) => r.item_id),
    ).toEqual(['a', 'b']);
  });

  it('filters candidates from staff, and by document', () => {
    const rows = [
      ROW,
      {
        ...ROW,
        item_id: 'w',
        is_candidate: false,
        status: 'compliant' as const,
        item_type: 'passport',
      },
      { ...ROW, item_id: 'd', kind: 'declaration' as const, item_type: 'criminal_declaration' },
    ];
    const ids = (who: 'all' | 'candidates' | 'staff', document: string) =>
      filterQueue(rows, { query: '', who, document })
        .map((r) => r.item_id)
        .sort();
    expect(ids('staff', 'any')).toEqual(['w']);
    expect(ids('candidates', 'any')).toEqual(['d', 'i1']);
    expect(ids('all', 'id')).toEqual(['w']);
    expect(ids('all', 'declaration')).toEqual(['d']);
    expect(filterQueue(rows, { query: 'kowal', who: 'all', document: 'any' })).toHaveLength(3);
  });

  it('leads a blocked worker with the reason, which is what decides whether this upload can lift it', () => {
    expect(
      whoLine({
        ...ROW,
        is_candidate: false,
        status: 'blocked',
        block_reason: 'Document expired: Passport',
      }),
    ).toEqual({ text: 'Staff', blocked: 'Blocked — Document expired: Passport' });
    expect(whoLine(ROW).text).toBe('Candidate · Documents · International student');
  });

  it("describes the file and the AI's finding", () => {
    expect(documentLine(ROW)).toBe('Queen Mary University of London · PDF 1.2 MB');
    expect(foundLine(ROW)).toEqual({ text: '3 holiday ranges', confidence: 'hi' });
    expect(foundLine({ ...ROW, ai_confidence: 0.41, needs_manual_review: true }).confidence).toBe(
      'manual',
    );
  });

  it('shows the reviewer the completion date the worker entered, to confirm', () => {
    const letter: QueueRow = {
      ...ROW,
      item_type: 'university_completion_letter',
      item_label: 'Official University Completion Letter',
      evidence_form: 'university_email',
      completion_date_claimed: '2026-07-10',
      awarding_institution: null,
      mime_type: 'image/png',
      size_bytes: 90_000,
    };
    expect(foundLine(letter).text).toBe('Completion date entered by the worker: 10.07.2026');
    expect(documentLine(letter)).toBe(
      'Official university email · optional document, International student branch · PNG 88 KB',
    );
    expect(verifyHint(letter)).toContain('confirm the completion date and visa expiry');
  });

  it('lists a share code verified without a right-to-work date, and says why (20260927160000)', () => {
    expect(documentLine(RTW_DATE)).toBe(
      'Right-to-work date missing — re-verify · share code W52400001',
    );
    expect(foundLine(RTW_DATE)).toEqual({
      text: 'No right-to-work date on file — re-run the gov.uk check',
      confidence: 'manual',
    });
    expect(uploadedLine(RTW_DATE, new Date('2026-09-18T10:00:00Z'))).toBe(
      'verified without a date · 29 days ago',
    );
    expect(uploadedLine(ROW, new Date('2026-09-18T10:00:00Z'))).toBe('3 days ago');
    expect(verifyHint(RTW_DATE)).toContain('no shift after it can be rostered');
    expect(whoLine(RTW_DATE).text).toBe('Staff · Compliant · Work visa');
  });

  it('offers the rtw_date row only the date confirmation — the report is already verified', () => {
    expect(actionsFor(RTW_DATE)).toEqual({ verify: 'Confirm date', reject: false });
    expect(actionsFor(ROW)).toEqual({ verify: 'Verify', reject: true });
    expect(actionsFor({ ...ROW, kind: 'declaration', item_type: 'criminal_declaration' })).toEqual({
      verify: 'Verify',
      reject: true,
    });
  });

  it('counts and filters the rtw_date row like any other item', () => {
    const rows = [ROW, RTW_DATE];
    const all = filterQueue(rows, { query: '', who: 'all', document: 'any' });
    expect(all).toHaveLength(2);
    expect(all[0]!.item_id).toBe('r1'); // oldest first: it has waited since 20 Aug
    expect(
      filterQueue(rows, { query: '', who: 'all', document: 'rtw' }).map((r) => r.item_id),
    ).toEqual(['r1']);
    expect(
      filterQueue(rows, { query: '', who: 'staff', document: 'any' }).map((r) => r.item_id),
    ).toEqual(['r1']);
  });

  it('marks a re-upload with the reason the last one was rejected', () => {
    expect(
      documentLine({ ...ROW, is_reupload: true, previous_rejection: 'photo page cut off' }),
    ).toContain('previously rejected ("photo page cut off")');
  });

  it('spells out what Verify does for a blocked worker and for a §10.7 declaration', () => {
    expect(verifyHint({ ...ROW, status: 'blocked', item_type: 'passport' })).toContain(
      'unblocks only if everything else is valid',
    );
    expect(
      verifyHint({
        ...ROW,
        kind: 'declaration',
        item_type: 'criminal_declaration',
        declaration_source: 'in_employment',
      }),
    ).toContain('N15');
  });
});

const RADAR: RadarRow = {
  staff_id: 's1',
  display_name: 'Tom Radar',
  employee_id: 1,
  rtw_branch: 'uk_irish',
  status: 'compliant',
  block_kind: null,
  photo_path: null,
  doc_id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
  expires_on: '2026-09-25',
  days_left: 7,
  state: 'expiring',
  n1_at: '2026-08-25T04:00:00Z',
  n2_at: '2026-09-11T04:00:00Z',
  n3_at: null,
  n4_at: null,
  replacement_in_review: false,
};

describe('Radar (§4.1, §4.2)', () => {
  it('counts expired, expiring and term letters', () => {
    expect(
      radarCounts([
        RADAR,
        { ...RADAR, doc_id: 'x', state: 'expired', days_left: -3 },
        {
          ...RADAR,
          doc_id: 't',
          doc_type: 'university_term_dates_letter',
          state: 'valid',
          days_left: 99,
        },
      ]),
    ).toEqual({ expired: 1, expiring: 1, termLetters: 1 });
  });

  it('lists the soonest first, the expired leading', () => {
    const rows = [RADAR, { ...RADAR, doc_id: 'x', state: 'expired' as const, days_left: -16 }];
    expect(filterRadar(rows, 'all', '', 'any').map((r) => r.doc_id)).toEqual(['x', 'd1']);
    expect(filterRadar(rows, 'expired', '', 'any').map((r) => r.doc_id)).toEqual(['x']);
  });

  it('shows the rungs the ladder actually queued, never inferred ones', () => {
    expect(remindersLine(RADAR)).toBe('N1 25 Aug · N2 11 Sep');
    expect(
      remindersLine({
        ...RADAR,
        n1_at: null,
        n2_at: null,
        state: 'valid',
        expires_on: '2026-10-30',
      }),
    ).toBe('first reminder 30.09.2026');
  });

  it('writes the days and the status the way the wireframe does', () => {
    expect(daysLabel(-16)).toBe('−16 d');
    expect(daysLabel(0)).toBe('0 d');
    expect(radarStatus({ ...RADAR, state: 'expired', days_left: 0 }).label).toBe(
      'Expires today · blocked 05:00',
    );
    expect(radarStatus({ ...RADAR, state: 'expired', days_left: -7 }).label).toBe(
      'Expired · blocked',
    );
  });
});

describe('UK formatting (§1.8)', () => {
  it('stamps the upload in UK time', () => {
    expect(ukStamp('2026-09-15T20:07:00Z')).toBe('15 Sep 21:07');
    expect(ukDate('2026-12-31')).toBe('31.12.2026');
  });

  it('counts the age in UK calendar days', () => {
    const now = new Date('2026-09-18T10:00:00Z');
    expect(ageLabel('2026-09-18T06:00:00Z', now)).toBe('today');
    expect(ageLabel('2026-09-17T12:00:00Z', now)).toBe('yesterday');
    expect(ageLabel('2026-09-13T14:02:00Z', now)).toBe('5 days ago');
  });
});

describe('what a refusal means to the manager', () => {
  it("translates the database's tokens", () => {
    expect(reviewErrorMessage('already_expired: 2026-09-01')).toContain(
      'already expired (01.09.2026)',
    );
    expect(reviewErrorMessage('not_pending: verified')).toBe('This has already been verified.');
    expect(reviewErrorMessage('completion_letter_needs_approval')).toContain('visa expiry');
    expect(reviewErrorMessage('not_a_share_code: visa_document')).toContain(
      'Only a share code report',
    );
    expect(reviewErrorMessage('not_verified: pending')).toContain('not been verified yet');
    expect(reviewErrorMessage('superseded_by_newer')).toContain('newer share code report');
    expect(reviewErrorMessage('something new')).toBe('something new');
  });
});
