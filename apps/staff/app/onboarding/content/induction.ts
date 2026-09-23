/**
 * The Health & Safety induction deck — §10.3 5/11.
 *
 *   "the induction deck supplied by THC, shown slide by slide in the app's
 *    built-in viewer. The supplied file is used as-is; re-drawing the
 *    induction content as native app screens is not in scope for v1."
 *
 * PLACEHOLDER. THC's deck is an Appendix B input this repository does not
 * hold. The viewer is built for it as-is: export each page of the supplied
 * file to `apps/staff/public/induction/slide-01.png` … and list them below
 * with `image`, and the viewer shows the image instead of the text. Until
 * then these slides are short stand-ins so the step can be walked, and the
 * screen says so. The quiz's questions (quiz_questions, likewise flagged
 * is_placeholder) must be replaced from the same source at the same time.
 */

export interface InductionSlide {
  section: string;
  title: string;
  /** Stand-in text. Ignored once `image` is set. */
  body?: string;
  /** A page of THC's deck, as supplied, under /public. */
  image?: string;
}

export const INDUCTION_IS_PLACEHOLDER = true;

export const INDUCTION_DECK: readonly InductionSlide[] = [
  {
    section: 'Section 1 · Welcome',
    title: 'Why health and safety matters at our events',
    body: 'You will work in busy kitchens, bars and halls full of guests. This induction covers what to do to keep yourself, your colleagues and the guests safe.',
  },
  {
    section: 'Section 1 · Welcome',
    title: 'Your responsibilities',
    body: 'Follow the venue briefing and your supervisor’s instructions. If something looks unsafe, stop and tell someone. Never take a risk to save time.',
  },
  {
    section: 'Section 2 · Fire safety',
    title: 'If you discover a fire',
    body: 'Raise the alarm and alert the people around you. Do not try to tackle a fire unless you are trained and it is safe to do so.',
  },
  {
    section: 'Section 2 · Fire safety',
    title: 'Evacuation',
    body: 'Learn the fire exits and the assembly point at the start of every shift. Never block a fire exit, and never use a lift in a fire.',
  },
  {
    section: 'Section 3 · Slips, trips and lifting',
    title: 'Spills and walkways',
    body: 'Put out a wet-floor sign and get a spill cleaned straight away. Keep walkways and exits clear of crates, chairs and cables.',
  },
  {
    section: 'Section 3 · Slips, trips and lifting',
    title: 'Lifting safely',
    body: 'Bend your knees, keep the load close to your body and lift with your legs. Get help with anything heavy or awkward.',
  },
  {
    section: 'Section 4 · Food and allergens',
    title: 'Allergen questions',
    body: 'Never guess. If a guest asks what is in a dish, check the allergen information with the kitchen before they order.',
  },
  {
    section: 'Section 5 · Hazardous substances',
    title: 'Cleaning chemicals',
    body: 'Read the label, wear gloves when told to, never mix products, and put them back where they are stored.',
  },
  {
    section: 'Section 6 · Accidents',
    title: 'First aid and reporting',
    body: 'If you or anyone else is hurt, get the first aider and tell your supervisor. Report near misses too — they prevent the next accident.',
  },
  {
    section: 'Section 6 · Accidents',
    title: 'Before you start the quiz',
    body: 'The quiz that follows is based on these slides. The pass mark is 80% and you have three attempts. You can come back to any slide before you start.',
  },
];

/** "≈ 6 min left" — about 40 seconds a slide. */
export function minutesLeft(index: number, total: number = INDUCTION_DECK.length): number {
  return Math.max(1, Math.ceil(((total - index - 1) * 40) / 60));
}
