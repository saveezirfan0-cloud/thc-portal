/**
 * Refer a friend — the pure half of `/profile/refer` (ADR-0040, docs/18 §5,
 * `wireframes/staff/refer.html`).
 *
 * No reward copy anywhere (Q19): THC has not decided one, and a reward
 * written into the app would be a term of engagement nobody agreed. The
 * worker sees a count, never who applied or what happened to them (Q20).
 */

export const INTRO_COPY =
  'Know someone who’d be good at this? Send them your link — they apply in the usual way, and we’ll know you sent them.';

export const EMPTY_TITLE = 'No one yet';
export const EMPTY_COPY = 'When someone applies with your link, you’ll see the count here.';

/** "3 people have applied with your link" — the only thing the worker learns. */
export function appliedLine(applied: number): string {
  return applied === 1
    ? '1 person has applied with your link'
    : `${applied} people have applied with your link`;
}

/** What the Web Share sheet carries. Worker-neutral, and no promise of anything. */
export function shareData(link: string): { title: string; text: string; url: string } {
  return {
    title: 'The Hospitality Company',
    text: 'Apply to work events with The Hospitality Company:',
    url: link,
  };
}

/**
 * The public origin the link is built on (`{origin}/apply?ref={code}`).
 *
 * The configured staff URL wins (docs/16 §3.1 — the address E3 was sent
 * with), then the request's own host (a preview deployment links to
 * itself), then Vercel's, then local dev on :3001.
 */
export function publicOrigin(
  env: { NEXT_PUBLIC_STAFF_URL?: string | undefined; VERCEL_URL?: string | undefined },
  request: { host?: string | null; proto?: string | null } = {},
): string {
  const explicit = env.NEXT_PUBLIC_STAFF_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (request.host) {
    const proto = request.proto?.split(',')[0]?.trim() || 'https';
    return `${proto}://${request.host}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return 'http://127.0.0.1:3001';
}
