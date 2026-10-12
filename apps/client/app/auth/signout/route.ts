import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearKeepSignedInCookie, clearLegacySessionOnlyCookie } from '@thc/db';
import { createClient } from '@thc/db/server';

/** Sent with the sign-out redirect. A quoted list, per the header's grammar. */
const CLEAR_SITE_DATA = '"cache"';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  await supabase.auth.signOut();
  // The next person at this device starts from the form's default, not from
  // the last user's "Keep me signed in" choice (ADR-0032).
  const preference = clearKeepSignedInCookie();
  cookieStore.set(preference.name, preference.value, preference.options);
  // LEGACY (remove with LEGACY_SESSION_ONLY_COOKIE): #65's marker.
  const legacy = clearLegacySessionOnlyCookie();
  cookieStore.set(legacy.name, legacy.value, legacy.options);
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
