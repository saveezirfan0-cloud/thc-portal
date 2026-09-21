'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@thc/db/server';
import {
  errorForDatabaseCode,
  MESSAGES,
  summaryMessage,
  validateApplication,
  type ApplicationDraft,
  type ApplyState,
} from './application';
import { DEFAULT_ISO } from './countries';

/**
 * The shape of `submit_application` (migration 0005).
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
  let supabase: ApplicationRpc;
  try {
    supabase = createClient(await cookies()) as unknown as ApplicationRpc;
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
    p_consent: true,
  });

  if (error) {
    const fieldErrors = errorForDatabaseCode(error.message);
    if (Object.keys(fieldErrors).length > 0) {
      return { errors: fieldErrors, summary: summaryMessage(fieldErrors) };
    }
    console.error('submit_application failed', error.message);
    return { errors: {}, summary: MESSAGES.unavailable };
  }

  // `redirect` throws, so it has to sit outside any try/catch.
  redirect(`/apply/submitted?email=${encodeURIComponent(checked.value.email)}`);
}
