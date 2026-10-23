/**
 * How each register email is laid out in HTML (ADR-0073) — presentation
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
import { inviteReminderHtml } from './email-invite-reminder.ts';
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
  E5b: { eyebrow: 'Payroll · bank details changed' },
  E6: { eyebrow: 'Payroll · NI number' },
  E7: { eyebrow: 'Contact details' },
  E8: { eyebrow: 'P45 request' },
  E9: { eyebrow: 'Conviction declared' },
  E10: { eyebrow: 'Self-cancellation' },
  E11: { eyebrow: 'Your login', buttons: { link: 'Set your password' } },
  E12: { eyebrow: 'Your onboarding' },
  // ADR-0149: the button appears only on a row that carries `interviewLink`.
  OC1: { eyebrow: 'Your video interview', buttons: { interviewLink: 'Record my video interview' } },
  OC2: {
    eyebrow: 'Set up your account',
    buttons: { link: 'Set your password', installLink: 'Get the THC Staff App' },
  },
  // ADR-0169: OC3 by email, for a candidate with notifications off.
  OC4: { eyebrow: 'Your onboarding', buttons: { link: 'Carry on with onboarding' } },
  // ADR-0122: the daily reminder to THC staff not yet on the new app. Drawn
  // in the owner's own design (email-invite-reminder.ts), not by the blocks
  // below; the entry names its eyebrow and button all the same.
  IR1: { eyebrow: 'Daily reminder', buttons: { applyLink: 'Register now' } },
  CL3: { eyebrow: 'Completion letter' },
  CL4: { eyebrow: 'Right to work' },
  CL5: { eyebrow: '48-hour opt-out' },
  CL6: { eyebrow: '48-hour opt-out' },
  RC1: { eyebrow: 'Change request' },
  RC4: { eyebrow: 'Name change' },
  OF5: { eyebrow: 'Cover request' },
  // ADR-0110: a worker used every attempt at a client's quiz.
  CR3: { eyebrow: 'Client quiz' },
  // ADR-0135 §2: a customer asked for a worker again.
  CP1: { eyebrow: 'Client Portal request' },
  // ADR-0135 §3: to the customer's timesheet recipients.
  CP2: { eyebrow: 'Your line-up', buttons: { link: 'See who is coming' } },
  CP3: { eyebrow: 'Line-up update', buttons: { link: 'See the current line-up' } },
  // ADR-0199: a ticket logged in the Back Office, or an update to one.
  TK1: { eyebrow: 'Back Office ticket' },
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
  // ADR-0122: IR1 is the one email in the owner's own design.
  if (code === 'IR1') {
    return inviteReminderHtml({
      subject,
      name: values.variant === 'named' ? values.name : undefined,
      applyLink: values.applyLink ?? '',
      senderAddress,
      // The countdown the text was rendered with, so the two agree.
      ...(values.axlr8Days !== undefined ? { daysLeft: Number(values.axlr8Days) } : {}),
    });
  }
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
