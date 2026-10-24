import { describe, expect, it } from 'vitest';
import { currentStep, stepAccess, wizardPhase } from '@thc/domain';
import {
  allUploaded,
  docIcon,
  docLabel,
  mapOnboardingState,
  requirementRows,
  termLetterOnFile,
  shareCodeDoc,
  wizardFacts,
} from '../state';

/**
 * The JSON `onboarding_state()` returns (20260923120000), as the wizard
 * reads it. The shape here is the one 390/393 assert in the database.
 */
const raw = {
  staffId: 's1',
  firstName: 'Amara',
  lastName: 'Kalu',
  status: 'documents',
  employeeId: null,
  dob: '2003-11-22',
  rtwBranch: 'international_student',
  shareCode: 'W123AB4CD',
  wtrOptOut: false,
  homeAddress: 'Flat 4, 22 Roman Road, London E2 0RY',
  homeLat: 51.529,
  homeLng: -0.045,
  photoPath: 's1/selfie-1.jpg',
  niMasked: null,
  quizAttempts: 0,
  contractSignedAt: null,
  contractVersion: null,
  contractStamp: null,
  progress: {
    ukDocChoice: null,
    visaType: null,
    rtwAt: '2026-09-18T10:12:00Z',
    addressAt: '2026-09-18T10:16:00Z',
    selfieAt: '2026-09-18T10:17:00Z',
    documentsAt: null,
    inductionAt: null,
    hmrcAt: null,
    referencesAt: null,
    bankAt: null,
    contractAt: null,
    tutorialAt: null,
  },
  documents: [
    {
      id: 'd1',
      docType: 'passport',
      status: 'pending',
      fileName: 'passport_amara.jpg',
      fileSize: 2202009,
      uploadedAt: '2026-09-18T10:19:00Z',
      expiryDate: null,
      rightToWorkUntil: null,
      rejectionReason: null,
      reviewedAt: null,
      termDates: null,
      shareCode: null,
    },
  ],
  declaration: null,
  quiz: [],
  hmrc: null,
  references: [],
  bank: null,
  contract: {
    version: 'placeholder-2026-09',
    title: 'Casual worker agreement',
    body: '1. Status. Zero hours.',
    isPlaceholder: true,
  },
};

