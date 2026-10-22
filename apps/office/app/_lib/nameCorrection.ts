import { NAME_CORRECTION_MESSAGES } from '@thc/domain';
import { explainOfficeError } from './permissions';

/**
 * "Correct" on a name — /staff/:id Overview, /onboarding/:id and the
 * /staff/names list (ADR-0193). Pure: the words for the database's refusals
 * and for what happened, so the dialog and its tests read the same sentences.
 *
 * The rule is `validateNameCorrection()` in packages/domain, which
 * `office_correct_name()` repeats; this file only speaks.
 */

/** What `office_correct_name()` returns (20261024100000). */
export interface NameCorrectionAnswer {
  ok?: boolean;
  firstName?: string;
  lastName?: string;
  previousFirstName?: string;
  previousLastName?: string;
}

export type NameCorrectionResult = { ok: true; note: string } | { ok: false; message: string };

const MESSAGES: Readonly<Record<string, string>> = {
  ...NAME_CORRECTION_MESSAGES,
  staff_removed: 'This worker was removed under GDPR; nothing personal can be added back.',
  staff_not_found: 'That profile no longer exists — refresh the page.',
  not_authorised: 'Only the office can do this.',
};

/** A refusal in words a manager can act on; anything unknown as the database said it. */
export function nameCorrectionMessage(raw: string): string {
  const office = explainOfficeError(raw);
  if (office) return office;
  const code = raw.split(':')[0]?.trim() ?? '';
  if (MESSAGES[code]) return MESSAGES[code] as string;
  const key = Object.keys(MESSAGES).find((c) => raw.includes(c));
  return key ? (MESSAGES[key] as string) : raw;
}

/** The line under the name once it is saved. */
export const NAME_CORRECTION_NOTE =
  'Saved. The change is in the activity log with your reason and payroll has been told. No right-to-work check is started: run it again from the Documents tab if the old name was why it did not match.';

/** What a /staff/names row says it needs, in the office's words. */
export const NAME_REVIEW_REASONS: Readonly<Record<string, string>> = {
  initial: 'An initial',
  characters: 'Symbols or digits',
  lower_case: 'All lower case',
  upper_case: 'All upper case',
};
