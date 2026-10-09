/**
 * 11/11 How it works — the four cards of wireframes/staff/onboarding-3.html.
 * Each states a rule the app enforces elsewhere, in the words the worker
 * will meet it in: Invites (§10.4), the 12:00 "I'm ready" (§3.5), the
 * on-the-day confirm that never releases (§3.5), and check-in (§5.1).
 */
export const TUTORIAL_CARDS = [
  {
    title: 'Invitations arrive as notifications',
    body: 'Open Invites to Accept or Decline. Declining never counts against you. First to accept takes the slot.',
  },
  {
    title: 'The day before, press “I’m ready” by 12:00',
    body: 'The only hard deadline. Miss it and you’re taken off the shift so someone else can be found in time.',
  },
  {
    title: 'On the day, confirm you’re coming',
    body: 'A reminder, not a deadline — it tells the office you’re on your way.',
  },
  {
    title: 'Check in on site with GPS, check out when you finish',
    body: 'Check-in only works within the venue’s radius and locks 30 min after the start. You’re paid the Friday after the week you worked.',
  },
] as const;

/**
 * 11/11 for SpudBros Express staff whose shifts stay on Connecteam
 * (ADR-0106). The four cards above describe THC's invitations, the 12:00
 * "I'm ready" and check-in — none of which this worker will ever meet, and
 * telling them otherwise would be the one promise this app must not make.
 * The words are the onboarding email's.
 */
export const SPUDBROS_TUTORIAL_CARDS = [
  {
    title: 'Your onboarding with us is complete',
    body: 'The office has verified your documents. You can see each document’s status under Profile → Documents.',
  },
  {
    title: 'We’ll tell you if we need anything again',
    body: 'If a document needs another look, the app tells you why and lets you re-upload straight away. Allow notifications so you hear about it at once.',
  },
  {
    title: 'Your shifts stay on Connecteam',
    body: 'Our Staff App is for your onboarding only. You won’t be offered or scheduled SpudBros Express shifts through it — keep using Connecteam for your shifts, shift changes and messages about your work.',
  },
] as const;
