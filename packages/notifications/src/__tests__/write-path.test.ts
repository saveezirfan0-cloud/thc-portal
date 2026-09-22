import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Nothing in an app may write `notification_outbox` directly — Scope §8.
 *
 * The table is `admin_read`, SELECT only (001_rls_guard assertion 8), and
 * the `authenticated` role holds no table privilege on it at all. A server
 * action that inserts into it as the signed-in manager is refused with
 * `permission denied`, and because nobody checks the result of an insert
 * that was never going to work, the screen reports success and the push is
 * never sent.
 *
 * That is not hypothetical: N11 (time changed), N10b (withdraw) and N12
 * (event cancelled) — all three mandatory — shipped that way and reached
 * nobody until `queue_office_notifications()` gave the office a door.
 *
 * It is a grep because that is what makes it cheap enough to run on every
 * commit, and because the failure it prevents is invisible at runtime.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');

/** Tables an app may never write directly: definer RPCs own these (§8, §1.7, §9.9). */
const OWNED_BY_RPC = ['notification_outbox', 'audit_log', 'report_sends'];

describe('the §8 outbox is written through its RPC, never through the table', () => {
  const sources = globSync('apps/*/app/**/*.{ts,tsx}', { cwd: REPO }).sort();

  it('finds the app sources at all', () => {
    // Guards the guard: a glob that matches nothing passes vacuously.
    expect(sources.length).toBeGreaterThan(0);
  });

  for (const table of OWNED_BY_RPC) {
    it(`no app writes \`${table}\` directly`, () => {
      const offenders = sources.filter((f) => {
        const src = readFileSync(join(REPO, f), 'utf8');
        // `.from('x')` reaching an insert/update/delete/upsert on the same chain.
        return new RegExp(
          `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`,
        ).test(src);
      });
      expect(offenders, `${table} must be written through a security definer RPC`).toEqual([]);
    });
  }
});
