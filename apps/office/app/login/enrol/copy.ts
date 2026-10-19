/**
 * The enrol step's words (ADR-0164), in a plain module so the page and the
 * tests read one string. Written in the two-step screens' own voice
 * (/account's panel, /login/verify): what it is, what to install, what to
 * scan, what to type.
 */

export const ENROL_HEADING = 'Set up two-step sign-in';

export const ENROL_INTRO =
  'Every Back Office login now needs two-step sign-in. After your password, you type a 6-digit code from an app on your phone, so someone who learns your password still cannot get in without your phone. It takes two minutes, once.';

/** Under the card, beside "Not you? Sign out". */
export const ENROL_HELP =
  'No phone to hand? Sign out and come back when you have one: nothing in the Back Office opens until two-step sign-in is set up. Ask whoever looks after THC’s system if you are stuck.';
