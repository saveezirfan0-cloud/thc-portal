import { NextResponse } from 'next/server';
import { createAdminClient } from '@thc/db/admin';
import { sameOrigin, xeroOperator } from '../_lib/gate';
import { runXeroSync } from '../_lib/store';
import type { AdminDb } from '../_lib/store';

/**
 * POST /api/xero/sync — the Xero tab's "Sync now" (ADR-0211): one pass of the
 * same push the 15-minute job runs, for a finance login that may write.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ ok: false, error: 'not_permitted' }, { status: 403 });
  const who = await xeroOperator('finance');
  if (!who.ok)
    return NextResponse.json({ ok: false, error: 'not_permitted' }, { status: who.status });
  let admin: AdminDb;
  try {
    admin = createAdminClient() as unknown as AdminDb;
  } catch {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }
  try {
    const result = await runXeroSync(admin, { deadline: Date.now() + 100_000 });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error(
      'xero-sync (manual) failed',
      cause instanceof Error ? cause.message.slice(0, 200) : 'error',
    );
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
