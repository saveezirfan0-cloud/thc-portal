import { MAX_RATE_PENCE } from './money';
import type { RoleDraft } from './types';

/**
 * The form's half of the §9.8 rules. `assert_role_input` and the `roles`
 * constraints reject the same drafts in the database
 * (supabase/tests/150_roles_directory.sql).
 */
export function validateRole(draft: RoleDraft): string | null {
  if (!draft.name.trim()) return 'Give the role a name.';
  if (!Number.isInteger(draft.pay_rate_pence) || draft.pay_rate_pence < 0) {
    return 'Enter a staff pay rate, to the penny.';
  }
  if (draft.pay_rate_pence > MAX_RATE_PENCE) return 'That pay rate is not a realistic hourly rate.';
  return null;
}
