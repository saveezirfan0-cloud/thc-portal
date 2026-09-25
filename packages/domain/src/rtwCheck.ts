/**
 * The automated gov.uk share-code check — the rules that are not the
 * browser (§2.5, §2.6, RULE-20 · ADR-0025).
 *
 * The runner reads the Home Office result (Playwright), Claude turns the
 * page into an RtwExtraction, and `assessRtwResult()` decides what the
 * office is shown. It never verifies or rejects anything: the admin does,
 * with one click, through the existing verify / reject path. So every
 * outcome here is a RECOMMENDATION, and anything short of a clean pass is
 * worded as something for a person to look at.
 *
 * Pure: no I/O, no clock (today is passed in), so the same vectors hold in
 * the runner, the office screens and the tests.
 */

import type { RtwBranch } from './onboarding';

export type RtwCheckStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type RtwCheckOutcome =
  'pass' | 'name_mismatch' | 'conditions_mismatch' | 'not_found' | 'no_right_to_work';

/**
 * What the extractor read off the gov.uk result, and nothing else. The
 * share code and date of birth are inputs to the check and are never part
 * of its result (rtw_checks_result_has_no_inputs).
 */
export interface RtwExtraction {
  /** gov.uk found details for this share code and date of birth. */
  found: boolean;
  /** The result says the person may work in the UK today. */
  hasRightToWork: boolean;
  /** The name exactly as gov.uk shows it. */
  holderName: string | null;
  /** YYYY-MM-DD, or null when there is no end date. */
  rightToWorkUntil: string | null;
  /** "No time limit" — settled status or indefinite leave. */
  noTimeLimit: boolean;
  /** The status or visa as gov.uk names it, e.g. "Student visa". */
  permissionType: string | null;
  /** The work conditions, verbatim. */
  conditions: string | null;
  /** A weekly limit that applies during term time, e.g. 20. Null if none stated. */
  termTimeWeeklyHours: number | null;
}

export interface RtwWorker {
  firstName: string;
  lastName: string;
  branch: RtwBranch | null;
  /** RULE-20: the Student condition is 10 h a week below degree level, 20 h at degree level. */
  belowDegreeLevel: boolean;
}

export interface RtwAssessment {
  outcome: RtwCheckOutcome;
  /** Plain sentences for the office, in the order they were found. */
  reasons: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------

/**
 * Upper case, accents removed, anything that is not a letter becomes a
 * space. "José O'Neill-Smith" → ["JOSE", "ONEILL", "SMITH"].
 */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length > 0);
}

/**
 * The worker's name and the name on the Home Office record are the same
 * person's when one is contained in the other: gov.uk shows the full legal
 * name (middle names, second surnames), and the worker usually typed the
 * short form — or, less often, the other way round. At least two names
 * must line up, so a shared first name alone is never a match.
 */
export function namesMatch(
  worker: { firstName: string; lastName: string },
  holder: string | null,
): boolean {
  const mine = nameTokens(`${worker.firstName} ${worker.lastName}`);
  const theirs = nameTokens(holder);
  if (mine.length === 0 || theirs.length === 0) return false;
  const inTheirs = mine.every((t) => theirs.includes(t));
  const inMine = theirs.every((t) => mine.includes(t));
  const shared = mine.filter((t) => theirs.includes(t)).length;
  return (inTheirs || inMine) && shared >= 2;
}

// ---------------------------------------------------------------------
// The assessment
// ---------------------------------------------------------------------

/**
 * What the office is shown for one result. `today` is the UK date,
 * YYYY-MM-DD (§1.8: rules are evaluated in Europe/London).
 */
export function assessRtwResult(
  worker: RtwWorker,
  result: RtwExtraction,
  today: string,
): RtwAssessment {
  if (!result.found) {
    return {
      outcome: 'not_found',
      reasons: ['gov.uk found no record for this share code and date of birth.'],
    };
  }

  const until = result.rightToWorkUntil;
  if (until !== null && !ISO_DATE.test(until)) {
    return {
      outcome: 'conditions_mismatch',
      reasons: [`gov.uk's date could not be read ("${until}").`],
    };
  }
  if (!result.hasRightToWork) {
    return {
      outcome: 'no_right_to_work',
      reasons: ['gov.uk says this person has no right to work in the UK.'],
    };
  }
  if (until !== null && until < today) {
    return {
      outcome: 'no_right_to_work',
      reasons: [`gov.uk shows the right to work ended on ${until}.`],
    };
  }

  if (!namesMatch(worker, result.holderName)) {
    return {
      outcome: 'name_mismatch',
      reasons: [
        `gov.uk shows "${result.holderName ?? 'no name'}", the profile says "${worker.firstName} ${worker.lastName}".`,
      ],
    };
  }

  const reasons = conditionProblems(worker, result);
  return reasons.length > 0
    ? { outcome: 'conditions_mismatch', reasons }
    : { outcome: 'pass', reasons: [] };
}

/**
 * Where the Home Office record contradicts the branch the worker chose
 * (§2.5) or the cap RULE-20 would calculate for them. The cap itself is
 * never taken from gov.uk — it stays calculated from the verified term
 * dates — so a disagreement is shown to the office, never written.
 */
