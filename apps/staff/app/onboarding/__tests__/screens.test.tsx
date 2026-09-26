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
        initial={{ ...blank, branch: 'uk_irish', dob: '2001-02-14', ukChoice: 'passport' }}
        today={TODAY}
      />,
    );
    expect(html).not.toContain('Share code');
    expect(html).toContain('Birth cert. + NI evidence');
    expect(html).toContain('P60');
    expect(footer(html).disabled).toBe(false);
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
          shareCode: 'W123AB4CD',
          visaType: 'Skilled Worker',
          visaExpiry: '2028-03-31',
        }}
        today={TODAY}
      />,
    );
    expect(html).toContain('Visa type');
    expect(html).toContain('Visa — photo or PDF (BRP / eVisa)');
    // A valid share code gets the wireframe's green ✓ addon on the field and its hint.
    expect(html).toMatch(/<span class="addon"><span class="green">✓<\/span><\/span>/);
    expect(html).toContain(
      '9 characters starting with W, e.g. W123AB4CD — pasted with spaces is fine.',
    );
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

  it('dependant — DOB, share code and expiry required', () => {
    const html = renderToStaticMarkup(
      <RtwStep initial={{ ...blank, branch: 'dependant_other' }} today={TODAY} />,
    );
    expect(html).toContain('Date of birth, share code and expiry are required');
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
    // The office is told (E7), in words: the register code is not shown.
    expect(html).toContain('the office is notified of the');
    expect(html).not.toContain('(E7)');
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
  it('a photo on file is locked, with the §10.1 sentence and no claim about a previous time', () => {
    // Steps 1–4 stay open until Submit (canEditStep), so a first-timer who
    // took the selfie a minute ago lands here too: the copy must be true
    // for them as well as for a §2.12 returner.
    const html = renderToStaticMarkup(<SelfieStep name="Amara Kalu" existingUrl={null} locked />);
    expect(html).toContain('locked — changing it goes through the office');
    expect(html).not.toContain('previous time');
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
    expect(html).toContain('Checked with gov.uk automatically after you submit');
    expect(html).toContain('Criminal conviction declaration');
    // The note explains the choice before it is made (onboarding-1.html 4/11).
    expect(html).toContain('“No” is recorded as verified straight away');
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

  it('the automated gov.uk check (ADR-0025): Checking, then no manual-review wording on a pass', () => {
    const share = {
      ...state.documents[0]!,
      id: 'x',
      docType: 'share_code_report' as const,
      shareCode: 'W123AB4CD',
      fileName: null,
    };
    const checking = renderToStaticMarkup(
      <ReviewHub
        rows={requirementRows(state)}
        shareDoc={share}
        shareCheck={{ status: 'running' }}
        dob="2003-11-22"
        declaration={null}
      />,
    );
    expect(checking).toContain('Checking with gov.uk… · DOB 22.11.2003');
    expect(checking).toContain('>Checking<');

    const passed = renderToStaticMarkup(
      <ReviewHub
        rows={requirementRows(state)}
        shareDoc={{ ...share, status: 'verified', rightToWorkUntil: '2028-01-31' }}
        shareCheck={{ status: 'passed' }}
        dob="2003-11-22"
        declaration={null}
      />,
    );
    expect(passed).toContain('Verified · right to work until 31.01.2028');
    expect(passed.toLowerCase()).not.toContain('manual');
  });

  it('a share code gov.uk did not recognise: the reason and Enter again', () => {
    const html = renderToStaticMarkup(
      <ReviewHub
        rows={requirementRows(state)}
        shareDoc={{
          ...state.documents[0]!,
          id: 'x',
          docType: 'share_code_report',
          shareCode: 'W123AB4CD',
          fileName: null,
          status: 'rejected',
          rejectionReason:
            'gov.uk did not recognise this share code with your date of birth — check both and try again',
        }}
        shareCheck={{ status: 'rejected' }}
        dob="2003-11-22"
        declaration={null}
      />,
    );
    expect(html).toContain('One document needs your attention.');
    expect(html).toContain(
      'Enter again · “gov.uk did not recognise this share code with your date of birth — check both and try again”',
    );
    expect(html).toContain('>Enter again<');
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
            prompt:
              'What fire extinguisher from these listed would be utilised on an electrical fire?',
            options: ['Water', 'Foam', 'Carbon Dioxide'],
            image: null,
          },
        ]}
        previous={[{ attemptNo: 1, correct: 7, total: 10, passed: false }]}
      />,
    );
    expect(html).toContain('Question 1 of 1');
    expect(html).toContain('Attempt 2 of 3');
    expect(html).toContain('Your answers are checked at the end, not one by one.');
    expect(html).not.toContain('<img');
  });

  it('the quiz: a question with a picture shows it above the options (THC’s Q7)', () => {
    const html = renderToStaticMarkup(
      <QuizStep
        firstName="Amara"
        questions={[
          {
            id: 'q7',
            n: 1,
            prompt: 'COSHH – what does this symbol mean?',
            options: ['Oxidising', 'Corrosive', 'Toxic'],
            image: '/quiz/coshh-toxic.svg',
          },
        ]}
        previous={[]}
      />,
    );
    expect(html).toContain(
      '<img class="quiz-img" src="/quiz/coshh-toxic.svg" alt="COSHH hazard symbol"/>',
    );
    expect(html.indexOf('quiz-img')).toBeLessThan(html.indexOf('quiz-opt'));
  });

  const question = {
    id: 'q1',
    n: 1,
    prompt: 'What fire extinguisher from these listed would be utilised on an electrical fire?',
    options: ['Water', 'Foam', 'Carbon Dioxide'],
    image: null,
  };
  const quizResult = (over: Partial<Parameters<typeof QuizStep>[0]['initialResult'] & object>) =>
    renderToStaticMarkup(
      <QuizStep
        firstName="Amara"
        questions={[question]}
        previous={[{ attemptNo: 1, correct: 7, total: 10, passed: false }]}
        initialResult={{
          attemptNo: 1,
          correct: 7,
          total: 10,
          percent: 70,
          passed: false,
          outcome: 'retry',
          attemptsLeft: 2,
          ...over,
        }}
      />,
    );

  it('result — passed: the pass mark, "saved on your profile", Continue enabled', () => {
    const html = quizResult({
      correct: 9,
      percent: 90,
      passed: true,
      outcome: 'passed',
      attemptsLeft: 2,
    });
    expect(html).toContain('Passed');
    expect(html).toContain('Well done, Amara');
    expect(html).toContain('9 of 10 correct');
    expect(html).toContain('the pass mark is 80%. Your result is saved on your profile.');
    expect(footer(html)).toEqual({ label: 'Continue', disabled: false });
  });

  it('result — not passed (70%), 2 attempts left: retry, the neutral §2.9 line, review link', () => {
    const html = quizResult({});
    expect(html).toContain('Not quite this time');
    expect(html).toContain('You have 2 attempts left.');
    // Neutral, not amber: amber is already "attempts left" on this screen.
    expect(html).toMatch(
      /<div class="alert" role="status">After three unsuccessful attempts your application can’t continue\./,
    );
    expect(footer(html)).toEqual({ label: 'Try again — attempt 2 of 3', disabled: false });
    expect(html).toContain('href="/onboarding/5"');
    expect(html).toContain('Review the induction slides');
  });

  it('result — third failure: nothing to continue to', () => {
    const html = quizResult({ attemptNo: 3, outcome: 'rejected', attemptsLeft: 0 });
    expect(html).toContain('Not passed');
    expect(html).not.toContain('After three unsuccessful attempts');
    expect(footer(html)).toEqual({ label: 'Continue', disabled: true });
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
    // The wireframe's hint shows what "masked" will look like.
    expect(html).toContain('shown masked (●●●●●●●6B) and locked');
  });
  it('joins three missing things as a sentence — "a, b and c" — not "a and b and c"', () => {
    const html = renderToStaticMarkup(
      <HmrcStep initial={{ ...form, q3Since6April: null, studentLoan: null }} niMasked={null} />,
    );
    expect(html).toContain(
      'Answer question 3, answer the student loan question and tick the declaration to continue',
    );
  });
  it('Q1 = Yes hides Q2 and Q3; a locked NI number is shown masked', () => {
    const html = renderToStaticMarkup(
      <HmrcStep initial={{ ...form, q1OtherJob: true, declared: true }} niMasked="●●●●●●●6C" />,
    );
    expect(html).not.toContain('2 · Do you receive');
    expect(html).toContain('●●●●●●●6C');
    expect(footer(html).disabled).toBe(false);
  });
  it('asks gender as HMRC’s two values, says why, and waits for it (§9.9 Tab 3)', () => {
    const unanswered = renderToStaticMarkup(
      <HmrcStep
        initial={{ ...form, q1OtherJob: true, declared: true, gender: null }}
        niMasked={null}
      />,
    );
    expect(unanswered).toContain('Gender, as HMRC records it');
    expect(unanswered).toContain('>Male<');
    expect(unanswered).toContain('>Female<');
    expect(unanswered).toContain('only accept male or female');
    expect(unanswered).toContain('Answer the gender question to continue');
    expect(footer(unanswered).disabled).toBe(true);

    const answered = renderToStaticMarkup(
      <HmrcStep
        initial={{ ...form, q1OtherJob: true, declared: true, gender: 'F' }}
        niMasked={null}
      />,
    );
    expect(footer(answered).disabled).toBe(false);
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
    expect(html).toContain(
      'Clause 28, the duty to disclose convictions, is awaiting THC’s approval.',
    );
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
    expect(html).not.toContain('awaiting THC’s approval');
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
