/**
 * IR1's words (ADR-0122) — the owner's email of 13.10.2026, in the owner's
 * own design (`email-invite-reminder.ts`). One source for both bodies: the
 * register's plain text (`templates.ts`) is built from these, and the HTML
 * draws the same strings, so the two cannot drift apart.
 *
 * Imports nothing, so the register can read it without pulling in the HTML.
 */

export interface InviteReminderStep {
  icon: string;
  title: string;
  /** The text, or — for Apply — the words before and after the link. */
  text: string;
  link?: { words: string; after: string };
}

export const INVITE_REMINDER_COPY = {
  preheader:
    'AXLR8 is being switched off soon. Please complete your registration on the new THC Staff App today.',
  badge: 'Daily reminder',
  heading: 'AXLR8 is being switched off soon',
  subheading: 'Please complete your registration on the new Staff App today',
  intro:
    "This is your daily reminder – we haven't yet received your completed registration on our new Staff App.",
  stopping: {
    lead: 'The',
    strong: 'AXLR8 Staff App will stop working very soon.',
    rest: 'After that, every shift is offered, confirmed and checked in through the new THC Staff App only.',
  },
  everyDay: "You'll receive this reminder each day until you've applied.",
  action: {
    label: 'Action required',
    lead: 'In order to be able to continue to offer you shifts and ensure that payments are made correctly,',
    accent: 'the following steps must be carried out below',
    rest: 'before AXLR8 stops working.',
  },
  stepsTitle: 'The steps you must complete',
  steps: [
    {
      icon: '📝',
      title: 'Apply',
      text: 'Enter your name, email, mobile number and age on',
      link: {
        words: 'the application page',
        after: 'using this email address, so we can match you to your existing record.',
      },
    },
    {
      icon: '🎥',
      title: 'Record your video interview',
      text: "Willo will email you the link – check your spam or junk folder if you can't see it.",
    },
    {
      icon: '📲',
      title: 'Set your password & install the app',
      text: "We'll email you a password link once your interview is approved.",
    },
    {
      icon: '🧩',
      title: 'Complete your profile',
      text: '11 short steps, about 20–30 minutes, including your bank details, HMRC starter checklist and Right to Work check. Once your documents are verified, your shifts unlock.',
    },
  ] as readonly InviteReminderStep[],
  button: 'Register now',
  whatsapp: {
    title: 'WhatsApp shift messages are stopping',
    text: "Going forwards you will not receive a WhatsApp message to attend a shift. You'll need to confirm and re-confirm your shifts in the Staff App.",
  },
  ready: {
    title: 'Have these ready',
    text: "Passport or EU / EEA ID card, share code (if you're not British or Irish), NI number, two referees' contact details, bank details, and a selfie.",
  },
  help: { title: 'Need help?', text: "Just reply to this email and we'll get you sorted." },
  thanks: 'Thank you for getting this done.',
  signOff: 'Best Wishes',
  signature: 'The Hospitality Company',
} as const;

const C = INVITE_REMINDER_COPY;

/** The plain-text body after the greeting, `{applyLink}` in place. */
export const INVITE_REMINDER_TEXT = [
  C.intro,
  `${C.stopping.lead} ${C.stopping.strong} ${C.stopping.rest}`,
  C.everyDay,
  `${C.action.label}\n${C.action.lead} ${C.action.accent} ${C.action.rest}`,
  `${C.stepsTitle}:`,
  ...C.steps.map(
    (s, i) =>
      `Step ${i + 1}: ${s.title}\n${s.link ? `${s.text} ${s.link.words} ${s.link.after}` : s.text}`,
  ),
  `${C.button}: {applyLink}`,
  `${C.whatsapp.title}\n${C.whatsapp.text}`,
  `${C.ready.title}\n${C.ready.text}`,
  `${C.help.title}\n${C.help.text}`,
  C.thanks,
  `${C.signOff}\n${C.signature}`,
].join('\n\n');
