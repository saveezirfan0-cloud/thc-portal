/**
 * rtw-check — the gov.uk share-code check's scheduler hop (§2.6, ADR-0025).
 *
 * The check drives a real browser (Playwright + Chromium), which cannot
 * run in a Supabase Edge Function, so the work is done by the Back Office
 * at POST /api/jobs/rtw-check on Vercel's Node runtime. This function is
 * only the relay: pg_cron calls it every minute the way it calls every
 * other job (service-role bearer, job_runs row, install_job_schedules()
 * unchanged), and it forwards one request to the office with its own
 * secret.
 *
 * Why a hop rather than pointing pg_cron at the office directly: the
 * destination and the secret both stay in Supabase secrets, which no
 * admin session can edit. A `settings.office_base_url` row would be
 * admin-writable, and a bearer posted to an admin-writable URL is the
 * hole 20260926130200 (edge_base_url guard) closes for the service key.
 *
 * Secrets (supabase secrets set …):
 *   OFFICE_BASE_URL   https://<back office host>, no trailing slash
 *   RTW_JOB_SECRET    the same value as the office's RTW_JOB_SECRET
 */

import { runJob } from '../_shared/job.ts';

// The office run is one check: a gov.uk session plus one Claude call.
// Well inside the Edge Function wall clock; a slower run is a failure the
// office records itself, so giving up here loses nothing.
const OFFICE_TIMEOUT_MS = 120_000;

Deno.serve((request) =>
  runJob('rtw-check', request, async () => {
    const base = Deno.env.get('OFFICE_BASE_URL') ?? '';
    const secret = Deno.env.get('RTW_JOB_SECRET') ?? '';
    if (!/^https:\/\/[^/\s]+$/.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
      throw new Error('OFFICE_BASE_URL must be https://<host> with no path');
    }
    if (secret.length < 32) throw new Error('RTW_JOB_SECRET is not set (32+ characters)');

    const response = await fetch(`${base}/api/jobs/rtw-check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(OFFICE_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`office runner answered ${response.status}: ${String(body['error'] ?? '')}`);
    }
    return body;
  }),
);
