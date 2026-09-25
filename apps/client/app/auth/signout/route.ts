import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearKeepSignedInCookie, clearLegacySessionOnlyCookie } from '@thc/db';
import { createClient } from '@thc/db/server';

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
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
