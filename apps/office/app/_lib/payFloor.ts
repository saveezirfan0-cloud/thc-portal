import { DEFAULT_PAY_FLOOR_PENCE } from '../roles/money';

/**
 * Today's National Living Wage, in pence, from the database
 * (`minimum_pay_rate()`, `settings.minimum_hourly_pay` — 20261014160000,
 * ADR-0137). The forms use it to refuse a base or personal pay rate below
 * the legal floor before the database does; when it cannot be read they
 * fall back to the 2026/27 figure, and the database still holds the line.
 */
interface FloorRpc {
  rpc(fn: 'minimum_pay_rate'): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function loadPayFloorPence(supabase: unknown): Promise<number> {
  try {
    const { data, error } = await (supabase as FloorRpc).rpc('minimum_pay_rate');
    const pounds = Number(data);
    if (error || data === null || !Number.isFinite(pounds) || pounds <= 0) {
      return DEFAULT_PAY_FLOOR_PENCE;
    }
    return Math.round(pounds * 100);
  } catch {
    return DEFAULT_PAY_FLOOR_PENCE;
  }
}
