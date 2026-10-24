import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@thc/db/admin';
import { XeroClient, XeroError } from '../_lib/client';
import { STATE_COOKIE, xeroEnv } from '../_lib/config';
import { xeroOperator } from '../_lib/gate';
import { supabaseTokenStore } from '../_lib/store';
import type { AdminDb } from '../_lib/store';

/**
 * GET /api/xero/callback — Xero returns here with ?code&state (ADR-0211).
 *
 * Checks, in order: the env, the single-use state cookie (constant time), and
 * that the same owner is still signed in. Then the code is exchanged, the
 * first organisation is taken (its name is shown on the Xero tab) and the
 * tokens are stored through the service role. Connecting to a DIFFERENT
 * organisation from before forgets the saved contact matches, which belong to
 * the old one. No code, token or state is ever logged.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(request: Request, flag: string) {
  const response = NextResponse.redirect(
    new URL(`/settings?tab=xero&xero=${flag}`, request.url),
    303,
  );
  response.cookies.delete({ name: STATE_COOKIE, path: '/api/xero' });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(request: Request) {
  const env = xeroEnv();
  if (!env) return back(request, 'not_configured');

  const url = new URL(request.url);
  const cookie = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`).exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
  if (!sameState(cookie, url.searchParams.get('state'))) return back(request, 'bad_state');
  if (url.searchParams.get('error')) return back(request, 'denied');
  const code = url.searchParams.get('code');
  if (!code) return back(request, 'denied');

  const who = await xeroOperator('owner');
  if (!who.ok) return back(request, who.status === 401 ? 'signed_out' : 'forbidden');

  let admin: AdminDb;
  try {
    admin = createAdminClient() as unknown as AdminDb;
  } catch {
    return back(request, 'not_configured');
  }

  try {
    const client = new XeroClient({ env, store: supabaseTokenStore(admin) });
    const tokens = await client.exchangeCode(code, env.redirectUri);
    const orgs = await client.listConnections(tokens.accessToken);
    const org = orgs[0];
    if (!org) return back(request, 'no_organisation');

    const before = await supabaseTokenStore(admin).load();
    const { error } = await admin.from('xero_connection').upsert({
      id: true,
      tenant_id: org.tenantId,
      tenant_name: org.tenantName || null,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      scopes: tokens.scopes,
      connected_by: who.userId,
      connected_at: new Date().toISOString(),
      refresh_lock_until: null,
    });
    if (error) return back(request, 'failed');
    if (before && before.tenantId !== org.tenantId) {
      await admin
        .from('clients')
        .update({ xero_contact_id: null })
        .not('xero_contact_id', 'is', null);
    }
    return back(request, 'connected');
  } catch (cause) {
    console.error('xero-callback failed', cause instanceof XeroError ? cause.kind : 'error');
    return back(request, 'failed');
  }
}
