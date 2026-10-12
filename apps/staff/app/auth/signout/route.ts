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
  // No Clear-Site-Data: Chromium holds the navigation while it clears the
  // HTTP cache, which left sign-out stuck on the page it was pressed from.
  // Signed-in pages are rendered per request and sent no-store, so there is
  // no copy of them to clear (the Staff App's Cache Storage is purged by its
  // worker, sw.ts).
  return NextResponse.redirect(new URL('/login', request.url), {
    status: 303,
  });
}
