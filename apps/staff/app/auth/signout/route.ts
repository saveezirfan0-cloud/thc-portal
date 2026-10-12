import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@thc/db/server';
import { clearTimeFormatCookie } from '@thc/db/time-format';

/** Sent with the sign-out redirect. A quoted list, per the header's grammar. */
const CLEAR_SITE_DATA = '"cache"';

export async function POST(request: Request) {
  const store = await cookies();
  const supabase = createClient(store);
  await supabase.auth.signOut();
  // ADR-0085: the clock choice is the person's, not the phone's. Without this
  // the next login on this device would read the last one's until it was changed.
  clearTimeFormatCookie(store);
  // The browser's HTTP cache (and back/forward cache) of this origin goes
  // with the session, so the next person at the device cannot step Back into
  // the last one's pages. Only "cache": "storage" would also wipe the
  // appearance choice in localStorage and unregister the service worker
  // (the Staff App's offline shell and push), none of which is the user's
  // data. The Staff App's own Cache Storage is purged by its worker.
  return NextResponse.redirect(new URL('/login', request.url), {
    status: 303,
    headers: { 'Clear-Site-Data': CLEAR_SITE_DATA },
  });
}
