import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RtwForm } from '@thc/domain';

/**
 * Every wizard step renders, state by state, with the wireframes' copy
 * (wireframes/staff/onboarding-1.html, -2, -3). The router and the server
 * actions are stubbed: this is about what the screens SAY and which button
 * is enabled, not about the writes, which pgTAP 390–393 hold.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({}));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));

const { RtwStep } = await import('../_components/RtwStep');
const { AddressStep } = await import('../_components/AddressStep');
const { SelfieStep } = await import('../_components/SelfieStep');
const { DocumentsStep } = await import('../_components/DocumentsStep');
const { ReviewHub } = await import('../_components/ReviewHub');
const { InductionStep } = await import('../_components/InductionStep');
const { QuizStep } = await import('../_components/QuizStep');
const { HmrcStep } = await import('../_components/HmrcStep');
const { ReferencesStep } = await import('../_components/ReferencesStep');
const { BankStep } = await import('../_components/BankStep');
const { ContractStep } = await import('../_components/ContractStep');
const { TutorialStep } = await import('../_components/TutorialStep');
const { requirementRows, mapOnboardingState } = await import('../state');

const TODAY = '2026-09-23';
const blank: RtwForm = {
  branch: null,
  dob: '',
  gender: null,
  shareCode: '',
  visaType: '',
  visaExpiry: '',
  ukChoice: null,
  wtrOptOut: false,
};

/** The primary footer button: its label and whether it is disabled. */
function footer(html: string): { label: string; disabled: boolean } {
  const foot = html.slice(html.indexOf('class="wiz-foot"'));
  const button = /<button[^>]*>([\s\S]*?)<\/button>/.exec(foot);
  return {
    label: (button?.[1] ?? '').replace(/<[^>]+>/g, ''),
    disabled: /<button[^>]*disabled=""/.test(foot.slice(0, foot.indexOf('</button>'))),
  };
}

describe('1/11 Right to work', () => {
  it('branch picker — nothing selected: five branches, Continue disabled', () => {
    const html = renderToStaticMarkup(<RtwStep initial={blank} today={TODAY} />);
    expect(html).toContain('1/11 · Right to work');
    expect(html).toContain('Which describes you?');
    for (const t of [
      'UK or Irish citizen',
      'EU / EEA',
      'Work visa',
      'International student',
      'Dependant or other visa',
    ]) {
      expect(html).toContain(t);
    }
    expect(footer(html)).toEqual({ label: 'Continue', disabled: true });
    expect(html).toContain('Choose one to continue');
  });

  it('UK / Irish — no share code field, passport or birth certificate + NI evidence', () => {
    const html = renderToStaticMarkup(
      <RtwStep
        initial={{
          ...blank,
          branch: 'uk_irish',
          dob: '2001-02-14',
          gender: 'M',
          ukChoice: 'passport',
        }}
        today={TODAY}
      />,
    );
    expect(html).not.toContain('Share code');
    expect(html).toContain('Birth cert. + NI evidence');
    expect(html).toContain('P60');
    expect(footer(html).disabled).toBe(false);
  });

  it('gender under the DOB in every branch: Male / Female on the shared segment, required (§9.9)', () => {
    const html = renderToStaticMarkup(
      <RtwStep
        initial={{ ...blank, branch: 'uk_irish', dob: '2001-02-14', ukChoice: 'passport' }}
        today={TODAY}
      />,
    );
    expect(html).toContain('Gender');
    expect(html).toMatch(/aria-label="Gender"[^>]*>/);
    expect(html).toContain('>Male<');
    expect(html).toContain('>Female<');
    // Nothing pressed on the Gender segment itself (the document choice
    // beneath it is pre-selected, so the check is scoped to this control).
    const seg = html.slice(html.indexOf('aria-label="Gender"'));
    expect(seg.slice(0, seg.indexOf('</div>'))).not.toContain('aria-pressed="true"');
    expect(html).toContain('HMRC New Starter report');
    expect(footer(html)).toEqual({ label: 'Continue', disabled: true });
    expect(html).toContain('Gender is required');

    const chosen = renderToStaticMarkup(
      <RtwStep
        initial={{
          ...blank,
          branch: 'eu_settled',
          dob: '1999-09-30',
          gender: 'F',
          shareCode: 'W123AB4CD',
        }}
        today={TODAY}
      />,
    );
    expect(chosen).toMatch(/aria-pressed="true"[^>]*>Female</);
    expect(footer(chosen).disabled).toBe(false);
  });

  it('EU/EEA — an invalid share code shows the wireframe error and blocks Continue', () => {
    const html = renderToStaticMarkup(
      <RtwStep
        initial={{ ...blank, branch: 'eu_settled', dob: '1999-09-30', shareCode: 'W12 3AB' }}
        today={TODAY}
      />,
    );
    expect(html).toContain('Share code must be 9 letters and numbers starting with W');
    expect(footer(html).disabled).toBe(true);
    expect(html).toContain('Fix the share code to continue');
  });

  it('work visa — visa type and expiry, passport + visa upload at step 4', () => {
    const html = renderToStaticMarkup(
      <RtwStep
        initial={{
          ...blank,
          branch: 'work_visa',
          dob: '1997-06-08',
          gender: 'M',
          shareCode: 'W123AB4CD',
          visaType: 'Skilled Worker',
          visaExpiry: '2028-03-31',
        }}
        today={TODAY}
      />,
    );
    expect(html).toContain('Visa type');
    expect(html).toContain('Visa — photo or PDF (BRP / eVisa)');
    expect(footer(html).disabled).toBe(false);
  });

  it('international student — the term letter, the 20 h note, no visa upload', () => {
    const html = renderToStaticMarkup(
      <RtwStep
        initial={{
          ...blank,
          branch: 'international_student',
          dob: '2003-11-22',
          shareCode: 'W12 3AB 4CD',
        }}
        today={TODAY}
      />,
    );
    expect(html).toContain('University Term Dates Letter');
    expect(html).toContain('20 h/week');
    expect(html).not.toContain('Visa — photo');
  });

  it('dependant — DOB, gender, share code and expiry required', () => {
    const html = renderToStaticMarkup(
      <RtwStep initial={{ ...blank, branch: 'dependant_other' }} today={TODAY} />,
    );
    expect(html).toContain('Date of birth, gender, share code and expiry are required');
    expect(footer(html).disabled).toBe(true);
  });
});

