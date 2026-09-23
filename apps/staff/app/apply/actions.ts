'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { callerKey } from './caller';
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
interface ApplicationArgs {
  p_first_name: string;
  p_last_name: string;
  p_email: string;
  p_phone: string;
  p_dob: string;
  p_consent: boolean;
}

type RpcAnswer = Promise<{ error: { message: string; code?: string } | null }>;

interface RpcClient {
  rpc(fn: 'submit_application', args: ApplicationArgs): RpcAnswer;
}

interface AdminRpcClient {
  rpc(
    fn: 'submit_application_as_caller',
    args: ApplicationArgs & { p_caller_hash: string | null },
  ): RpcAnswer;
}

let warnedNoServiceKey = false;

/**
 * The write, with the per-caller limit when this deployment can apply it
 * (ADR-0024). `submit_application_as_caller` is service-role only — a
 * caller key anyone could send would be a limit anyone could dodge — so
 * it needs SUPABASE_SERVICE_ROLE_KEY. Without the key the form still
 * works through the anon `submit_application`, with the per-email and
 * per-mobile limits only, and says so once in the log.
 */
async function submit(args: ApplicationArgs, jar: Awaited<ReturnType<typeof cookies>>): RpcAnswer {
  if (process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    const { createAdminClient } = await import('@thc/db/admin');
    const admin = createAdminClient() as unknown as AdminRpcClient;
    return admin.rpc('submit_application_as_caller', {
      ...args,
      p_caller_hash: callerKey(await headers()),
    });
  }
  if (!warnedNoServiceKey) {
    warnedNoServiceKey = true;
    console.warn(
      '[apply] SUPABASE_SERVICE_ROLE_KEY is not set — /apply runs without the per-caller throttle (per-email and per-mobile limits still apply).',
    );
  }
  const supabase = createClient(jar) as unknown as RpcClient;
  return supabase.rpc('submit_application', args);
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

  const { error } = await submit(
    {
      p_first_name: values.firstName.trim(),
      p_last_name: values.lastName.trim(),
      p_email: email,
      p_phone: toE164(values.dialCode, values.mobile),
      p_dob: values.dob.trim(),
      p_consent: values.consent,
    },
    jar,
  );

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
