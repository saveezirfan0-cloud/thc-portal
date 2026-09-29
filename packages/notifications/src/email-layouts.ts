/**
 * How each register email is laid out in HTML (ADR-0071) — presentation
 * only. The words stay in `templates.ts`, held to §8 by `templates.test.ts`;
 * this file adds the two things HTML has that the plain text does not:
 *
 *   eyebrow  the short uppercase label above the title, naming what the
 *            email is about;
 *   buttons  which link placeholders are drawn as the gradient button (by
 *            placeholder NAME — the only values that ever become links), and
 *            the button's label. The sentence that carries the link is kept
 *            as written and the URL is printed under the button too, so the
 *            HTML still says everything the text does.
 *
 * The title is the subject line; the body's layout is read from the
 * register's template, placeholders in place, and the values are filled in
 * escaped afterwards (see `templateToBlocks`). E1 is not here: Willo sends
 * it, never us.
 */

import type { EmailBlock } from './email-html.ts';
import { preheaderFrom, renderEmailHtml, templateToBlocks } from './email-html.ts';
import type { TemplateCode } from './templates.ts';

export interface EmailPresentation {
  eyebrow: string;
  /** Placeholder name → button label, for the links drawn as a button. */
  buttons?: Readonly<Record<string, string>>;
}

export const EMAIL_PRESENTATION = {
  E2: { eyebrow: 'Your application' },
  E2b: { eyebrow: 'Your application' },
  E3: {
    eyebrow: 'Welcome to THC',
    buttons: { link: 'Set your password', installLink: 'Get the THC Staff App' },
  },
  E4: { eyebrow: 'Health & Safety assessment' },
  E5: { eyebrow: 'Payroll · bank details' },
  E6: { eyebrow: 'Payroll · NI number' },
  E7: { eyebrow: 'Contact details' },
  E8: { eyebrow: 'P45 request' },
  E9: { eyebrow: 'Conviction declared' },
  E10: { eyebrow: 'Self-cancellation' },
  E11: { eyebrow: 'Your login', buttons: { link: 'Set your password' } },
  CL3: { eyebrow: 'Completion letter' },
  CL4: { eyebrow: 'Right to work' },
  CL5: { eyebrow: '48-hour opt-out' },
  CL6: { eyebrow: '48-hour opt-out' },
  RC1: { eyebrow: 'Change request' },
  RC4: { eyebrow: 'Name change' },
  OF5: { eyebrow: 'Cover request' },
} as const satisfies Partial<Record<TemplateCode, EmailPresentation>>;

/** Used only if a new email code is added without an entry above (the test catches that). */
const FALLBACK_EYEBROW = 'The Hospitality Company';

export function presentationFor(code: string): EmailPresentation {
  return Object.prototype.hasOwnProperty.call(EMAIL_PRESENTATION, code)
    ? EMAIL_PRESENTATION[code as keyof typeof EMAIL_PRESENTATION]
    : { eyebrow: FALLBACK_EYEBROW };
}

/**
 * The HTML for a register email. The layout is read from the register's
 * `template` (placeholders in place) and the row's `values` are filled in
 * escaped, so a value can never add a link, a paragraph or a facts row
 * (`templateToBlocks`). `text` is the rendered plain text, used only for the
 * hidden inbox preview line.
 */
export function templateEmailHtml(
  code: string,
  subject: string,
  template: string,
  values: Readonly<Record<string, string>>,
  text: string,
  senderAddress: string,
): string {
  const presentation = presentationFor(code);
  const blocks: EmailBlock[] = templateToBlocks(template, values, {
    buttons: presentation.buttons ?? {},
  });
  return renderEmailHtml({
    eyebrow: presentation.eyebrow,
    title: subject,
    blocks,
    senderAddress,
    preheader: preheaderFrom(text),
  });
}
