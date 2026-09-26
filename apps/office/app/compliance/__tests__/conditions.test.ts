import { describe, expect, it } from 'vitest';
import {
  conditionFieldFor,
  formatNi,
  initialBelowDegree,
  initialVisaLimit,
  niEvidenceLine,
  visaLimitProblem,
  visaLimitValue,
  weeklyHourLimitFrom,
} from '../conditions';
import { canAttachReport, canUploadCompletionLetter } from '../conditions';
import {
  actionsFor,
  documentLine,
  foundLine,
  queueByRecord,
  uploadedLine,
  verifyHint,
  verifyStep,
} from '../queue';
import type { QueueRow } from '../types';

describe('which reviewer field goes with a Verify (D32, D36)', () => {
  it('asks a student’s right to work and term letter for the course level', () => {
    for (const doc of ['visa_document', 'status_document', 'share_code_report']) {
      expect(conditionFieldFor(doc, 'international_student')).toBe('below_degree');
    }
    expect(conditionFieldFor('university_term_dates_letter', 'international_student')).toBe(
      'below_degree',
    );
    expect(conditionFieldFor('passport', 'international_student')).toBeNull();
  });

  it('asks a work or dependant visa’s right to work for its hours limit', () => {
    expect(conditionFieldFor('visa_document', 'work_visa')).toBe('visa_limit');
    expect(conditionFieldFor('share_code_report', 'dependant_other')).toBe('visa_limit');
    expect(conditionFieldFor('university_term_dates_letter', 'work_visa')).toBeNull();
  });

  it('asks nothing of a UK or settled worker', () => {
    expect(conditionFieldFor('share_code_report', 'eu_settled')).toBeNull();
    expect(conditionFieldFor('passport', 'uk_irish')).toBeNull();
    expect(conditionFieldFor('visa_document', null)).toBeNull();
  });
});

describe('what the fields open with', () => {
  it('pre-ticks below degree level when the gov.uk check read a 10-hour limit', () => {
    expect(initialBelowDegree(false, 10)).toBe(true);
    expect(initialBelowDegree(false, 20)).toBe(false);
    expect(initialBelowDegree(true, null)).toBe(true);
  });

  it('pre-fills the visa limit from the file, then the check, then its conditions', () => {
    expect(initialVisaLimit(16, 20, [])).toBe('16');
    expect(initialVisaLimit(null, 20, [])).toBe('20');
    expect(initialVisaLimit(null, null, ['You can work up to 20 hours a week.'])).toBe('20');
    expect(initialVisaLimit(null, null, ['No limit on the hours you can work.'])).toBe('');
  });

  it('reads a weekly limit out of the conditions gov.uk listed, and nothing else', () => {
    expect(weeklyHourLimitFrom(['Maximum of 10 hours per week in term time'])).toBe(10);
    expect(weeklyHourLimitFrom(['Can work 90 hours a week'])).toBeNull();
    expect(weeklyHourLimitFrom(null)).toBeNull();
  });
});

describe('the visa limit as typed', () => {
  it('takes empty as no limit and 1–48 as a limit', () => {
    expect(visaLimitProblem('')).toBeNull();
    expect(visaLimitValue(' ')).toBeNull();
    expect(visaLimitProblem('20')).toBeNull();
    expect(visaLimitValue('20')).toBe(20);
  });

  it('refuses anything else, in words', () => {
    expect(visaLimitProblem('0')).toMatch(/between 1 and 48/);
    expect(visaLimitProblem('49')).toMatch(/between 1 and 48/);
    expect(visaLimitProblem('twenty')).toMatch(/whole number/);
    expect(visaLimitProblem('2.5')).toMatch(/whole number/);
  });
});

describe('the NI number beside its evidence (D43)', () => {
  it('prints it in full, spaced as HMRC prints it', () => {
    expect(formatNi('qq123456c')).toBe('QQ 12 34 56 C');
    expect(niEvidenceLine('QQ123456C')).toBe(
      'NI number on the profile: QQ 12 34 56 C — check it matches the document',
    );
  });

  it('says so when it is not entered yet, and what happens then', () => {
    expect(niEvidenceLine(null)).toMatch(/No NI number entered yet/);
    expect(niEvidenceLine(null)).toMatch(/comes back to Needs review/);
  });
});

