import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearKeepSignedInCookie } from '@thc/db';
import { createClient } from '@thc/db/server';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  await supabase.auth.signOut();
  // The next person at this device starts from the form's default, not from
  // the last user's "Keep me signed in" choice (ADR-0032).
  const preference = clearKeepSignedInCookie();
  cookieStore.set(preference.name, preference.value, preference.options);
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
