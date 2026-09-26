import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  type FactorLike,
  type TwoStepDecision,
  aalFromAccessToken,
  nextLevelFor,
  twoStepDecision,
  verifiedTotp,
} from './two-step';

export interface TwoStepState {
  user: User | null;
  decision: TwoStepDecision;
  /** The authenticator-app factor the code step challenges. */
  totp: FactorLike | null;
}

/**
 * The same question the middleware asks, for a server component or action:
 * the factor list from `getUser()` (GoTrue's, not the cookie's copy) and the
 * aal claim of the token GoTrue has just accepted (ADR-0051).
 */
export async function readTwoStep(supabase: SupabaseClient): Promise<TwoStepState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, decision: 'pass', totp: null };

  const nextLevel = nextLevelFor(user.factors);
  if (nextLevel !== 'aal2') return { user, decision: 'pass', totp: null };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    user,
    decision: twoStepDecision({
      currentLevel: aalFromAccessToken(session?.access_token),
      nextLevel,
    }),
    totp: verifiedTotp(user.factors),
  };
}
