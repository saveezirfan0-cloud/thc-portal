/**
 * The rota guard — University Completion Letter requirement §4, acceptance
 * criteria 1, 4 and 6.
 *
 * "Rota/scheduling engine must warn (or block, configurable) when a shift
 * assignment would breach the worker's current cap."
 *
 * Only ONE of the three limits the requirement's §3 table names is THC's to
 * relax, and this function is where that is decided:
 *
 *   - past the right to work            → always `block` (the hard stop)
 *   - over a Student visa band (10/20)  → always `block` (immigration)
 *   - over the Working Time 48          → `mode`: block (default) or warn
 *
 * The SQL twin is `rota_guard_decide()` in
 * supabase/migrations/20260923100200_rota_guard.sql, and the two are held to
 * the same cases by `rotaGuard.vectors.json` — Vitest here, pgTAP in
 * supabase/tests/362_rota_guard.sql, through a generated
 * `_shared/rota_guard_vectors.psql`.
 */
import type { CapBand } from './cap';

export type RotaGuardMode = 'block' | 'warn';
export type RotaGuardVerdict = 'ok' | 'warn' | 'block';
export type RotaGuardReason = 'rtw_expired' | 'visa_cap' | 'wtr_cap';

export interface RotaGuardInput {
  /** `canRoster()` for the shift's start AND end day — false is the hard stop. */
  canRoster: boolean;
  /** The worker's cap for the shift's week; null is no ceiling. */
  capHours: number | null;
  band: CapBand;
  /** Hours already confirmed in that Mon–Sun week, this shift excluded. */
  bookedHours: number;
  shiftHours: number;
  /** `settings.rota_guard_mode`. Anything but 'warn' is treated as block. */
  mode: RotaGuardMode;
}

export interface RotaGuardResult {
  verdict: RotaGuardVerdict;
  reason: RotaGuardReason | null;
}

/**
 * Bands set by an immigration condition — the Student visa's term time, a
 * work or dependant visa's own hours limit, or no right to work at all —
 * which no setting relaxes.
 */
export const VISA_CAP_BANDS: readonly CapBand[] = [
  'student_term_20',
  'student_term_10',
  'visa_limit',
  'visa_expired_0',
];

export function rotaGuardVerdict(input: RotaGuardInput): RotaGuardResult {
  if (!input.canRoster) return { verdict: 'block', reason: 'rtw_expired' };
  if (input.capHours === null) return { verdict: 'ok', reason: null };
  const remaining = Math.max(0, input.capHours - input.bookedHours);
  if (input.shiftHours <= remaining) return { verdict: 'ok', reason: null };
  if (VISA_CAP_BANDS.includes(input.band)) return { verdict: 'block', reason: 'visa_cap' };
  return input.mode === 'warn'
    ? { verdict: 'warn', reason: 'wtr_cap' }
    : { verdict: 'block', reason: 'wtr_cap' };
}

/** What the office is told when the database refuses a confirmation. */
export function rotaGuardMessage(reason: RotaGuardReason): string {
  switch (reason) {
    case 'rtw_expired':
      return 'This shift is past the worker’s right-to-work expiry. They cannot be rostered for it.';
    case 'visa_cap':
      return 'This shift takes the worker over their Student visa weekly limit. They cannot be rostered for it.';
    case 'wtr_cap':
      return 'This shift takes the worker over the 48-hour weekly limit and no opt-out is in force.';
  }
}
