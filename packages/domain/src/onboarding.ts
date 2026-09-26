/**
 * The onboarding wizard — Scope §10.3, §2.5, §2.10, §2.11.
 *
 * Pure rules the eleven screens and their database functions share:
 * the step list, the five right-to-work branches and their EXACT document
 * sets, the upload limits, the reference and bank checks, which step is
 * open, and how the contract signature is stamped.
 *
 * Every rule here that decides something is repeated in SQL (migration
 * 20260923120000), because the database is what refuses: a worker who
 * skips this app and calls the RPC directly meets the same rule.
 */

import { UK_ZONE } from './time';
import { shareCodeError } from './shareCode';
// The doc_type enum has one TypeScript home, documents.ts, checked there
// against 0001_init — not declared a second time here.
import type { DocType } from './documents';

// ---------------------------------------------------------------------
// The eleven steps (§10.3, §2.8 "Order in the wizard")
// ---------------------------------------------------------------------

export const ONBOARDING_STEPS = [
  { n: 1, key: 'rtw', title: 'Right to work' },
  { n: 2, key: 'address', title: 'Home address' },
  { n: 3, key: 'selfie', title: 'Profile selfie' },
  { n: 4, key: 'documents', title: 'Documents' },
  { n: 5, key: 'induction', title: 'Health & Safety induction' },
  { n: 6, key: 'quiz', title: 'Safety quiz' },
  { n: 7, key: 'hmrc', title: 'HMRC New Starter Checklist' },
  { n: 8, key: 'references', title: 'Two references' },
  { n: 9, key: 'bank', title: 'Bank & payroll' },
  { n: 10, key: 'contract', title: 'Contract' },
  { n: 11, key: 'tutorial', title: 'How it works' },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];

export const TOTAL_STEPS = ONBOARDING_STEPS.length;

/** The progress-bar fill for step n — 9%, 18%, … 100%, as the wireframes draw it. */
export function stepPercent(n: number): number {
  return Math.round((Math.min(Math.max(n, 0), TOTAL_STEPS) / TOTAL_STEPS) * 100);
}

export function stepByNumber(n: number) {
  return ONBOARDING_STEPS.find((s) => s.n === n) ?? null;
}

// ---------------------------------------------------------------------
// Right to work — five branches, five document sets (§2.5 pts 1–5, 8)
// ---------------------------------------------------------------------

export type RtwBranch =
  'uk_irish' | 'eu_settled' | 'work_visa' | 'international_student' | 'dependant_other';

export const RTW_BRANCHES: readonly { key: RtwBranch; title: string; description: string }[] = [
  {
    key: 'uk_irish',
    title: 'UK or Irish citizen',
    description:
      'Passport — or birth certificate + a document showing your NI number. No share code.',
  },
  {
    key: 'eu_settled',
    title: 'EU / EEA — settled or pre-settled status',
    description: 'Passport or national ID + your gov.uk share code.',
  },
  {
    key: 'work_visa',
    title: 'Work visa',
    description: 'Passport + share code + visa type, expiry and a copy of the visa.',
  },
  {
    key: 'international_student',
    title: 'International student',
    description:
      'Passport + share code + your University Term Dates Letter. 20 h/week in term time.',
  },
  {
    key: 'dependant_other',
    title: 'Dependant or other visa',
    description: 'Passport + share code + visa / status document and its expiry.',
  },
];

/** The heading a chosen branch carries on step 1 and in the Documents step. */
export const BRANCH_HEADING: Readonly<Record<RtwBranch, string>> = {
  uk_irish: 'UK / Irish citizen',
  eu_settled: 'EU / EEA — settled or pre-settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other visa',
};

/** Branch 1 only: "passport (photo) OR birth certificate + a document showing the NI number". */
export type UkDocChoice = 'passport' | 'birth_certificate';

/**
 * §2.5 pt 7 — any of these satisfies the NI evidence requirement; the
 * manager checks the number on it matches the one on the profile.
 */
export const NI_EVIDENCE_ACCEPTED = [
  'an NI card or letter',
  'an HMRC or DWP letter showing the number',
  'a P60',
  'a payslip from a previous employer showing the number',
] as const;

