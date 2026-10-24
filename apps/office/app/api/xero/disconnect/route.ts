import { NextResponse } from 'next/server';
import { createAdminClient } from '@thc/db/admin';
import { XeroClient } from '../_lib/client';
import { xeroEnv } from '../_lib/config';
import { sameOrigin, xeroOperator } from '../_lib/gate';
import { supabaseTokenStore } from '../_lib/store';
import type { AdminDb } from '../_lib/store';

/**
 * POST /api/xero/disconnect — forget the connection (ADR-0211): the refresh
 * token is revoked at Xero (best effort) and the row deleted, so nothing is
 * pushed until an owner connects again. Invoices already in Xero stay there;
 * the queue keeps its rows and resumes on reconnect.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ ok: false, error: 'not_permitted' }, { status: 403 });
  const who = await xeroOperator('owner');
  if (!who.ok)
    return NextResponse.json({ ok: false, error: 'not_permitted' }, { status: who.status });
  let admin: AdminDb;
  try {
    admin = createAdminClient() as unknown as AdminDb;
  } catch {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }
  const store = supabaseTokenStore(admin);
  const conn = await store.load();
  const env = xeroEnv();
  if (conn && env) await new XeroClient({ env, store }).revoke(conn.refreshToken);
  const { error } = await admin.from('xero_connection').delete().eq('id', true);
  if (error) return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
