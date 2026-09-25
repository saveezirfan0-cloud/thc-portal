import { describe, expect, it } from 'vitest';
import {
  GENDER_OPTIONS,
  ONBOARDING_STEPS,
  RELATIVE_WORDS,
  TOTAL_STEPS,
  acceptedDocTypes,
  addressErrors,
  ageOn,
  formatPostcode,
  isPostcode,
  pinInUk,
  bankErrors,
  canEditStep,
  currentStep,
  formatFileSize,
  isGender,
  looksLikeRelative,
  needsShareCode,
  needsVisaExpiry,
  needsVisaType,
  refereeErrors,
  referencesReady,
  requiredDocuments,
  rtwErrors,
  rtwFooterHint,
  signatureLine,
  signatureStamp,
  stepAccess,
  stepPercent,
  stepsDone,
  uploadError,
  uploadKind,
  wizardPhase,
} from '../onboarding';
import type { RtwBranch, RtwForm, WizardFacts } from '../onboarding';

describe('the eleven steps (§10.3)', () => {
  it('is the scope’s order, ending Contract → How it works', () => {
    expect(ONBOARDING_STEPS.map((s) => s.title)).toEqual([
      'Right to work',
      'Home address',
      'Profile selfie',
      'Documents',
      'Health & Safety induction',
      'Safety quiz',
      'HMRC New Starter Checklist',
      'Two references',
      'Bank & payroll',
      'Contract',
      'How it works',
    ]);
    expect(TOTAL_STEPS).toBe(11);
  });

  it('fills the progress bar as the wireframes draw it', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(stepPercent)).toEqual([
      9, 18, 27, 36, 45, 55, 64, 73, 82, 91, 100,
    ]);
  });
});

describe('document sets per branch (§2.5 pts 1–5, 8)', () => {
  const types = (branch: RtwBranch, choice: 'passport' | 'birth_certificate' | null = null) =>
    requiredDocuments(branch, choice).map((r) => r.accepts.join('|'));

  it('UK / Irish: passport OR birth certificate + NI evidence, no share code', () => {
    expect(types('uk_irish', 'passport')).toEqual(['passport']);
    expect(types('uk_irish', 'birth_certificate')).toEqual(['birth_certificate', 'ni_evidence']);
    expect(needsShareCode('uk_irish')).toBe(false);
  });

  it('EU / EEA: passport or national ID + share code', () => {
    expect(types('eu_settled')).toEqual(['passport|national_id']);
    expect(needsShareCode('eu_settled')).toBe(true);
  });

  it('work visa: passport + visa upload + share code + visa type + expiry', () => {
    expect(types('work_visa')).toEqual(['passport', 'visa_document']);
    expect(needsVisaType('work_visa')).toBe(true);
    expect(needsVisaExpiry('work_visa')).toBe(true);
  });

  it('international student: passport + term dates letter, and NO visa upload', () => {
    expect(types('international_student')).toEqual(['passport', 'university_term_dates_letter']);
    expect(acceptedDocTypes('international_student', null)).not.toContain('visa_document');
    expect(needsVisaExpiry('international_student')).toBe(false);
  });

  it('dependant / other: passport + status document + expiry', () => {
    expect(types('dependant_other')).toEqual(['passport', 'status_document']);
    expect(needsVisaExpiry('dependant_other')).toBe(true);
    expect(needsVisaType('dependant_other')).toBe(false);
  });

  it('no branch collects the completion letter, a share-code file or a P45 at onboarding', () => {
    for (const branch of [
      'uk_irish',
      'eu_settled',
      'work_visa',
      'international_student',
      'dependant_other',
    ] as const) {
      const accepted = acceptedDocTypes(branch, 'birth_certificate');
      expect(accepted).not.toContain('university_completion_letter');
      expect(accepted).not.toContain('share_code_report');
    }
  });
});