describe('onboarding_state() → the wizard', () => {
  const s = mapOnboardingState(raw)!;

  it('maps the fields', () => {
    expect(s.firstName).toBe('Amara');
    expect(s.rtwBranch).toBe('international_student');
    expect(s.progress.selfieAt).toBe('2026-09-18T10:17:00Z');
    expect(s.documents[0]!.fileSize).toBe(2202009);
    expect(s.contract?.isPlaceholder).toBe(true);
  });

  it('has no field that could carry the HMRC letter or a block reason (§2.8, §10.1)', () => {
    expect(JSON.stringify(s)).not.toMatch(/statement|blockReason/);
  });

  it('is null for no row', () => {
    expect(mapOnboardingState(null)).toBeNull();
  });

  it('puts the wizard on step 4 with the term letter missing (the wireframe state)', () => {
    const facts = wizardFacts(s);
    expect(wizardPhase(facts)).toBe('in_progress');
    expect(currentStep(facts)).toBe(4);
    const rows = requirementRows(s);
    expect(rows.map((r) => [r.requirement.key, r.doc?.fileName ?? null])).toEqual([
      ['passport', 'passport_amara.jpg'],
      ['university_term_dates_letter', null],
    ]);
    expect(allUploaded(rows)).toBe(false);
  });

  it('pauses once step 4 is submitted, until the office verifies everything (§2.9)', () => {
    const submitted = mapOnboardingState({
      ...raw,
      progress: { ...raw.progress, documentsAt: '2026-09-18T10:24:00Z' },
      documents: [
        ...raw.documents,
        {
          ...raw.documents[0],
          id: 'd2',
          docType: 'share_code_report',
          fileName: null,
          shareCode: 'W123AB4CD',
        },
      ],
    })!;
    const facts = wizardFacts(submitted);
    expect(wizardPhase(facts)).toBe('awaiting_review');
    expect(stepAccess(5, facts)).toBe('locked');
    expect(shareCodeDoc(submitted)?.shareCode).toBe('W123AB4CD');
  });

  it('a rejected document is not "uploaded" — it needs a new file (§2.3)', () => {
    const rejected = mapOnboardingState({
      ...raw,
      documents: [
        { ...raw.documents[0], status: 'rejected', rejectionReason: 'Blurred' },
        { ...raw.documents[0], id: 'd3', docType: 'university_term_dates_letter' },
      ],
    })!;
    expect(allUploaded(requirementRows(rejected))).toBe(false);
  });

  describe('a graduate needs no Term Dates Letter (ADR-0112)', () => {
    const completion = (status: string, id = 'c1', uploadedAt = '2026-09-19T10:00:00Z') => ({
      ...raw.documents[0],
      id,
      docType: 'university_completion_letter',
      status,
      fileName: 'completion.pdf',
      uploadedAt,
    });
    const termLetter = (status: string, uploadedAt = '2026-09-18T11:00:00Z') => ({
      ...raw.documents[0],
      id: 'd3',
      docType: 'university_term_dates_letter',
      status,
      uploadedAt,
    });
    const rowsFor = (documents: unknown[]) =>
      requirementRows(mapOnboardingState({ ...raw, documents } as typeof raw)!);

    it('a Completion Letter that is not rejected answers the Term Dates Letter row', () => {
      for (const status of ['pending', 'verified']) {
        const rows = rowsFor([raw.documents[0], completion(status)]);
        const term = rows.find((r) => r.requirement.key === 'university_term_dates_letter')!;
        expect(term.viaCompletionLetter).toBe(true);
        expect(term.doc?.docType).toBe('university_completion_letter');
        expect(allUploaded(rows)).toBe(true);
      }
    });

    it('a rejected Completion Letter keeps the graduate on its route, but answers nothing (ADR-0211)', () => {
      const rows = rowsFor([raw.documents[0], completion('rejected')]);
      expect(rows[1]!.viaCompletionLetter).toBe(true);
      expect(rows[1]!.doc?.status).toBe('rejected');
      expect(allUploaded(rows)).toBe(false);
    });

    it('a rejected Completion Letter beside a rejected Term Dates Letter: the term letter row is the term letter', () => {
      const rows = rowsFor([raw.documents[0], termLetter('rejected'), completion('rejected')]);
      expect(rows[1]!.viaCompletionLetter).toBeUndefined();
      expect(rows[1]!.doc?.docType).toBe('university_term_dates_letter');
      expect(allUploaded(rows)).toBe(false);
    });

    it('a rejected Term Dates Letter beside an approved Completion Letter is the live case: the letter stands in', () => {
      const rows = rowsFor([raw.documents[0], termLetter('rejected'), completion('verified')]);
      expect(rows[1]!.viaCompletionLetter).toBe(true);
      expect(allUploaded(rows)).toBe(true);
    });

    it('a Term Dates Letter that is not rejected still wins — it is the literal requirement', () => {
      const rows = rowsFor([raw.documents[0], termLetter('pending'), completion('pending')]);
      expect(rows[1]!.viaCompletionLetter).toBeUndefined();
      expect(rows[1]!.doc?.docType).toBe('university_term_dates_letter');
    });

    it('ADR-0215: knows when a Completion Letter would replace a Term Dates Letter on file', () => {
      expect(termLetterOnFile(rowsFor([raw.documents[0], termLetter('pending')]))).toBe(true);
      expect(termLetterOnFile(rowsFor([raw.documents[0], termLetter('rejected')]))).toBe(false);
      expect(termLetterOnFile(rowsFor([raw.documents[0], completion('pending')]))).toBe(false);
      expect(termLetterOnFile(rowsFor([raw.documents[0]]))).toBe(false);
    });

    it('no other branch is touched', () => {
      const rows = requirementRows(
        mapOnboardingState({
          ...raw,
          rtwBranch: 'work_visa',
          documents: [raw.documents[0], completion('verified')],
        } as typeof raw)!,
      );
      expect(rows.map((r) => r.requirement.key)).toEqual(['passport']);
    });
  });

  it('labels and badges rows as the wireframes do', () => {
    expect(docIcon(s.documents[0]!)).toBe('JPG');
    expect(docIcon(null)).toBe('—');
    expect(docLabel('university_term_dates_letter')).toBe('University Term Dates Letter');
    expect(docLabel('share_code_report')).toBe('Right to work · share code');
  });
});
