import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@thc/db/server';
import { clearTimeFormatCookie } from '@thc/db/time-format';

export async function POST(request: Request) {
  const store = await cookies();
  const supabase = createClient(store);
  await supabase.auth.signOut();
  // ADR-0085: the clock choice is the person's, not the phone's. Without this
  // the next login on this device would read the last one's until it was changed.
  clearTimeFormatCookie(store);
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