describe('step 1 validation', () => {
  const today = '2026-09-23';
  const base: RtwForm = {
    branch: 'eu_settled',
    dob: '1999-09-30',
    gender: 'F',
    shareCode: 'W12 3AB 4CD',
    visaType: '',
    visaExpiry: '',
    ukChoice: null,
    wtrOptOut: false,
  };

  it('a complete EU form has no errors', () => {
    expect(rtwErrors(base, today)).toEqual({});
  });

  it('DOB is mandatory in every branch', () => {
    for (const branch of [
      'uk_irish',
      'eu_settled',
      'work_visa',
      'international_student',
      'dependant_other',
    ] as const) {
      expect(rtwErrors({ ...base, branch, dob: '' }, today).dob).toBe('Date of birth is required.');
    }
  });

  it('gender is a required choice of exactly Male or Female — the report column is M/F (§9.9)', () => {
    expect(GENDER_OPTIONS.map((o) => `${o.value}:${o.label}`)).toEqual(['M:Male', 'F:Female']);
    expect(isGender('M') && isGender('F')).toBe(true);
    expect(isGender('X') || isGender('') || isGender(null)).toBe(false);
    for (const branch of [
      'uk_irish',
      'eu_settled',
      'work_visa',
      'international_student',
      'dependant_other',
    ] as const) {
      expect(rtwErrors({ ...base, branch, gender: null }, today).gender).toBe(
        'Choose Male or Female.',
      );
    }
    // A value the check constraint would refuse is refused here too.
    expect(rtwErrors({ ...base, gender: 'X' as never }, today).gender).toBeDefined();
    expect(rtwFooterHint({ ...base, gender: null }, today)).toBe('Gender is required');
    expect(rtwFooterHint({ ...base, dob: '', gender: null }, today)).toBe(
      'Date of birth and gender are required',
    );
  });

  it('under 18 is refused; an 18th birthday today is fine', () => {
    expect(rtwErrors({ ...base, dob: '2008-09-24' }, today).dob).toMatch(/18 or over/);
    expect(rtwErrors({ ...base, dob: '2008-09-23' }, today).dob).toBeUndefined();
    expect(ageOn('2008-09-23', today)).toBe(18);
  });

  it('the footer repeats a filled date’s own error, never "is required" under a filled field', () => {
    // A candidate who picked a 2010 birthday reads the §2.1 sentence, not "Date of birth is required".
    expect(rtwFooterHint({ ...base, dob: '2010-01-01' }, today)).toBe(
      'You must be 18 or over to work with us.',
    );
    expect(rtwFooterHint({ ...base, dob: '2008-02-30' }, today)).toBe('Enter a real date.');
    // A blank date is still "missing", so the wireframe's word list stays.
    expect(rtwFooterHint({ ...base, dob: '' }, today)).toBe('Date of birth is required');
    // The same holds for a typed expiry that has already passed.
    expect(
      rtwFooterHint(
        { ...base, branch: 'work_visa', visaType: 'Graduate', visaExpiry: '2026-09-23' },
        today,
      ),
    ).toBe('This date has already passed.');
  });

  it('validates the share code before anything is sent', () => {
    expect(rtwErrors({ ...base, shareCode: 'W12 3AB' }, today).shareCode).toMatch(/9 letters/);
    expect(rtwFooterHint({ ...base, shareCode: 'W12 3AB' }, today)).toBe(
      'Fix the share code to continue',
    );
  });

  it('UK / Irish needs no share code, but a document choice', () => {
    expect(
      rtwErrors({ ...base, branch: 'uk_irish', shareCode: '', ukChoice: 'passport' }, today),
    ).toEqual({});
    expect(rtwErrors({ ...base, branch: 'uk_irish', shareCode: '' }, today).ukChoice).toBeDefined();
  });

  it('the dependant footer names every missing field, as the wireframe does', () => {
    expect(
      rtwFooterHint({ ...base, branch: 'dependant_other', dob: '', shareCode: '' }, today),
    ).toBe('Date of birth, share code and expiry are required');
  });

  it('an expiry must be in the future', () => {
    expect(
      rtwErrors(
        { ...base, branch: 'work_visa', visaType: 'Graduate', visaExpiry: '2026-09-23' },
        today,
      ).visaExpiry,
    ).toBe('This date has already passed.');
  });

  it('nothing chosen yet', () => {
    expect(rtwFooterHint({ ...base, branch: null }, today)).toBe('Choose one to continue');
  });
});

