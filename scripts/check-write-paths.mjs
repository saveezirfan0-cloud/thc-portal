#!/usr/bin/env node
/**
 * No app may write an admin-only table directly — Scope §8, §1.7, §9.9.
 *
 * `notification_outbox` is `admin_read`, SELECT only (001_rls_guard
 * assertion 8). A server action that inserts into it as the signed-in
 * manager reaches RLS, finds no INSERT policy, and is rejected — and because
 * nobody checks the result of an insert that was never going to work, the
 * screen reports success and the push is never sent.
 *
 * That is not hypothetical: N10b (withdraw) and N12 (event cancelled), both
 * mandatory, and N11 (time changed) shipped that way and reached nobody
 * until `queue_office_notifications()` gave the office a door.
 *
 * This lives in scripts/ beside check-file-numbering.mjs, and runs as its own
 * CI step, DELIBERATELY. As a vitest in packages/notifications it was hashed
 * on that package alone — turbo declares no `inputs` for `test` — so a
 * reintroduced insert in apps/office would be a cache hit and the guard would
 * never run. A guard that can be skipped is not a guard.
 */
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Written only by `security definer` RPCs and the service role. The seven
 * staff additions (docs/18 §0.2–0.3, 20260930100100) are admin-read with no
 * staff policy at all: the worker's and the office's writes are all RPCs.
 */
const OWNED_BY_RPC = [
  'notification_outbox',
  'audit_log',
  'report_sends',
  'rtw_checks',
  'staff_unavailability',
  'staff_emergency_contacts',
  'profile_change_requests',
  'shift_offers',
  'shift_offer_notices',
  'staff_referral_codes',
  'application_referrals',
];

const sources = globSync(['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'], {
  cwd: REPO,
  exclude: (p) => p.includes('node_modules') || p.includes('/.next/'),
}).sort();

if (sources.length === 0) {
  // Guards the guard: a glob that matches nothing passes vacuously.
  console.error('::error::check-write-paths matched no sources — the glob is wrong');
  process.exit(1);
}

let bad = 0;
for (const table of OWNED_BY_RPC) {
  const re = new RegExp(
    `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`,
  );
  for (const file of sources) {
    if (re.test(readFileSync(join(REPO, file), 'utf8'))) {
      console.error(
        `::error file=${file}::${file} writes \`${table}\` directly. That table is admin-read, ` +
          `so RLS rejects the write at runtime and it fails silently. Use the security definer RPC.`,
      );
      bad += 1;
    }
  }
}

if (bad > 0) process.exit(1);
console.log(`✓ ${sources.length} sources — none writes ${OWNED_BY_RPC.join(', ')} directly`);
