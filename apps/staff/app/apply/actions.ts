'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { callerKey } from '../../lib/callerKey';
import type { HeaderReader } from '../../lib/callerKey';
import { SENT_TO_COOKIE, toE164, validate } from './form';
import type { ApplicationValues, ApplyState } from './form';

function read(formData: FormData): ApplicationValues {
  return {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    dialCode: String(formData.get('dialCode') ?? '+44'),
    mobile: String(formData.get('mobile') ?? ''),
    dob: String(formData.get('dob') ?? ''),
    consent: formData.get('consent') === 'on',
  };
}

/**
 * `packages/db` ships a placeholder `Database` type until the project exists
 * and `pnpm --filter @thc/db gen:types` can run (docs/04), so it declares no
 * functions and `.rpc()` cannot be typed from the schema yet. The one call
 * this page makes is typed by hand here instead of loosening the shared type.
 */
interface RpcError {
  message: string;
  code?: string;
}

interface RpcClient {
  rpc(
    fn: 'apply_caller_check',
    args: { p_caller_hash: string },
  ): Promise<{ data: unknown; error: RpcError | null }>;
  rpc(
    fn: 'submit_application',
    args: {
      p_first_name: string;
      p_last_name: string;
      p_email: string;
      p_phone: string;
      p_dob: string;
      p_consent: boolean;
    },
  ): Promise<{ error: RpcError | null }>;
}

/**
 * The refusal, and the whole of it. It names no limit and no wait — the
 * RPC's retry_after_seconds is for the office's diagnosis, not for the
 * caller — so the endpoint gives away nothing about where the line is.
 */
const TOO_MANY_FROM_CONNECTION =
  'Too many applications from this connection — please try again in a few minutes.';

/**
 * The per-caller limit (ADR-0024, docs/14 D2).
 *
 * `submit_application()` bounds per email and per mobile; this bounds the
 * connection they arrive from, so a caller with a fresh pair every time is
 * bounded too. The key is a salted hash of the client address
 * (lib/callerKey.ts) and the count is in the database, so it holds across
 * every serverless instance.
 *
 * It fails OPEN, and that is the point of it being a separate step: the
 * function not being deployed yet, the network dropping, a malformed
 * answer — each is logged and treated as "allowed". A database hiccup must
 * never turn into a refused applicant; the per-email and per-mobile limits
 * are still in force underneath. A request with no client address at all
 * (only off the platform: a bare `next dev`) is allowed for the reason the
 * lib gives.
 */
async function callerAllowed(supabase: RpcClient, requestHeaders: HeaderReader): Promise<boolean> {
  const key = callerKey(requestHeaders);
  if (!key) {
    console.warn('[apply] no client address on the request — caller limit skipped');
    return true;
  }
  try {
    const { data, error } = await supabase.rpc('apply_caller_check', { p_caller_hash: key });
    if (error) {
      console.warn('[apply] caller limit unavailable — allowing', {
        code: error.code,
        message: error.message,
      });
      return true;
    }
    const verdict = data as { allowed?: unknown } | null;
    return verdict?.allowed !== false;
  } catch (cause) {
    console.warn('[apply] caller limit unavailable — allowing', cause);
    return true;
  }
}

/**
 * Submit an application (§2.1).
 *
 * The validation here is not the form's validation repeated for politeness:
 * it is the second of the three gates §2.1 asks for, and it runs on input
 * that never touched the form. The third is `submit_application()`, which is
 * also where the §2.12 duplicate check lives — deliberately not here, because
 * a returning applicant must be indistinguishable from a new one to anyone
 * holding this page.
 */
export async function apply(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const values = read(formData);
  const errors = validate(values);
  if (Object.keys(errors).length > 0) return { errors, values };

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not wired to a project yet (docs/04). Say so rather than throwing a 500.
    return {
      errors: {},
      values,
      failure: 'Applications are not open yet — this environment has no Supabase project.',
    };
  }

  const email = values.email.trim().toLowerCase();
  const jar = await cookies();
  const supabase = createClient(jar) as unknown as RpcClient;

  // Before the submission, not after: a refused caller creates nothing. It
  // does not look at who is applying, so a returning applicant (§2.12) is
  // treated exactly as a new one and still reaches the ordinary
  // confirmation below.
  if (!(await callerAllowed(supabase, await headers()))) {
    return { errors: {}, values, failure: TOO_MANY_FROM_CONNECTION };
  }

  const { error } = await supabase.rpc('submit_application', {
    p_first_name: values.firstName.trim(),
    p_last_name: values.lastName.trim(),
    p_email: email,
    p_phone: toE164(values.dialCode, values.mobile),
    p_dob: values.dob.trim(),
    p_consent: values.consent,
  });

  if (error) {
    // 22023 is the function's own validation, so its message is copy written
    // for the applicant. Anything else is ours to own, not theirs to read.
    const message =
      error.code === '22023'
        ? error.message
        : 'Something went wrong sending your application. Please try again.';
    return { errors: {}, values, failure: message };
  }

  // The address is shown back on the next screen. It goes in a short-lived
  // cookie rather than the URL so it stays out of browser history, server
  // logs and the referrer sent to the privacy-notice link.
  jar.set(SENT_TO_COOKIE, email, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/apply',
  });

  redirect('/apply/submitted');
}