describe('home address (§10.3 2/11)', () => {
  it('formats and checks UK postcodes', () => {
    expect(formatPostcode('e20ry')).toBe('E2 0RY');
    expect(isPostcode('SW1A 1AA')).toBe(true);
    expect(isPostcode('NOT A CODE')).toBe(false);
  });
  it('needs a pin, in the UK', () => {
    const a = { line: 'Flat 4, 22 Roman Road', town: 'London', postcode: 'E2 0RY' };
    expect(addressErrors({ ...a, lat: 51.529, lng: -0.045 })).toEqual({});
    expect(addressErrors({ ...a, lat: null, lng: null }).lat).toMatch(/pin/);
    expect(addressErrors({ ...a, lat: 40.7, lng: -74 }).lat).toMatch(/UK/);
    expect(pinInUk(54.6, -5.9)).toBe(true); // Belfast
  });
});

describe('uploads (§2.5 pt 7)', () => {
  it('PDF, JPG, PNG or HEIC', () => {
    expect(uploadKind({ name: 'a.pdf', type: 'application/pdf' })).toBe('pdf');
    expect(uploadKind({ name: 'a.jpeg', type: 'image/jpeg' })).toBe('jpg');
    expect(uploadKind({ name: 'a.png', type: 'image/png' })).toBe('png');
    expect(uploadKind({ name: 'a.HEIC', type: '' })).toBe('heic');
    expect(uploadKind({ name: 'a.docx', type: 'application/vnd.openxmlformats' })).toBeNull();
    expect(uploadKind({ name: 'a.pdf', type: 'text/html' })).toBeNull();
  });

  it('up to 10 MB per file', () => {
    expect(
      uploadError({ name: 'a.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 }),
    ).toBeNull();
    expect(
      uploadError({ name: 'a.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }),
    ).toMatch(/10 MB/);
    expect(uploadError({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/empty/);
  });

  it('prints sizes as the wireframe does', () => {
    expect(formatFileSize(2.1 * 1024 * 1024)).toBe('2.1 MB');
    expect(formatFileSize(340 * 1024)).toBe('340 KB');
  });
});

describe('two references (§2.10)', () => {
  const tutor = {
    name: 'Dr Helen Okafor',
    relationship: 'Personal tutor, UCL',
    phone: '+44 20 7679 2000',
    email: 'h.okafor@ucl.ac.uk',
  };
  const coach = {
    name: 'Sam Whitfield',
    relationship: 'Volunteering supervisor, Crisis at Christmas',
    phone: '07700 900456',
    email: 'sam@crisis.example',
  };

  it('tutors, supervisors and coaches are accepted', () => {
    expect(refereeErrors(tutor)).toEqual({});
    expect(refereeErrors(coach)).toEqual({});
    expect(referencesReady([tutor, coach])).toBe(true);
  });

  it('phone AND email are both mandatory', () => {
    expect(refereeErrors({ ...coach, email: '' }).email).toMatch(/both mandatory/);
    expect(refereeErrors({ ...coach, phone: '' }).phone).toMatch(/both mandatory/);
  });

  it('no relatives', () => {
    for (const r of [
      'Mother',
      'my brother',
      'Aunt',
      'Step-father',
      'mother-in-law',
      'Cousin (older)',
    ]) {
      expect(looksLikeRelative(r), r).toBe(true);
    }
    for (const r of [
      'Manager at Pret',
      'Motherwell FC coach',
      'Personal tutor',
      'Line manager, Sonos',
    ]) {
      expect(looksLikeRelative(r), r).toBe(false);
    }
  });

  it('two different people', () => {
    expect(referencesReady([tutor, { ...coach, email: 'H.Okafor@ucl.ac.uk' }])).toBe(false);
    expect(referencesReady([tutor])).toBe(false);
  });

  it('keeps the word list lower-case, as the SQL pattern needs', () => {
    for (const w of RELATIVE_WORDS) expect(w).toBe(w.toLowerCase());
  });
});

describe('bank details (§2.10)', () => {
  it('accepts the wireframe’s values', () => {
    expect(
      bankErrors({ accountHolder: 'Amara Kalu', sortCode: '40-47-84', accountNumber: '31926819' }),
    ).toEqual({});
  });
  it('six-digit sort code, eight-digit account number', () => {
    const e = bankErrors({ accountHolder: '', sortCode: '40-47', accountNumber: '123' });
    expect(Object.keys(e).sort()).toEqual(['accountHolder', 'accountNumber', 'sortCode']);
  });
});

describe('step gating (§10.3, §2.3, §2.9)', () => {
  const none: WizardFacts = {
    status: 'documents',
    rtwDone: false,
    addressDone: false,
    selfieDone: false,
    documentsSubmitted: false,
    inductionDone: false,
    quizPassed: false,
    hmrcDone: false,
    referencesDone: false,
    bankDone: false,
    contractSigned: false,
    tutorialDone: false,
  };

  it('nothing to do before Willo accepts', () => {
    expect(wizardPhase({ ...none, status: 'interview_requested' })).toBe('awaiting_interview');
    expect(wizardPhase({ ...none, status: 'interview_completed' })).toBe('awaiting_interview');
    expect(currentStep({ ...none, status: 'interview_requested' })).toBeNull();
  });

  it('starts on step 1 and walks forward one at a time', () => {
    expect(currentStep(none)).toBe(1);
    expect(stepAccess(2, none)).toBe('locked');
    const after2 = { ...none, rtwDone: true, addressDone: true };
    expect(currentStep(after2)).toBe(3);
    expect(stepAccess(1, after2)).toBe('done');
    expect(stepAccess(3, after2)).toBe('current');
    expect(stepAccess(4, after2)).toBe('locked');
  });

  it('pauses after step 4 until every document is verified', () => {
    const submitted = {
      ...none,
      rtwDone: true,
      addressDone: true,
      selfieDone: true,
      documentsSubmitted: true,
    };
    expect(wizardPhase(submitted)).toBe('awaiting_review');
    expect(currentStep(submitted)).toBeNull();
    expect(stepAccess(5, submitted)).toBe('locked');
    expect(stepsDone(submitted)).toBe(4);
  });

  it('the database moving the candidate to quiz opens step 5, then 6', () => {
    const quiz = { ...none, status: 'quiz' as const };
    expect(currentStep(quiz)).toBe(5);
    expect(currentStep({ ...quiz, inductionDone: true })).toBe(6);
    expect(stepAccess(7, { ...quiz, inductionDone: true })).toBe('locked');
  });

  it('after the quiz, 7 → 8 → 9 → 10', () => {
    const contract = { ...none, status: 'contract' as const, quizPassed: true };
    expect(currentStep(contract)).toBe(7);
    expect(currentStep({ ...contract, hmrcDone: true })).toBe(8);
    expect(currentStep({ ...contract, hmrcDone: true, referencesDone: true })).toBe(9);
    expect(currentStep({ ...contract, hmrcDone: true, referencesDone: true, bankDone: true })).toBe(
      10,
    );
  });

  it('signed → compliant → step 11, then done', () => {
    const compliant = { ...none, status: 'compliant' as const };
    expect(currentStep(compliant)).toBe(11);
    expect(wizardPhase({ ...compliant, tutorialDone: true })).toBe('complete');
  });

  it('rejected, blocked, left and removed are closed — the lock decides', () => {
    for (const status of ['rejected', 'blocked', 'inactive', 'removed'] as const) {
      expect(wizardPhase({ ...none, status })).toBe('closed');
    }
  });

  it('steps 1–4 are editable until the documents are submitted, 7–10 until signing', () => {
    expect(canEditStep(1, { ...none, rtwDone: true })).toBe(true);
    expect(canEditStep(1, { ...none, documentsSubmitted: true })).toBe(false);
    expect(canEditStep(7, { ...none, status: 'contract', hmrcDone: true })).toBe(true);
    expect(canEditStep(7, { ...none, status: 'compliant' })).toBe(false);
  });
});

describe('the contract signature is a UK-time audit stamp (§2.11, §1.8)', () => {
  it('is Europe/London whatever the reader’s zone, in BST', () => {
    // 13:42Z on 18 Sep 2026 is 14:42 BST.
    expect(signatureStamp(new Date('2026-09-18T13:42:00Z'))).toBe('18.09.2026 14:42 UK time');
  });
  it('and in GMT', () => {
    expect(signatureStamp(new Date('2026-12-01T09:05:00Z'))).toBe('01.12.2026 09:05 UK time');
  });
  it('reads as the wireframe', () => {
    expect(signatureLine(new Date('2026-09-18T13:42:00Z'))).toBe(
      'Signed electronically · 18.09.2026 14:42 UK time — this timestamp is your signature',
    );
  });
});
