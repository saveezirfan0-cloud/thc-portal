/**
 * The Health & Safety induction deck — §10.3 5/11.
 *
 *   "the induction deck supplied by THC, shown slide by slide in the app's
 *    built-in viewer. The supplied file is used as-is; re-drawing the
 *    induction content as native app screens is not in scope for v1."
 *
 * THC's deck is shown as supplied: each page exported to
 * `apps/staff/public/induction/slide-NN.webp` and listed below with `image`.
 * The quiz is THC's own ten questions (quiz_questions, 20260930140000);
 * several are not answered by this deck — docs/17 item 9.
 */

export interface InductionSlide {
  section: string;
  title: string;
  /** Stand-in text. Ignored once `image` is set. */
  body?: string;
  /** A page of THC's deck, as supplied, under /public. */
  image?: string;
}

export const INDUCTION_IS_PLACEHOLDER = false;

/**
 * THC's own deck, "General Health & Safety Awareness" (21 slides, supplied
 * 26.09.2026), exported page by page to /public/induction as-is. To replace
 * it, re-export every page of the new file over these and update the titles
 * (the titles are the images' alt text and the slide counter's reading).
 */
export const INDUCTION_DECK: readonly InductionSlide[] = [
  {
    section: 'Welcome',
    title: 'General Health & Safety Awareness',
    image: '/induction/slide-01.webp',
  },
  {
    section: 'Your workplace',
    title: 'Fast-paced, high-energy — and safe by design',
    image: '/induction/slide-02.webp',
  },
  { section: 'Fire safety', title: 'If you discover a fire', image: '/induction/slide-03.webp' },
  {
    section: 'Fire in the workplace',
    title: 'Know your extinguishers',
    image: '/induction/slide-04.webp',
  },
  {
    section: 'Common sense? Or is it?',
    title: '82% of workplace accidents are caused by human error',
    image: '/induction/slide-05.webp',
  },
  { section: 'Manual handling', title: 'Lift and carry safely', image: '/induction/slide-06.webp' },
  {
    section: 'Safe handling of knives',
    title: "Do's and don'ts",
    image: '/induction/slide-07.webp',
  },
  { section: 'Food hygiene', title: 'Standards for all staff', image: '/induction/slide-08.webp' },
  { section: 'Hazardous substances', title: 'Know the labels', image: '/induction/slide-09.webp' },
  {
    section: 'General safety rules',
    title: 'Ten rules for everyone',
    image: '/induction/slide-10.webp',
  },
  { section: 'Part two', title: 'Workplace risk assessments', image: '/induction/slide-11.webp' },
  { section: 'Risk assessment', title: 'Manual handling', image: '/induction/slide-12.webp' },
  { section: 'Risk assessment', title: 'Fire & gas appliances', image: '/induction/slide-13.webp' },
  { section: 'Risk assessment', title: 'Hazardous substances', image: '/induction/slide-14.webp' },
  {
    section: 'Risk assessment',
    title: 'Violence & slippery floors',
    image: '/induction/slide-15.webp',
  },
  { section: 'Risk assessment', title: 'Cuts & lacerations', image: '/induction/slide-16.webp' },
  { section: 'Risk assessment', title: 'Impact & burns', image: '/induction/slide-17.webp' },
  { section: 'Risk assessment', title: 'Noise & electrical', image: '/induction/slide-18.webp' },
  {
    section: 'COSHH risk assessment',
    title: 'Control of Substances Hazardous to Health',
    image: '/induction/slide-19.webp',
  },
  {
    section: 'Safety is everyone’s job',
    title: 'Spot it. Sort it. Report it.',
    image: '/induction/slide-20.webp',
  },
  {
    section: 'You’ve completed the module',
    title: 'Now for the quiz',
    image: '/induction/slide-21.webp',
  },
];

/** "≈ 6 min left" — about 40 seconds a slide. */
export function minutesLeft(index: number, total: number = INDUCTION_DECK.length): number {
  return Math.max(1, Math.ceil(((total - index - 1) * 40) / 60));
}