const row = (over: Partial<QueueRow>): QueueRow =>
  ({
    kind: 'document',
    item_id: 'd1',
    staff_id: 's1',
    display_name: 'Hana K.',
    employee_id: 873,
    status: 'compliant',
    is_candidate: false,
    block_kind: null,
    block_reason: null,
    rtw_branch: 'uk_irish',
    photo_path: null,
    item_type: 'ni_evidence',
    item_label: 'NI evidence',
    submitted_at: '2026-09-20T10:00:00Z',
    file_path: 's1/ni.pdf',
    ai_confidence: null,
    needs_manual_review: false,
    expiry_date: null,
    term_dates: null,
    doc_right_to_work_until: null,
    share_code: null,
    awarding_institution: null,
    is_reupload: false,
    previous_rejection: null,
    declaration_source: null,
    declaration_details: null,
    conviction_date: null,
    staff_right_to_work_until: null,
    evidence_form: null,
    completion_date_claimed: null,
    mime_type: null,
    size_bytes: null,
    review_reason: null,
    ...over,
  }) as QueueRow;

describe('Needs review: NI evidence and the NI check row (D43)', () => {
  it('puts the full NI number on the NI evidence row', () => {
    expect(documentLine(row({ ni_number: 'QQ123456C' }))).toContain('QQ 12 34 56 C');
    expect(documentLine(row({ ni_number: null }))).toContain('No NI number entered yet');
  });

  it('asks the office to compare on an ni_check row, with Matches / Does not match', () => {
    const check = row({
      kind: 'ni_check',
      ni_number: 'AB123456C',
      review_reason: 'NI number entered after the NI evidence was verified — compare them',
    });
    expect(foundLine(check)).toEqual({
      text: 'NI number on the profile: AB 12 34 56 C',
      confidence: 'manual',
    });
    expect(actionsFor(check)).toEqual({ verify: 'Matches', reject: true });
    expect(verifyHint(check)).toMatch(/re-upload/);
    expect(uploadedLine(check, new Date('2026-09-20T12:00:00Z'))).toBe(
      'verified before the NI number · today',
    );
  });
});

describe('what Verify opens, on /compliance and the profile alike', () => {
  it('asks for the course level beside a student’s term letter, and the NI number beside NI evidence', () => {
    expect(
      verifyStep(
        row({ item_type: 'university_term_dates_letter', rtw_branch: 'international_student' }),
      ),
    ).toBe('confirm');
    expect(verifyStep(row({ item_type: 'ni_evidence' }))).toBe('confirm');
    expect(verifyStep(row({ item_type: 'passport' }))).toBe('verify');
  });

  it('keeps the date step for right-to-work documents — the condition rides along in it', () => {
    expect(verifyStep(row({ item_type: 'visa_document', rtw_branch: 'work_visa' }))).toBe(
      'confirm_date',
    );
  });

  it('records a match on the NI check with the click, and keys it on the evidence', () => {
    const check = row({ kind: 'ni_check', item_id: 'ni-doc' });
    expect(verifyStep(check)).toBe('ni_match');
    expect(queueByRecord([check]).get('ni-doc')).toBe(check);
  });
});

describe('the office’s own evidence on the profile (D47, D31)', () => {
  const student = { status: 'compliant', rtw_branch: 'international_student' };

  it('offers the completion-letter upload to a live student with none pending (D47)', () => {
    expect(canUploadCompletionLetter(student, [])).toBe(true);
    expect(
      canUploadCompletionLetter(student, [
        { doc_type: 'university_completion_letter', review_status: 'pending' },
      ]),
    ).toBe(false);
    expect(canUploadCompletionLetter({ ...student, rtw_branch: 'work_visa' }, [])).toBe(false);
    expect(canUploadCompletionLetter({ ...student, status: 'inactive' }, [])).toBe(false);
    expect(canUploadCompletionLetter({ ...student, status: 'documents' }, [])).toBe(true);
  });

  it('offers "Attach gov.uk report" on a share code with none on file, the check off (D31)', () => {
    const share = { doc_type: 'share_code_report', review_status: 'verified' };
    expect(canAttachReport({ ...share, gov_report_path: null }, null, false)).toBe(true);
    expect(canAttachReport({ ...share, gov_report_path: 'p.pdf' }, null, false)).toBe(false);
    expect(canAttachReport({ doc_type: 'passport', review_status: 'verified' }, null, false)).toBe(
      false,
    );
    expect(canAttachReport({ ...share, review_status: 'superseded' }, null, false)).toBe(false);
  });

  it('leaves the report to the automated check while it owns the share code', () => {
    const share = { doc_type: 'share_code_report', review_status: 'pending' };
    const check = { report_path: null, status: 'queued', stuck: false };
    expect(canAttachReport(share, null, true)).toBe(false);
    expect(canAttachReport(share, check, true)).toBe(false);
    expect(canAttachReport(share, { ...check, status: 'passed' }, true)).toBe(false);
    expect(
      canAttachReport(share, { ...check, report_path: 'auto.pdf', status: 'needs_review' }, true),
    ).toBe(false);
    expect(canAttachReport(share, { ...check, status: 'needs_review' }, true)).toBe(true);
    expect(canAttachReport(share, { ...check, stuck: true }, true)).toBe(true);
  });
});
