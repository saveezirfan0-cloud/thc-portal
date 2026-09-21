'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import { SENT_TO_COOKIE, toE164, validate } from './form';
import type { ApplicationValues, ApplyState } from './form';

function read(formData: FormData): ApplicationValues {
  return {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    dialCode: String(formData.get('dialCode') ?? '+44'),
    mobile: String(formData.get('mobile') ?? ''),
    ageBand: String(formData.get('ageBand') ?? ''),
    consent: formData.get('consent') === 'on',
  };
}

/**
 * `packages/db` ships a placeholder `Database` type until the project exists
 * and `pnpm --filter @thc/db gen:types` can run (docs/04), so it declares no
 * functions and `.rpc()` cannot be typed from the schema yet. The one call
 * this page makes is typed by hand here instead of loosening the shared type.
 */
interface RpcClient {
  rpc(
    fn: 'submit_application',
    args: {
      p_first_name: string;
      p_last_name: string;
      p_email: string;
      p_phone: string;
      p_age_band: string;
      p_consent: boolean;
    },
  ): Promise<{ error: { message: string; code?: string } | null }>;
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

  const { error } = await supabase.rpc('submit_application', {
    p_first_name: values.firstName.trim(),
    p_last_name: values.lastName.trim(),
    p_email: email,
    p_phone: toE164(values.dialCode, values.mobile),
    p_age_band: values.ageBand,
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
