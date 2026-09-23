#!/usr/bin/env node
/**
 * Fail when a route exists in an app but is not named in the screen inventory.
 *
 * Why this exists
 * ---------------
 * `CLAUDE.md` says a screen is done when it matches its wireframe and its
 * states are listed in `docs/08-screen-inventory.md`. Nothing enforced the
 * second half, so the inventory drifted a long way behind the apps: by 23.09
 * it was missing `/compliance/export`, `/reports/export`, the three
 * `/api/documents` handlers, every `/documents` sub-route, `/offline`,
 * `/privacy`, `/radar/:id`, `/client/events/:id/document` and
 * `/activate/:token` — and it still named `/security` and `/payments`, which
 * the Staff App has never served, because they were nested under `/profile`
 * when they shipped.
 *
 * That is the failure mode worth guarding: not a missing row, but a row that
 * describes a route nobody can reach. A session reads the inventory to decide
 * what is built, and a wrong entry is worse than an absent one.
 *
 * This is deliberately one-directional. It asserts every route on disk is in
 * the document; it does NOT assert the reverse, because the inventory also
 * lists screens that are legitimately not routes — the profile sheet, the four
 * lock states, the P45 flow, the two PDFs — and a planned route that has not
 * been built yet is a to-do, not a build failure.
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const INVENTORY = 'docs/08-screen-inventory.md';
const APPS = ['apps/office/app', 'apps/staff/app', 'apps/client/app'];

/**
 * `/auth/signout` and `/auth/callback` are plumbing, not screens: no wireframe,
 * no state list, nothing a reader of the inventory would look for.
 */
const NOT_SCREENS = [/^\/auth\//];

/** Every `page.tsx` and `route.ts` under a directory, as a Next.js route. */
function routesOf(appDir) {
  const found = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        // Route groups `(name)` and private folders `_name` do not appear in a URL.
        const seg = e.name.startsWith('(') || e.name.startsWith('_') ? '' : `/${e.name}`;
        walk(join(dir, e.name), prefix + seg);
      } else if (e.name === 'page.tsx' || e.name === 'route.ts') {
        found.push(prefix || '/');
      }
    }
  };
  walk(appDir, '');
  // `[id]` in the filesystem is `:id` in the inventory; `[...rest]` likewise.
  return found.map((r) => r.replace(/\[(?:\.\.\.)?(\w+)\]/g, ':$1'));
}

const doc = readFileSync(INVENTORY, 'utf8');
const missing = [];

for (const app of APPS) {
  for (const route of routesOf(app)) {
    if (route === '/') continue; // every app has a root; the inventory covers it in prose
    if (NOT_SCREENS.some((re) => re.test(route))) continue;
    // A bare substring match is right here: the inventory writes routes inside
    // backticks in a table cell, and anything stricter breaks on the rows that
    // legitimately list several routes in one cell.
    if (!doc.includes(route)) missing.push({ app, route });
  }
}

if (missing.length > 0) {
  console.error(`\n${missing.length} route(s) exist but are not named in ${INVENTORY}:\n`);
  for (const { app, route } of missing) {
    console.error(`  ${route}   (${app})`);
  }
  console.error(
    `\nAdd a row for each: route, screen, wireframe, scope §, owning bot.\n` +
      `If it is plumbing rather than a screen, add it to NOT_SCREENS in this script\n` +
      `and say why.\n`,
  );
  process.exit(1);
}

console.log(`✓ ${INVENTORY} names every route in all three apps.`);
