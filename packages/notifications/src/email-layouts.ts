/**
 * How each register email is laid out in HTML (ADR-0071) — presentation
 * only. The words stay in `templates.ts`, held to §8 by `templates.test.ts`;
 * this file adds the two things HTML has that the plain text does not:
 *
 *   eyebrow  the short uppercase label above the title, naming what the
 *            email is about;
 *   buttons  which link placeholders are drawn as the gradient button, and
 *            the button's label. The sentence that carries the link is kept
 *            as written and the URL is printed under the button too, so the
 *            HTML still says everything the text does.
 *
 * The title is the subject line, the body is the register's body split into
 * paragraphs (see `textToBlocks`). E1 is not here: Willo sends it, never us.
 */

import type { EmailBlock } from './email-html.ts';
import { preheaderFrom, renderEmailHtml, textToBlocks } from './email-html.ts';
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
 * The HTML for a register email, from the subject and body it is sent with.
 * `values` are the row's payload, so a button can be matched to the URL its
 * placeholder rendered to.
 */
export function templateEmailHtml(
  code: string,
  subject: string,
  body: string,
  values: Readonly<Record<string, string>>,
  senderAddress: string,
): string {
  const presentation = presentationFor(code);
  const buttons = new Map<string, string>();
  for (const [placeholder, label] of Object.entries(presentation.buttons ?? {})) {
    const url = values[placeholder]?.trim();
    if (url) buttons.set(url, label);
  }
  const blocks: EmailBlock[] = textToBlocks(body, { buttons });
  return renderEmailHtml({
    eyebrow: presentation.eyebrow,
    title: subject,
    blocks,
    senderAddress,
    preheader: preheaderFrom(body),
  });
}
