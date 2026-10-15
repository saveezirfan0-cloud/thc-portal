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
    /** The countdown's own words take its place (`axlr8Countdown().stops`); this is the fallback. */
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
  /** The owner's firmer line of 14.10.2026, inside the Action required panel. */
  warning:
    'Without clicking the link below, actually taking the online interview and fully onboarding, we will be unable to offer you any more shifts going forwards.',
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

// ---------------------------------------------------------------------
// The countdown to AXLR8 being switched off (owner, 15.10.2026)
// ---------------------------------------------------------------------

/**
 * The day AXLR8 stops working: the owner's date, Sunday 25 October 2026.
 * Every daily email to staff moving onto the new app counts down to it, in
 * UK days, from the moment it is sent.
 */
export const AXLR8_SWITCH_OFF = { date: '2026-10-25', label: 'Sunday 25 October' } as const;

/** Whole UK calendar days from `now` to the switch-off; 0 on the day, negative after. */
export function axlr8DaysLeft(now: Date): number {
  const uk = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = uk.split('-').map(Number) as [number, number, number];
  const [Y, M, D] = AXLR8_SWITCH_OFF.date.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(Y, M - 1, D) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

export interface Axlr8Countdown {
  /** Days left; 0 on the day; negative once it has gone. */
  days: number;
  /** The big number in the tile, or null once it has gone ("Today" on the day). */
  tileNumber: string | null;
  /** Under the number: "Days left", "Day left", "Last day". */
  tileLabel: string | null;
  heading: string;
  subheading: string;
  /** IR1's bold sentence, in place of `stopping.strong`. */
  stops: string;
  preheader: string;
  /** The line the interview reminders (OC1, existing staff) carry. */
  line: string;
}

/** Every countdown wording for `days` left. */
export function axlr8Countdown(days: number): Axlr8Countdown {
  const date = AXLR8_SWITCH_OFF.label;
  if (days < 0) {
    return {
      days,
      tileNumber: null,
      tileLabel: null,
      heading: 'AXLR8 has stopped working',
      subheading: 'Please complete your registration on the new Staff App today',
      stops: `AXLR8 Staff App stopped working on ${date}.`,
      preheader:
        'AXLR8 has stopped working. Please complete your registration on the new THC Staff App today.',
      line: `AXLR8 stopped working on ${date}, so the new Staff App is now the only way to be offered shifts.`,
    };
  }
  const when =
    days === 0
      ? `today, ${date}`
      : days === 1
        ? `tomorrow, ${date}`
        : `in ${days} days, on ${date}`;
  const short = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return {
    days,
    tileNumber: days === 0 ? 'Today' : String(days),
    tileLabel: days === 0 ? 'Last day' : days === 1 ? 'Day left' : 'Days left',
    heading: `AXLR8 stops working ${short}`,
    subheading:
      days === 0
        ? 'Please complete your registration on the new Staff App today'
        : 'Please complete your registration on the new Staff App before then',
    stops: `AXLR8 Staff App will stop working ${when}.`,
    preheader: `AXLR8 stops working ${short}. Please complete your registration on the new THC Staff App today.`,
    line: `AXLR8 stops working ${when}. Please do this before then.`,
  };
}

/**
 * The countdown as register placeholders, worked out when the email is
 * rendered (so a row queued yesterday and sent today counts today):
 * `{axlr8Stops}` for IR1, `{axlr8Line}` for OC1's existing-staff wordings,
 * and `{axlr8Days}` for the HTML's tile.
 */
export function axlr8Values(now: Date): Record<string, string> {
  const c = axlr8Countdown(axlr8DaysLeft(now));
  return { axlr8Stops: c.stops, axlr8Line: c.line, axlr8Days: String(c.days) };
}

/** The plain-text body after the greeting, `{applyLink}` and `{axlr8Stops}` in place. */
export const INVITE_REMINDER_TEXT = [
  C.intro,
  `${C.stopping.lead} {axlr8Stops} ${C.stopping.rest}`,
  C.everyDay,
  `${C.action.label}\n${C.action.lead} ${C.action.accent} ${C.action.rest}\n\n${C.warning}`,
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
