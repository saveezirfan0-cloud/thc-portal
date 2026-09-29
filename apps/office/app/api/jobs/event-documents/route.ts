import { NextResponse } from 'next/server';
import { createAdminClient } from '@thc/db/admin';
import { generateDocument } from '../../documents/_lib/generate';
import type { DocumentRpc } from '../../documents/_lib/generate';
import { checkJobSecret } from '../_lib/auth';
import { runAutosend } from './_lib/run';
import type { DueRow } from './_lib/run';
import { parseAutosendConfig } from './_lib/schedule';

/**
 * POST /api/jobs/event-documents — the automatic Allocation Timesheet (D1)
 * and Completed Allocation Timesheet (D2), ADR-0074 (THC, 29.09.2026).
 *
 * A job, not a screen: pg_cron calls it every 15 minutes (job_schedules
 * `event-documents`, the vault's office_base_url + this path). It is a Node
 * route in the Back Office rather than an Edge Function because the PDF is
 * drawn by @react-pdf/renderer, which Deno cannot run — the same reason as
 * rtw-check (ADR-0025).
 *
 * Gate: `Authorization: Bearer <RTW_JOB_SECRET>` in constant time — the
 * office job secret rtw-check already uses (shared on purpose, ADR-0074).
 * No Supabase session is involved (middleware lets this path through, POST
 * only). Every database call is the service role through functions only it
 * may call: event_documents_due, event_document_autosend_claim,
 * record_event_document_autosend, queue_event_document_autosend and
 * event_document_autosend_release; the PDF is drawn from
 * event_document_data exactly as the manager's Send draws it.
 *
 * Every run is a job_runs row with its counts, like every other §7 job.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A 60-name sheet draws in a few seconds; a day's 10–15 events fit well inside.
export const maxDuration = 300;
/** Stop starting new PDFs after this; the rest go on the next run. */
const BUDGET_MS = 240_000;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Read through the same generated-types gap every office RPC call works round. */
interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function POST(request: Request) {
  const started = Date.now();
  const gate = checkJobSecret(request.headers.get('authorization'), process.env.RTW_JOB_SECRET);
  if (gate === 'not_configured') {
    return json(503, { error: 'RTW_JOB_SECRET is not set (at least 32 characters)' });
  }
  if (gate === 'unauthorised') return json(401, { error: 'unauthorised' });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return json(503, { error: 'SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set' });
  }
  const db = admin as unknown as RpcClient;

  const run = await db.rpc('job_run_start', { p_job: 'event-documents' });
  if (run.error) return json(500, { error: `job_run_start: ${run.error.message}` });
  const runId = run.data;

  try {
    const config = await db.rpc('document_autosend_config');
    if (config.error) throw new Error(`document_autosend_config: ${config.error.message}`);
    const now = new Date();
    const due = await db.rpc('event_documents_due', { p_now: now.toISOString() });
    if (due.error) throw new Error(`event_documents_due: ${due.error.message}`);

    const counts = await runAutosend({
      now,
      config: parseAutosendConfig(config.data),
      rows: (due.data ?? []) as DueRow[],
      deadline: started + BUDGET_MS,
      claim: async (eventId, kind) => {
        const { data, error } = await db.rpc('event_document_autosend_claim', {
          p_event: eventId,
          p_kind: kind,
          p_now: now.toISOString(),
        });
        if (error) throw new Error(`event_document_autosend_claim: ${error.message}`);
        return data === true;
      },
      generate: async (eventId, kind) => {
        const result = await generateDocument(eventId, kind, 'required', {
          db: admin as unknown as DocumentRpc,
          automatic: true,
        });
        return result.ok && result.documentId
          ? { ok: true, documentId: result.documentId }
          : { ok: false, message: result.ok ? 'not stored' : result.message };
      },
      queue: async (documentId) => {
        const { data, error } = await db.rpc('queue_event_document_autosend', {
          p_document: documentId,
        });
        if (error) throw new Error(error.message);
        return { queued: (data as { queued?: boolean } | null)?.queued === true };
      },
      release: async (eventId, kind, message) => {
        await db.rpc('event_document_autosend_release', {
          p_event: eventId,
          p_kind: kind,
          p_error: message,
        });
      },
      // Event ids, kinds and reasons only — never a name or an address.
      log: (line) => console.warn(line),
    });

    await db.rpc('job_run_finish', { p_id: runId, p_ok: true, p_counts: counts });
    return json(200, { job: 'event-documents', ok: true, counts });
  } catch (cause) {
    // A database error message names functions and codes, not people.
    const message = cause instanceof Error ? cause.message.slice(0, 300) : 'failed';
    await db.rpc('job_run_finish', {
      p_id: runId,
      p_ok: false,
      p_counts: {},
      p_error: message,
    });
    return json(500, { job: 'event-documents', ok: false, error: message });
  }
}
