'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import {
  APPLY_EMAIL_COOKIE,
  errorForDatabaseCode,
  MESSAGES,
  summaryMessage,
  validateApplication,
  type ApplicationDraft,
  type ApplyState,
} from './application';
import { DEFAULT_ISO } from './countries';

/**
 * The shape of `submit_application` (migration 0008).
 *
 * `packages/db`'s generated types are still the Phase 0 placeholder
 * (`Functions: Record<string, never>`), so the typed client cannot name an
 * RPC yet. Rather than widen the client to `any`, the one call this page
 * makes is described here. Delete this the moment
 * `pnpm --filter @thc/db gen:types` has been run against a real project.
 */
interface ApplicationRpc {
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
  ): Promise<{ error: { message: string } | null }>;
}

/**
 * Carries the address to the confirmation screen, which echoes it back so
 * the applicant can spot their own typo (§2.7).
 *
 * It is a cookie rather than a query parameter because a live email
 * address in a URL ends up in browser history, in access logs and in any
 * future Referer header, which is not how §1.7 asks personal data to be
 * handled. Scoped to the one path that reads it and short-lived: a
 * Server Component cannot clear a cookie during render, so the expiry is
 * what removes it.
 */
const EMAIL_COOKIE_MAX_AGE_SECONDS = 600;

function draftFrom(formData: FormData): ApplicationDraft {
  return {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    country: String(formData.get('country') ?? '') || DEFAULT_ISO,
    mobile: String(formData.get('mobile') ?? ''),
    ageBand: String(formData.get('ageBand') ?? ''),
    consent: formData.get('consent') === 'on',
  };
}

/**
 * Public application submission (§2.1).
 *
 * Nothing here tells the applicant what happened to their submission
 * beyond "we got it": a returning applicant (§2.12) and a brand-new
 * candidate both land on /apply/submitted, because the applicant is never
 * told why a previous record was blocked. The office sees the difference
 * on the Onboarding screen; the browser cannot.
 */
export async function submitApplication(
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const draft = draftFrom(formData);

  const checked = validateApplication(draft);
  if (!checked.ok) {
    return { errors: checked.errors, summary: summaryMessage(checked.errors) };
  }

  // The anon key is the point: /apply is public, and `submit_application`
  // is `security definer`, so this is the only door into `staff` a
  // logged-out caller has (see 040_rls_anon.sql).
  //
  // `createClient` throws when the environment has no Supabase project
  // (docs/04). Reading the environment through it rather than here is
  // deliberate: `packages/db` looks the variables up dynamically, so the
  // answer is the one the running server has, not the one the machine
  // that built it had.
  const cookieStore = await cookies();

  let supabase: ApplicationRpc;
  try {
    supabase = createClient(cookieStore) as unknown as ApplicationRpc;
  } catch {
    // Say so rather than pretend the application was filed: a silently
    // swallowed application is worse than an honest failure.
    return { errors: {}, summary: MESSAGES.unavailable };
  }

  const { error } = await supabase.rpc('submit_application', {
    p_first_name: checked.value.firstName,
    p_last_name: checked.value.lastName,
    p_email: checked.value.email,
    p_phone: checked.value.phone,
    p_age_band: checked.value.ageBand,
    // Passed through rather than hard-coded, so the SQL consent gate is
    // exercised by the real client and not only by a direct RPC caller.
    p_consent: checked.value.consent,
  });

  if (error) {
    const fieldErrors = errorForDatabaseCode(error.message);
    if (Object.keys(fieldErrors).length > 0) {
      return { errors: fieldErrors, summary: summaryMessage(fieldErrors) };
    }
    console.error('submit_application failed', error.message);
    return { errors: {}, summary: MESSAGES.unavailable };
  }

  cookieStore.set(APPLY_EMAIL_COOKIE, checked.value.email, {
    httpOnly: true,
    sameSite: 'lax',
    // Behind Vercel this is https; over plain http (local, CI) a secure
    // cookie would simply never be stored.
    secure: (await headers()).get('x-forwarded-proto') === 'https',
    path: '/apply/submitted',
    maxAge: EMAIL_COOKIE_MAX_AGE_SECONDS,
  });

  // `redirect` throws, so it has to sit outside any try/catch.
  redirect('/apply/submitted');
}
