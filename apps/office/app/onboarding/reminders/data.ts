import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readProblem } from '../../_lib/dbError';
import { supabaseConfigured } from '../../staff/data';
import { parseOnboardingEmailReport } from './reminders';
import type { OnboardingEmailReport } from './reminders';

/**
 * The read behind /onboarding/reminders (ADR-0193): one call to
 * `onboarding_email_report()`, office logins only. If it fails the page still
 * shows and previews every reminder, and says why the numbers are missing.
 */
export interface ReminderPageData {
  report: OnboardingEmailReport | null;
  problem: string | null;
}

interface ReadClient {
  rpc(fn: 'onboarding_email_report'): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

export async function loadReminderPage(): Promise<ReminderPageData> {
  if (!supabaseConfigured()) {
    return {
      report: null,
      problem:
        'This environment has no Supabase project, so the reminder numbers cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as ReadClient;
  const { data, error } = await supabase.rpc('onboarding_email_report');
  return {
    report: error ? null : parseOnboardingEmailReport(data),
    problem: readProblem(error, 'The reminder numbers could not be read'),
  };
}