export interface DocRequirement {
  /** Stable key for the row on screen. */
  key: string;
  label: string;
  /** Any ONE of these types satisfies the requirement. */
  accepts: readonly DocType[];
  /** The line under the label while nothing is uploaded. */
  hint?: string;
}

const PASSPORT: DocRequirement = {
  key: 'passport',
  label: 'Passport — photo page',
  accepts: ['passport'],
  hint: 'Photo or scan of the page with your photo on it',
};

/**
 * The documents a branch asks for — "exactly as listed in points 1–5
 * above; no further documents are collected at onboarding" (§2.5 pt 8).
 *
 * Not in this list, deliberately:
 *   · the share code — typed, never uploaded; the gov.uk check produces
 *     its report (`share_code_report`) on submit (§2.5, §2.6);
 *   · a student visa — "No separate student visa upload" (§2.5 pt 4,
 *     confirmed 04.09.2026);
 *   · the completion letter — uploaded once the student graduates, from
 *     the Documents tab (§4.5), not at onboarding;
 *   · a P45 — never accepted anywhere (§2.8).
 */
export function requiredDocuments(
  branch: RtwBranch,
  ukChoice: UkDocChoice | null = 'passport',
): DocRequirement[] {
  switch (branch) {
    case 'uk_irish':
      return ukChoice === 'birth_certificate'
        ? [
            {
              key: 'birth_certificate',
              label: 'Birth certificate',
              accepts: ['birth_certificate'],
              hint: 'Full birth certificate, photo or scan',
            },
            {
              key: 'ni_evidence',
              label: 'NI evidence',
              accepts: ['ni_evidence'],
              hint: `A document showing your NI number: ${NI_EVIDENCE_ACCEPTED.join(', ')}`,
            },
          ]
        : [PASSPORT];
    case 'eu_settled':
      return [
        {
          key: 'identity',
          label: 'Passport or national ID card',
          accepts: ['passport', 'national_id'],
          hint: 'The photo page of your passport, or both sides of your ID card',
        },
      ];
    case 'work_visa':
      return [
        PASSPORT,
        {
          key: 'visa_document',
          label: 'Visa — photo or PDF (BRP / eVisa)',
          accepts: ['visa_document'],
          hint: 'The office cross-checks it against the details you gave and the gov.uk result',
        },
      ];
    case 'international_student':
      return [
        PASSPORT,
        {
          key: 'university_term_dates_letter',
          label: 'University Term Dates Letter',
          accepts: ['university_term_dates_letter'],
          hint: 'This year’s letter from your university',
        },
      ];
    case 'dependant_other':
      return [
        PASSPORT,
        {
          key: 'status_document',
          label: 'Visa or status document',
          accepts: ['status_document'],
          hint: 'Your visa or the document confirming your status',
        },
      ];
  }
}

/** Every document type a branch may upload at onboarding. */
export function acceptedDocTypes(branch: RtwBranch, ukChoice: UkDocChoice | null): DocType[] {
  return [...new Set(requiredDocuments(branch, ukChoice).flatMap((r) => r.accepts))];
}

/** Branch 1 has no share code (§2.5 pt 1); every other branch does. */
export function needsShareCode(branch: RtwBranch): boolean {
  return branch !== 'uk_irish';
}

/** Work visa: visa type (dropdown) + expiry (§2.5 pt 3). */
export function needsVisaType(branch: RtwBranch): boolean {
  return branch === 'work_visa';
}

/** Work visa and dependant / other visa carry a typed expiry (§2.5 pts 3, 5). */
export function needsVisaExpiry(branch: RtwBranch): boolean {
  return branch === 'work_visa' || branch === 'dependant_other';
}

/** The wireframe's dropdown. "Other work visa" keeps it from being a closed list. */
export const VISA_TYPES = [
  'Skilled Worker',
  'Youth Mobility Scheme',
  'Graduate',
  'Other work visa',
] as const;

