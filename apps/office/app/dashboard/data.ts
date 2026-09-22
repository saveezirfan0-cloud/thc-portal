import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import {
  type FinanceRow,
  type KpiRow,
  type Kpis,
  type UpcomingEvent,
  type UpcomingRow,
  type WeekFinance,
  groupByEvent,
  money,
} from './view-model';

/**
 * Reads for /dashboard — Scope §9.1.
 *
 * Nothing on this screen is counted here. All four KPIs, the weekly money
 * panel and the ten-day list come back already derived from
 * `20260922182000_dashboard_kpis.sql`, because every one of them is a rule
 * the rest of the platform also has to agree with:
 *
 *   · fill counts confirmed bookings against headcount (§3.2);
 *   · final pay is `final_rate()`, §9.8's single definition of the 12.07%
 *     (§1.5 — never blended into the base);
 *   · "this week" and "today" are Europe/London, not the server's zone.
 *
 * A page that added those up in TypeScript would be a second definition of
 * each, and the first one to drift.
 */

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface DashboardData {
  kpis: Kpis | null;
  finance: WeekFinance | null;
  upcoming: UpcomingEvent[];
  /** Set when this environment cannot read the figures at all. */
  problem: string | null;
}

const NO_SUPABASE =
  'This environment has no Supabase project, so the Dashboard has nothing to count. See docs/04-setup-github-vercel-supabase.md.';

const NO_ROWS =
  'The Dashboard read no rows. Every figure on this screen is admin-only, so this is what it looks like signed in as anything else.';

export async function loadDashboard(): Promise<DashboardData> {
  if (!supabaseConfigured()) {
    return { kpis: null, finance: null, upcoming: [], problem: NO_SUPABASE };
  }

  const supabase = createClient(await cookies());

  const [kpis, finance, upcoming] = await Promise.all([
    // maybeSingle: the views return one row to an admin and none to
    // anybody else, which is the access rule, not an error.
    supabase.from('dashboard_kpis_v').select('*').maybeSingle(),
    supabase.from('dashboard_week_finance_v').select('*').maybeSingle(),
    supabase
      .from('dashboard_upcoming_v')
      .select('*')
      // By date, then by the event's own window, then by when the role
      // section starts — the order §9.1 asks for and the order a manager
      // reads the day in.
      .order('event_date', { ascending: true })
      .order('event_starts_at', { ascending: true })
      .order('starts_at', { ascending: true })
      .order('role_name', { ascending: true }),
  ]);

  const failure = kpis.error ?? finance.error ?? upcoming.error;
  if (failure) {
    return { kpis: null, finance: null, upcoming: [], problem: failure.message };
  }

  // The three views are not in the generated `Database` type: they are
  // this migration's and the types are regenerated per migration, not per
  // screen. The row shapes are asserted here and must match
  // 20260922182000_dashboard_kpis.sql.
  const kpiRow = kpis.data as unknown as KpiRow | null;
  const financeRow = finance.data as unknown as FinanceRow | null;
  const rows = (upcoming.data ?? []) as unknown as UpcomingRow[];

  return {
    kpis: kpiRow && {
      asOf: kpiRow.as_of,
      openPositions: kpiRow.open_positions,
      onShiftNow: kpiRow.on_shift_now,
      staffAvailable: kpiRow.staff_available,
      complianceBlocks: kpiRow.compliance_blocks,
    },
    finance: financeRow && {
      weekStart: financeRow.week_start,
      weekEnd: financeRow.week_end,
      events: financeRow.events,
      forecastHours: money(financeRow.forecast_hours),
      chargeTotal: money(financeRow.charge_total),
      baseTotal: money(financeRow.base_total),
      holidayTotal: money(financeRow.holiday_total),
      payTotal: money(financeRow.pay_total),
      marginTotal: money(financeRow.margin_total),
      marginPct: financeRow.margin_pct === null ? null : money(financeRow.margin_pct),
    },
    upcoming: groupByEvent(rows),
    problem: kpiRow ? null : NO_ROWS,
  };
}