export function conditionProblems(worker: RtwWorker, result: RtwExtraction): string[] {
  const problems: string[] = [];
  const hours = result.termTimeWeeklyHours;

  if (result.rightToWorkUntil === null && !result.noTimeLimit) {
    problems.push('gov.uk gave neither an end date nor "no time limit".');
  }
  if (result.noTimeLimit && worker.branch !== 'eu_settled') {
    // ADR-0018: settled — no time limit — is confirmable on the EU branch only.
    problems.push('gov.uk shows no time limit, which only the EU/EEA settled branch can confirm.');
  }
  if (worker.branch === 'international_student' && hours === null) {
    problems.push(
      'The worker is on the student branch, but gov.uk states no term-time hours limit.',
    );
  }
  if (hours !== null && worker.branch !== 'international_student') {
    problems.push(
      `gov.uk limits work to ${hours} hours a week in term time, but the worker is not on the student branch.`,
    );
  }
  if (hours !== null && worker.branch === 'international_student') {
    const calculated = worker.belowDegreeLevel ? 10 : 20;
    if (hours < calculated) {
      problems.push(
        `gov.uk allows ${hours} hours a week in term time; the calculated cap would allow ${calculated}. ` +
          'Mark the course as below degree level before verifying.',
      );
    } else if (hours !== 10 && hours !== 20) {
      problems.push(`gov.uk states an unusual term-time limit of ${hours} hours a week.`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------

/** The office's one-line label for an outcome. */
export function rtwOutcomeLabel(outcome: RtwCheckOutcome): string {
  switch (outcome) {
    case 'pass':
      return 'Passed — check the photo';
    case 'name_mismatch':
      return 'Name does not match';
    case 'conditions_mismatch':
      return 'Conditions need a look';
    case 'not_found':
      return 'Not found on gov.uk';
    case 'no_right_to_work':
      return 'No right to work';
  }
}

/** The office action the result points to. The admin still decides. */
export function rtwRecommendedAction(outcome: RtwCheckOutcome): 'verify' | 'review' | 'reject' {
  if (outcome === 'pass') return 'verify';
  if (outcome === 'not_found' || outcome === 'no_right_to_work') return 'reject';
  return 'review';
}

/**
 * The reason pre-filled in the Reject box. It goes to the worker with N8
 * (compliance_docs.rejection_reason is worker-facing, §2.6), so it says
 * what to do next and nothing the office would not say to their face.
 */
export function rtwRejectReason(outcome: RtwCheckOutcome): string | null {
  switch (outcome) {
    case 'not_found':
      return 'gov.uk found no record for that share code and date of birth. Check both, get a new share code if yours has expired, and enter it again.';
    case 'no_right_to_work':
      return 'gov.uk does not show a current right to work in the UK for this share code. Please contact the office.';
    default:
      return null;
  }
}

/**
 * The Staff App's line under the share code, on the wizard step and in the
 * Documents hub. Null when there is nothing to say (no check, or it was
 * cancelled because the document was replaced or decided).
 */
export function rtwCheckWorkerLine(
  check: { status: RtwCheckStatus; outcome: RtwCheckOutcome | null } | null,
): string | null {
  if (!check) return null;
  switch (check.status) {
    case 'queued':
    case 'running':
      return 'Checking with gov.uk…';
    case 'done':
      return check.outcome === 'pass'
        ? 'Checked with gov.uk — the office is confirming it.'
        : 'Checked with gov.uk — the office is reviewing the result.';
    case 'failed':
      return 'We couldn’t check with gov.uk automatically — the office will check it by hand.';
    case 'cancelled':
      return null;
  }
}

// ---------------------------------------------------------------------
// Keeping the inputs out of logs
// ---------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes the share code (in any spacing or case) and the date of birth
 * (ISO, UK numeric, and "1 January 1995" forms) from a message before it
 * is stored or logged. Error text from a browser often echoes the form.
 */
export function redactRtwInputs(
  message: string,
  inputs: { shareCode: string; dob: string },
): string {
  let out = message;
  const code = inputs.shareCode.replace(/\s+/g, '').toUpperCase();
  if (code.length > 0) {
    const spaced = code.split('').map(escape).join('\\s*');
    out = out.replace(new RegExp(spaced, 'gi'), '[share code]');
  }
  const m = ISO_DATE.exec(inputs.dob) ? inputs.dob.split('-') : null;
  if (m) {
    const [y, mo, d] = m as [string, string, string];
    const day = String(Number(d));
    const month = String(Number(mo));
    const forms = [
      `${y}-${mo}-${d}`,
      `${d}/${mo}/${y}`,
      `${day}/${month}/${y}`,
      `${d}-${mo}-${y}`,
      `${day} ${MONTHS[Number(mo) - 1]} ${y}`,
      `${d} ${MONTHS[Number(mo) - 1]} ${y}`,
    ];
    for (const form of forms) out = out.replace(new RegExp(escape(form), 'gi'), '[date of birth]');
  }
  return out;
}