describe('2/11 Home address', () => {
  it('asks for the pin; Continue waits for it', () => {
    const html = renderToStaticMarkup(
      <AddressStep initial={{ line: '', town: '', postcode: '', lat: null, lng: null }} />,
    );
    expect(html).toContain('Where do you live?');
    expect(html).toContain('Use my location');
    expect(footer(html).disabled).toBe(true);
  });
  it('complete', () => {
    const html = renderToStaticMarkup(
      <AddressStep
        initial={{
          line: 'Flat 4, 22 Roman Road',
          town: 'London',
          postcode: 'E2 0RY',
          lat: 51.529,
          lng: -0.045,
        }}
      />,
    );
    expect(footer(html).disabled).toBe(false);
    expect(html).toContain('(E7)');
  });
});

describe('3/11 Profile selfie', () => {
  it('viewfinder: Continue disabled until a photo is taken', () => {
    const html = renderToStaticMarkup(
      <SelfieStep name="Amara Kalu" existingUrl={null} locked={false} />,
    );
    expect(html).toContain('Take your profile photo');
    expect(html).toContain('capture="user"');
    expect(html).toContain('Take a photo to continue');
  });
  it('a returning worker confirms the locked photo', () => {
    const html = renderToStaticMarkup(<SelfieStep name="Amara Kalu" existingUrl={null} locked />);
    expect(html).toContain('locked');
    expect(footer(html).disabled).toBe(false);
  });
});

const state = mapOnboardingState({
  status: 'documents',
  firstName: 'Amara',
  lastName: 'Kalu',
  rtwBranch: 'international_student',
  shareCode: 'W123AB4CD',
  progress: {},
  documents: [
    {
      id: 'd1',
      docType: 'passport',
      status: 'pending',
      fileName: 'passport_amara.jpg',
      fileSize: 2202009,
      uploadedAt: '2026-09-18T10:24:00Z',
    },
  ],
})!;

describe('4/11 Documents', () => {
  it('student branch, term letter missing: Upload, the share code as entered, Submit disabled', () => {
    const html = renderToStaticMarkup(
      <DocumentsStep
        branchTitle="International student"
        rows={requirementRows(state)}
        shareCode="W123AB4CD"
        today={TODAY}
      />,
    );
    expect(html).toContain('passport_amara.jpg · 2.1 MB');
    expect(html).toContain('Share code · W12 3AB 4CD');
    expect(html).toContain('Criminal conviction declaration');
    expect(html).toContain('Upload your University Term Dates Letter to continue');
    expect(footer(html)).toEqual({ label: 'Submit documents', disabled: true });
  });

  it('after Submit: In review, the No declaration verified, onboarding paused at 4 of 11', () => {
    const html = renderToStaticMarkup(
      <ReviewHub
        rows={requirementRows(state)}
        shareDoc={{
          ...state.documents[0]!,
          id: 'x',
          docType: 'share_code_report',
          shareCode: 'W123AB4CD',
          fileName: null,
        }}
        dob="2003-11-22"
        declaration={{ answer: false, status: 'verified', declaredAt: '2026-09-18T10:24:00Z' }}
      />,
    );
    expect(html).toContain('Thanks — your documents are with the office.');
    expect(html).toContain('In review');
    expect(html).toContain('gov.uk check running · DOB 22.11.2003');
    expect(html).toContain('Answered “No” · verified automatically');
    expect(html).toContain('4 of 11 done');
    expect(html).toContain('Continue onboarding — locked');
  });

  it('a rejected document: the reason and Re-upload (§2.3)', () => {
    const rejected = mapOnboardingState({
      ...state,
      progress: {},
      documents: [
        {
          ...state.documents[0],
          status: 'rejected',
          rejectionReason: 'Photo is blurred — please re-take',
        },
      ],
    })!;
    const html = renderToStaticMarkup(
      <ReviewHub rows={requirementRows(rejected)} shareDoc={null} dob={null} declaration={null} />,
    );
    expect(html).toContain('One document needs your attention.');
    expect(html).toContain('Rejected · “Photo is blurred — please re-take”');
    expect(html).toContain('Re-upload');
  });
});

