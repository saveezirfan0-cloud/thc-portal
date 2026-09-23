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
