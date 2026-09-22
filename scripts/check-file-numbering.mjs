#!/usr/bin/env node
/**
 * Fail when two files in a numbered directory share a number.
 *
 * Why this exists
 * ---------------
 * Four collisions in one afternoon, none of which git reports as a conflict,
 * because the filenames differ:
 *
 *   - two migrations numbered 0005
 *   - three numbered 0006, which took `supabase start` down and with it CI on
 *     main for over an hour, twice
 *   - two pgTAP files numbered 070
 *   - two ADRs numbered 0008
 *
 * Every one had the same shape: parallel sessions each take "the next free
 * number" against a main that moves underneath them, and the clash only
 * surfaces after merge, because on each branch the number really is unique.
 *
 * Timestamps did not fix it on their own — docs/14 O2 records two branches
 * both choosing 20260921150000, to the second. Supabase keys
 * schema_migrations.version on exactly that prefix, so those two would have
 * collided on a primary key rather than merely sorting oddly.
 *
 * So this runs in CI, on the merge result, where the collision actually
 * exists. It is deliberately the first check in the job: it costs
 * milliseconds and the failure it prevents costs three minutes of
 * `supabase start` before anyone learns anything.
 */

import { readdirSync } from 'node:fs';
import { basename } from 'node:path';

/** Each directory, and what the number means there. */
const DIRECTORIES = [
  {
    path: 'supabase/migrations',
    what: 'migration',
    // Supabase keys schema_migrations.version on the leading digits, so a
    // duplicate is a primary key violation, not a style problem.
    why: '`supabase start` applies these in order and keys schema_migrations.version on the leading digits, so the second one to apply violates a primary key and the whole stack fails to come up',
  },
  {
    path: 'supabase/tests',
    what: 'pgTAP file',
    why: 'pg_prove runs these in name order; two with the same number is a merge nobody reviewed',
  },
  {
    path: 'docs/adr',
    what: 'ADR',
    why: 'an ADR number is how every other file cites it, so two of them makes a citation ambiguous',
  },
];

/** The leading digits of a filename, or null if it does not start with any. */
export function numberOf(filename) {
  const match = /^(\d+)/.exec(basename(filename));
  return match ? match[1] : null;
}

/** Group the entries by their leading number, keeping only the clashes. */
export function collisions(filenames) {
  const byNumber = new Map();
  for (const name of filenames) {
    const n = numberOf(name);
    if (n === null) continue;
    byNumber.set(n, [...(byNumber.get(n) ?? []), name]);
  }
  return [...byNumber.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([number, names]) => ({ number, names: names.sort() }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

function listing(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  }
}

function main() {
  let failed = false;

  for (const { path, what, why } of DIRECTORIES) {
    const names = listing(path);
    if (names === null) {
      console.log(`· ${path} does not exist, skipping`);
      continue;
    }

    const clashes = collisions(names);
    if (clashes.length === 0) {
      console.log(`✓ ${path} — ${names.length} files, every number unique`);
      continue;
    }

    failed = true;
    for (const { number, names: clashing } of clashes) {
      console.error(`::error::Two or more files in ${path} are numbered ${number}:`);
      for (const name of clashing) console.error(`::error::    ${name}`);
      console.error(`::error::  Why it matters: ${why}.`);
      console.error(
        `::error::  Fix: the one that landed on main LAST moves to the next free number, and every reference to it moves with it. See docs/14 O2.`,
      );
    }
  }

  if (failed) {
    console.error('\nNumbering collision. See the errors above.');
    process.exit(1);
  }
  console.log('\nNo numbering collisions.');
}

// Only run when executed directly, so the tests can import the helpers.
if (process.argv[1] && process.argv[1].endsWith('check-file-numbering.mjs')) main();
