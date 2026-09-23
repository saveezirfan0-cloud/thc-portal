import { HELP_EMAIL } from '../profile/types';

/**
 * The activation screen's fixed words — wireframes/public/activate.html.
 * Outside actions.ts because a 'use server' module may export only async
 * functions, and the page shows the same sentence the action returns.
 */
export { HELP_EMAIL };

export const EXPIRED_MESSAGE = `This link has expired or has already been used. Write to ${HELP_EMAIL} and we’ll send you a new one.`;

export const PERSONAL_NOTE = 'This link is personal to you and works once.';
