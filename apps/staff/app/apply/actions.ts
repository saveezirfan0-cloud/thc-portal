'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { callerKey } from './caller';
import {
  APPLY_UNAVAILABLE,
  REFERRAL_FIELD,
  SENT_TO_COOKIE,
  referralCodeFrom,
  toE164,
  validate,
} from './form';
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

type RpcAnswer = { error: { message: string; code?: string } | null };

/**
 * `p_referral_code` is 20260930204000's 8th argument (ADR-0046). Typed by
 * hand here, like the rest of this call, until the Phase 2 type regen.
 */
interface AdminRpcClient {
  rpc(
    fn: 'submit_application_as_caller',
    args: ApplicationArgs & { p_caller_hash: string | null; p_referral_code?: string },
  ): Promise<RpcAnswer>;
}

/**
 * The write, always with the per-caller limit (ADR-0024).
 *
 * `submit_application_as_caller` is service-role only — a caller key anyone
 * could send would be a limit anyone could dodge — and since
 * 20260930120200 so is `submit_application` itself: its anon grant was the
 * way round the limit. A deployment without SUPABASE_SERVICE_ROLE_KEY
 * therefore cannot take an application at all, and says so (null) rather
 * than failing inside the database. Every deployed project carries the key
 * (docs/16, environment table); a developer's `supabase start` prints one.
 *
 * The referral code (ADR-0046) rides on the same call. The argument is sent
 * only when there is a code, so a code-less call matches the function
 * whichever migration the database is on; and if the database does not yet
 * know the 8th argument (PostgREST's PGRST202, "no such function"), the
 * application is sent again without it — a referral never costs anybody
 * their application.
 */
async function submit(
  args: ApplicationArgs,
  referralCode: string | null,
): Promise<RpcAnswer | null> {
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    console.error(
      '[apply] SUPABASE_SERVICE_ROLE_KEY is not set — /apply cannot reach submit_application_as_caller (ADR-0024).',
    );
    return null;
  }
  const { createAdminClient } = await import('@thc/db/admin');
  const admin = createAdminClient() as unknown as AdminRpcClient;
  const base = { ...args, p_caller_hash: callerKey(await headers()) };
  if (!referralCode) return admin.rpc('submit_application_as_caller', base);
  const answer = await admin.rpc('submit_application_as_caller', {
    ...base,
    p_referral_code: referralCode,
  });
  if (answer.error?.code === 'PGRST202') return admin.rpc('submit_application_as_caller', base);
  return answer;
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

  const answer = await submit(
    {
      p_first_name: values.firstName.trim(),
      p_last_name: values.lastName.trim(),
      p_email: email,
      p_phone: toE164(values.dialCode, values.mobile),
      p_dob: values.dob.trim(),
      p_consent: values.consent,
    },
    // Shape-checked again here: the hidden field is as editable as any other.
    referralCodeFrom(formData.get(REFERRAL_FIELD)),
  );
  if (!answer) return { errors: {}, values, failure: APPLY_UNAVAILABLE };

  const { error } = answer;
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
  const jar = await cookies();
  jar.set(SENT_TO_COOKIE, email, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/apply',
  });

  redirect('/apply/submitted');
}