describe('5/11 and 6/11', () => {
  it('the induction unlocks on the last slide', () => {
    const html = renderToStaticMarkup(<InductionStep alreadyDone={false} />);
    expect(html).toContain('Slide 1 of');
    expect(html).toMatch(/Unlocks on the last slide \((\d+) of \1\)/);
    expect(footer(html)).toEqual({ label: 'Continue to the quiz', disabled: true });
  });

  it('the quiz: question 1, attempt n of 3, answers checked at the end', () => {
    const html = renderToStaticMarkup(
      <QuizStep
        firstName="Amara"
        questions={[
          {
            id: 'q1',
            n: 1,
            prompt: 'You discover a small fire in the kitchen. What should you do first?',
            options: ['A', 'B', 'C', 'D'],
          },
        ]}
        previous={[{ attemptNo: 1, correct: 7, total: 10, passed: false }]}
      />,
    );
    expect(html).toContain('Question 1 of 1');
    expect(html).toContain('Attempt 2 of 3');
    expect(html).toContain('Your answers are checked at the end, not one by one.');
  });
});

describe('7/11 HMRC', () => {
  const form = {
    q1OtherJob: false,
    q2Pension: false,
    q3Since6April: null,
    studentLoan: 'none' as const,
    postgraduateLoan: false,
    niNumber: '',
    declared: false,
  };
  it('Q1 = No → Q2 = No → Q3 shown; the letter is never on screen', () => {
    const html = renderToStaticMarkup(<HmrcStep initial={form} niMasked={null} />);
    expect(html).toContain('3 · Since 6 April');
    expect(html).toContain('Answer question 3 and tick the declaration to continue');
    expect(html).not.toMatch(/Statement [ABC]\b/);
    expect(html).toContain('Postgraduate Loan');
  });
  it('Q1 = Yes hides Q2 and Q3; a locked NI number is shown masked', () => {
    const html = renderToStaticMarkup(
      <HmrcStep initial={{ ...form, q1OtherJob: true, declared: true }} niMasked="●●●●●●●6C" />,
    );
    expect(html).not.toContain('2 · Do you receive');
    expect(html).toContain('●●●●●●●6C');
    expect(footer(html).disabled).toBe(false);
  });
});

describe('8/11 References', () => {
  it('referee 1 complete, referee 2 missing: Continue disabled', () => {
    const html = renderToStaticMarkup(
      <ReferencesStep
        initial={[
          {
            name: 'Dr Helen Okafor',
            relationship: 'Personal tutor, UCL',
            phone: '+44 20 7679 2000',
            email: 'h.okafor@ucl.ac.uk',
          },
        ]}
      />,
    );
    expect(html).toContain('Not relatives.');
    expect(html).toContain('Complete');
    expect(html).toContain('Incomplete');
    expect(html).toContain('Complete both referees to continue');
  });
});

describe('9/11 – 11/11', () => {
  it('bank: complete', () => {
    const html = renderToStaticMarkup(
      <BankStep
        initial={{ accountHolder: 'Amara Kalu', sortCode: '40-47-84', accountNumber: '31926819' }}
      />,
    );
    expect(html).toContain('Where should we pay you?');
    expect(html).toContain('Format check only');
    expect(footer(html).disabled).toBe(false);
  });

  it('contract, unsigned: the duty to disclose, Continue disabled', () => {
    const html = renderToStaticMarkup(
      <ContractStep
        version="v1"
        title="Casual worker agreement — The Hospitality Company Ltd"
        body={
          '5. Ongoing duty to disclose convictions. You undertake to declare any unspent criminal conviction.'
        }
        isPlaceholder
        signedStamp={null}
      />,
    );
    expect(html).toContain('<b>5. Ongoing duty to disclose convictions.</b>');
    expect(html).toContain('Tick “I agree” to sign and continue');
    expect(footer(html).disabled).toBe(true);
  });

  it('contract, signed: the UK-time stamp is the signature', () => {
    const html = renderToStaticMarkup(
      <ContractStep
        version="v1"
        title="T"
        body="1. Status. Zero hours."
        isPlaceholder={false}
        signedStamp="18.09.2026 14:42 UK time"
      />,
    );
    expect(html).toContain(
      'Signed electronically · 18.09.2026 14:42 UK time — this timestamp is your signature',
    );
    expect(footer(html).disabled).toBe(false);
  });

  it('how it works → Open app', () => {
    const html = renderToStaticMarkup(<TutorialStep firstName="Amara" />);
    expect(html).toContain('You’re nearly there, Amara');
    expect(footer(html).label).toBe('Open app');
  });
});
