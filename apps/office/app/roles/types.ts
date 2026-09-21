/**
 * The row shapes /roles reads, mirroring `role_directory_v`
 * (20260921153000_roles_directory.sql).
 *
 * Money arrives from PostgREST as a number of pounds; the screen works in
 * pence (`money.ts`), so nothing here is added or compared as a float.
 */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  /** Base £/h. The worker only ever sees this one (§9.8, §10.1). */
  pay_rate: number;
  /** The 12.07% element, broken out (§9.8). */
  holiday_rate: number;
  /** Base + holiday. Every margin in the system is computed from it. */
  final_rate: number;
  /** How many clients carry this role on their rate card (§9.7). */
  rate_card_count: number;
  /** How many built role sections use it — half of the delete guard. */
  section_count: number;
}

export interface RoleDraft {
  name: string;
  /** Pence. The action converts to pounds at the boundary. */
  pay_rate_pence: number;
  description: string;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