export interface RtwForm {
  branch: RtwBranch | null;
  /** ISO date, YYYY-MM-DD. */
  dob: string;
  shareCode: string;
  visaType: string;
  /** ISO date, YYYY-MM-DD. */
  visaExpiry: string;
  ukChoice: UkDocChoice | null;
  wtrOptOut: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Whole years between two ISO dates — a birthday today counts. */
export function ageOn(dobIso: string, onIso: string): number {
  const [by, bm, bd] = dobIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = onIso.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Today's date in the UK — the day every §2 rule is judged on. */
export function ukToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: UK_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Field errors for step 1, keyed by field. Empty = Continue is enabled
 * (§10.3: "Continue is disabled until the step is complete").
 */
export function rtwErrors(
  form: RtwForm,
  today: string = ukToday(),
): Partial<Record<keyof RtwForm, string>> {
  const errors: Partial<Record<keyof RtwForm, string>> = {};
  if (!form.branch) {
    errors.branch = 'Choose one to continue';
    return errors;
  }
  if (!form.dob) errors.dob = 'Date of birth is required.';
  else if (!isIsoDate(form.dob)) errors.dob = 'Enter a real date.';
  else if (ageOn(form.dob, today) < 18) {
    errors.dob = 'You must be 18 or over to work with us.';
  }
  if (needsShareCode(form.branch)) {
    const err = shareCodeError(form.shareCode);
    if (err) errors.shareCode = err;
  }
  if (needsVisaType(form.branch) && !form.visaType) errors.visaType = 'Choose your visa type.';
  if (needsVisaExpiry(form.branch)) {
    if (!form.visaExpiry) errors.visaExpiry = 'The expiry date is required.';
    else if (!isIsoDate(form.visaExpiry)) errors.visaExpiry = 'Enter a real date.';
    else if (form.visaExpiry <= today) errors.visaExpiry = 'This date has already passed.';
  }
  if (form.branch === 'uk_irish' && !form.ukChoice) {
    errors.ukChoice = 'Choose which documents you will provide.';
  }
  return errors;
}

/** The footer hint under a disabled Continue on step 1, from the wireframe. */
export function rtwFooterHint(form: RtwForm, today: string = ukToday()): string | null {
  const errors = rtwErrors(form, today);
  if (errors.branch) return errors.branch;
  if (errors.shareCode && form.shareCode.trim() !== '') return 'Fix the share code to continue';
  const missing = [
    errors.dob && 'date of birth',
    errors.shareCode && 'share code',
    errors.visaType && 'visa type',
    errors.visaExpiry && 'expiry',
    errors.ukChoice && 'document choice',
  ].filter((m): m is string => Boolean(m));
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]!
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${missing.length === 1 ? 'is' : 'are'} required`;
}

// ---------------------------------------------------------------------
// Home address — a pin on the map (§10.3 2/11)
// ---------------------------------------------------------------------

/** Outward + inward code, spaces removed — the shape `onboarding_save_address()` checks. */
export const POSTCODE_SQL_PATTERN = '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$';

export function normalisePostcode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isPostcode(raw: string): boolean {
  return new RegExp(POSTCODE_SQL_PATTERN).test(normalisePostcode(raw));
}

/** "e20ry" → "E2 0RY". */
export function formatPostcode(raw: string): string {
  const pc = normalisePostcode(raw);
  return pc.length > 3 ? `${pc.slice(0, -3)} ${pc.slice(-3)}` : pc;
}

/**
 * Great Britain and Northern Ireland, generously — the same box the
 * database refuses outside of. A pin in the Atlantic is a slipped finger.
 */
export const UK_PIN_BOUNDS = { minLat: 49, maxLat: 61, minLng: -9, maxLng: 2.5 } as const;

export function pinInUk(lat: number, lng: number): boolean {
  return (
    lat >= UK_PIN_BOUNDS.minLat &&
    lat <= UK_PIN_BOUNDS.maxLat &&
    lng >= UK_PIN_BOUNDS.minLng &&
    lng <= UK_PIN_BOUNDS.maxLng
  );
}

export interface AddressForm {
  line: string;
  town: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
}

export function addressErrors(a: AddressForm): Partial<Record<keyof AddressForm, string>> {
  const errors: Partial<Record<keyof AddressForm, string>> = {};
  if (!a.line.trim()) errors.line = 'Enter the first line of your address.';
  if (!a.town.trim()) errors.town = 'Enter your town or city.';
  if (!isPostcode(a.postcode)) errors.postcode = 'Enter a UK postcode, e.g. E2 0RY.';
  if (a.lat === null || a.lng === null) errors.lat = 'Drop the pin on your front door.';
  else if (!pinInUk(a.lat, a.lng)) errors.lat = 'The pin needs to be in the UK.';
  return errors;
}

// ---------------------------------------------------------------------
// Uploads (§2.5 pt 7: PDF, JPG, PNG or HEIC, up to 10 MB per file)
// ---------------------------------------------------------------------

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const UPLOAD_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

const UPLOAD_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif']);

export const UPLOAD_ACCEPT_ATTR =
  'application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif';

/** The file's canonical extension, or null when it is not one we take. */
export function uploadKind(file: { name: string; type: string }): string | null {
  const byMime = UPLOAD_MIME[file.type.toLowerCase()];
  if (byMime) return byMime;
  // Several browsers hand HEIC over with an empty type, so the name decides
  // when the type is blank — never when it names something else.
  if (file.type !== '' && file.type !== 'application/octet-stream') return null;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!UPLOAD_EXTENSIONS.has(ext)) return null;
  return ext === 'jpeg' ? 'jpg' : ext === 'heif' ? 'heic' : ext;
}

export function uploadError(file: { name: string; type: string; size: number }): string | null {
  if (file.size <= 0) return 'That file is empty.';
  if (!uploadKind(file)) return 'We take PDF, JPG, PNG or HEIC files only.';
  if (file.size > UPLOAD_MAX_BYTES) return 'That file is over 10 MB. Try a smaller photo or scan.';
  return null;
}

/** "2.1 MB", "340 KB" — the size line under an uploaded file. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------------
// Two references (§2.10, step 8/11)
// ---------------------------------------------------------------------

export interface Referee {
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

/**
 * "No relatives." The office never verifies references, so this is the
 * only place the rule is applied — hence also in SQL (`looks_like_relative`).
 * Whole words, so "Stepmother" and "mother-in-law" match and "Motherwell
 * FC coach" does not.
 */
export const RELATIVE_WORDS = [
  'mother',
  'mum',
  'mom',
  'mummy',
  'father',
  'dad',
  'daddy',
  'parent',
  'parents',
  'brother',
  'sister',
  'sibling',
  'son',
  'daughter',
  'child',
  'aunt',
  'auntie',
  'aunty',
  'uncle',
  'cousin',
  'niece',
  'nephew',
  'grandmother',
  'grandfather',
  'grandma',
  'grandpa',
  'granny',
  'grandad',
  'granddad',
  'grandparent',
  'grandson',
  'granddaughter',
  'stepmother',
  'stepfather',
  'stepbrother',
  'stepsister',
  'stepson',
  'stepdaughter',
  'stepmum',
  'stepdad',
  'husband',
  'wife',
  'spouse',
  'fiance',
  'fiancee',
  'fiancé',
  'fiancée',
  'relative',
  'relation',
  'in-law',
] as const;

/** The same alternation, as the SQL migration spells it — asserted equal in tests. */
export const RELATIVE_SQL_PATTERN = `(^|[^a-z])(${RELATIVE_WORDS.join('|')})([^a-z]|$)`;

export function looksLikeRelative(relationship: string): boolean {
  const text = relationship.toLowerCase().replace(/step-/g, 'step');
  return new RegExp(RELATIVE_SQL_PATTERN).test(text);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** At least 7 digits after stripping spaces, dashes, brackets and a leading +. */
export function isPhone(value: string): boolean {
  const digits = value.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  return /^\d{7,15}$/.test(digits);
}

export function refereeErrors(r: Referee): Partial<Record<keyof Referee, string>> {
  const errors: Partial<Record<keyof Referee, string>> = {};
  if (!r.name.trim()) errors.name = 'Full name is required.';
  if (!r.relationship.trim()) errors.relationship = 'Relationship is required.';
  else if (looksLikeRelative(r.relationship)) {
    errors.relationship = 'Referees can’t be relatives — try an employer, tutor, teacher or coach.';
  }
  if (!r.phone.trim()) {
    errors.phone = 'Phone is required — phone and email are both mandatory, not either/or.';
  } else if (!isPhone(r.phone)) errors.phone = 'Enter a phone number we can call.';
  if (!r.email.trim()) {
    errors.email = 'Email is required — phone and email are both mandatory, not either/or.';
  } else if (!isEmail(r.email)) errors.email = 'Enter a valid email address.';
  return errors;
}

export function refereeComplete(r: Referee): boolean {
  return Object.keys(refereeErrors(r)).length === 0;
}

/** Both complete, and not the same person twice. */
export function referencesReady(refs: readonly Referee[]): boolean {
  if (refs.length !== 2 || !refs.every(refereeComplete)) return false;
  const [a, b] = refs as [Referee, Referee];
  return a.email.trim().toLowerCase() !== b.email.trim().toLowerCase();
}

// ---------------------------------------------------------------------
// Bank & payroll (§2.10, step 9/11) — format only; no bank lookup exists
// ---------------------------------------------------------------------

export function normaliseSortCode(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function formatSortCode(raw: string): string {
  const d = normaliseSortCode(raw);
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : raw;
}

export function bankErrors(b: {
  accountHolder: string;
  sortCode: string;
  accountNumber: string;
}): Partial<Record<'accountHolder' | 'sortCode' | 'accountNumber', string>> {
  const errors: Partial<Record<'accountHolder' | 'sortCode' | 'accountNumber', string>> = {};
  if (!b.accountHolder.trim()) errors.accountHolder = 'Please enter the name on the account.';
  if (normaliseSortCode(b.sortCode).length !== 6)
    errors.sortCode = 'A sort code is six digits, e.g. 40-47-84.';
  if (!/^\d{8}$/.test(b.accountNumber.replace(/\s/g, ''))) {
    errors.accountNumber = 'An account number is eight digits.';
  }
  return errors;
}

// ---------------------------------------------------------------------
// Which step is open (§10.3, §2.3, §2.9)
// ---------------------------------------------------------------------

export type OnboardingStatus =
  | 'interview_requested'
  | 'interview_completed'
  | 'documents'
  | 'quiz'
  | 'additional_info'
  | 'contract'
  | 'compliant'
  | 'blocked'
  | 'rejected'
  | 'inactive'
  | 'removed';

/** What the database has recorded for this period of onboarding. */
export interface WizardFacts {
  status: OnboardingStatus;
  rtwDone: boolean;
  addressDone: boolean;
  selfieDone: boolean;
  /** "Submit documents" pressed on step 4. */
  documentsSubmitted: boolean;
  inductionDone: boolean;
  quizPassed: boolean;
  hmrcDone: boolean;
  referencesDone: boolean;
  bankDone: boolean;
  contractSigned: boolean;
  tutorialDone: boolean;
}

export type WizardPhase =
  /** Before Willo's accept: nothing to do in the app yet (§2.4). */
  | 'awaiting_interview'
  /** A step is waiting on the worker. */
  | 'in_progress'
  /** Step 4 submitted; steps 5–11 unlock once every document is verified (§2.9). */
  | 'awaiting_review'
  /** Onboarding finished — the working app takes over. */
  | 'complete'
  /** Rejected, blocked, left or removed: the app lock decides the screen (§10.1). */
  | 'closed';

export function wizardPhase(f: WizardFacts): WizardPhase {
  switch (f.status) {
    case 'interview_requested':
    case 'interview_completed':
      return 'awaiting_interview';
    case 'documents':
      return f.documentsSubmitted && f.rtwDone && f.addressDone && f.selfieDone
        ? 'awaiting_review'
        : 'in_progress';
    case 'quiz':
    case 'additional_info':
    case 'contract':
      return 'in_progress';
    case 'compliant':
      return f.tutorialDone ? 'complete' : 'in_progress';
    default:
      return 'closed';
  }
}

function doneList(f: WizardFacts): boolean[] {
  const pastDocuments =
    f.status !== 'documents' &&
    f.status !== 'interview_requested' &&
    f.status !== 'interview_completed';
  return [
    f.rtwDone || pastDocuments,
    f.addressDone || pastDocuments,
    f.selfieDone || pastDocuments,
    f.documentsSubmitted || pastDocuments,
    f.inductionDone || f.quizPassed || f.status === 'contract' || f.status === 'compliant',
    f.quizPassed || f.status === 'contract' || f.status === 'compliant',
    f.hmrcDone || f.status === 'compliant',
    f.referencesDone || f.status === 'compliant',
    f.bankDone || f.status === 'compliant',
    f.contractSigned || f.status === 'compliant',
    f.tutorialDone,
  ];
}

/** Steps finished, 0–11 — the "4 of 11 done" on the paused card. */
export function stepsDone(f: WizardFacts): number {
  const done = doneList(f);
  let n = 0;
  while (n < done.length && done[n]) n += 1;
  return n;
}

/**
 * The step the worker should be on: the first one not yet done — or null
 * when there is nothing for them to do (waiting on the interview or on the
 * office, or finished).
 */
export function currentStep(f: WizardFacts): number | null {
  const phase = wizardPhase(f);
  if (phase !== 'in_progress') return null;
  const n = stepsDone(f) + 1;
  return n <= TOTAL_STEPS ? n : null;
}

export type StepAccess = 'current' | 'done' | 'locked';

/**
 * Can the worker open step n right now?
 *
 *   · a step before the current one is `done` — visible, and editable
 *     only where `canEditStep` says so;
 *   · the current step is open;
 *   · anything later is `locked`. Continue is disabled until a step is
 *     complete (§10.3), so a later step is never reachable by URL either.
 */
export function stepAccess(n: number, f: WizardFacts): StepAccess {
  const done = stepsDone(f);
  if (n <= done) return 'done';
  const current = currentStep(f);
  return current === n ? 'current' : 'locked';
}

/**
 * A finished step the worker may still change, before what depends on it
 * is fixed:
 *   · steps 1–3 until the documents are submitted (the office reviews the
 *     set as one — §2.10);
 *   · steps 7–9 until the contract is signed.
 * The selfie is set once and then locked (§10.1), whatever this says.
 */
export function canEditStep(n: number, f: WizardFacts): boolean {
  if (f.status === 'documents' && !f.documentsSubmitted) return n >= 1 && n <= 4;
  if (f.status === 'contract' && !f.contractSigned) return n >= 7 && n <= 10;
  return false;
}

// ---------------------------------------------------------------------
// The signature stamp (§2.11, §1.8 audit)
// ---------------------------------------------------------------------

/**
 * "18.09.2026 14:42 UK time". An audit stamp: always Europe/London, never
 * the viewer's zone, because "the hour must read identically to everyone
 * who opens that file" (§1.8).
 */
export function signatureStamp(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')} UK time`;
}

export function signatureLine(instant: Date): string {
  return `Signed electronically · ${signatureStamp(instant)} — this timestamp is your signature`;
}

// ---------------------------------------------------------------------
// The agreement's placeholder flag (§2.11)
// ---------------------------------------------------------------------

/**
 * THC's own agreement (migration 20260930140100). It is flagged
 * is_placeholder for one reason: clause 28, the ongoing duty to disclose
 * convictions that §2.11 requires, is the build team's wording and awaits
 * THC's approval. Both apps name clause 28 for THIS version only; any other
 * flagged version gets the generic draft note. Publishing THC's approved
 * text is a new, unflagged version, and the note goes away by itself.
 */
export const CONTRACT_VERSION_CLAUSE_28_PENDING = 'thc-agency-worker-2026-09';

export function contractClause28Pending(version: string | null | undefined): boolean {
  return version === CONTRACT_VERSION_CLAUSE_28_PENDING;
}
