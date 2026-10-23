'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { staffAppOrigin } from '@thc/db';
import { READ_ONLY_MESSAGE, officeMayWrite, sessionIsAdmin } from '../_lib/sessionRole';
import { staffUrlIsOffice } from '../_lib/staffUrl';
import { scanOutcomeMessage } from './messages';
import type { ScanSummary } from './messages';
import type { ActionResult } from './types';

/**
 * "Retry AI scan" (§2.6, ADR-0033). The reader lives in the Staff App, so
 * this checks the caller is an office login that may write (the service
 * call has no session of its own), then asks the Staff App to read the
 * document again with `DOCUMENT_RESCAN_SECRET` (the same value on both
 * Vercel projects). Pre-fill only: nothing here verifies anything, and the
 * database never lets a read overwrite a document already decided.
 */

const PATH = '/api/internal/rescan-document';
/** A read is up to 45 s an attempt with one retry. */
const TIMEOUT_MS = 100_000;

const REFUSALS: Record<string, string> = {
  not_configured: 'The AI re-scan is not set up yet (DOCUMENT_RESCAN_SECRET is missing).',
  unauthorised:
    'The AI re-scan refused the request — check DOCUMENT_RESCAN_SECRET matches on both apps.',
  extractor_off: 'The AI reader is switched off on the Staff App.',
  already_decided: 'This document has already been decided, so it cannot be re-read.',
  no_file: 'This document has no file to read.',
  unknown_document: 'That document could not be found.',
  scan_failed: 'The AI scan did not complete. Try again in a minute.',
};

export async function rescanDocument(docId: string): Promise<ActionResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { ok: false, message: 'This environment has no Supabase project.' };
  }
  const supabase = createClient(await cookies());
  if (!(await sessionIsAdmin(supabase))) {
    return { ok: false, message: 'Only the office can re-scan a document.' };
  }
  if (!(await officeMayWrite(supabase))) return { ok: false, message: READ_ONLY_MESSAGE };

  const origin = staffUrlIsOffice() ? null : staffAppOrigin(process.env['NEXT_PUBLIC_STAFF_URL']);
  const secret = process.env['DOCUMENT_RESCAN_SECRET'];
  if (!origin || !secret) return { ok: false, message: REFUSALS['not_configured']! };

  let body: { ok?: boolean; reason?: string } & Partial<ScanSummary>;
  try {
    const response = await fetch(`${origin}${PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, message: REFUSALS['scan_failed']! };
  }

  if (!body.ok) {
    return { ok: false, message: REFUSALS[body.reason ?? ''] ?? REFUSALS['scan_failed']! };
  }
  revalidatePath('/compliance');
  revalidatePath('/staff', 'layout');
  revalidatePath('/onboarding', 'layout');
  return {
    ok: true,
    message: scanOutcomeMessage({
      confidence: body.confidence ?? 0,
      expiryFound: body.expiryFound === true,
      reasons: body.reasons ?? [],
    }),
  };
}
