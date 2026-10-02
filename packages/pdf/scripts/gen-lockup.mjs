#!/usr/bin/env node
/**
 * Writes packages/pdf/src/lockup.ts from brand/thc-lockup.svg — the stacked
 * THC lockup (mark above the wordmark) printed at the top of every name
 * badge (ADR-0081).
 *
 *   node packages/pdf/scripts/gen-lockup.mjs && npx prettier --write packages/pdf/src/lockup.ts
 *
 * The SVG is plain <path> elements on one viewBox, no transforms, filled
 * with currentColor (brand/README.md), so the paths can be drawn by
 * react-pdf's <Svg>/<Path> as they are. Regenerate from the brand file,
 * never by hand — the same rule as logo.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const svg = readFileSync(join(root, 'brand', 'thc-lockup.svg'), 'utf8');

const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
if (!viewBox) throw new Error('brand/thc-lockup.svg has no viewBox');
if (/transform=/.test(svg))
  throw new Error('brand/thc-lockup.svg has a transform; flatten it first');

const paths = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) throw new Error('brand/thc-lockup.svg has no paths');

const out = `/**
 * The stacked THC lockup — mark above "The Hospitality Company" — for the
 * top of a name badge (ADR-0081).
 *
 * GENERATED from \`brand/thc-lockup.svg\` by \`scripts/gen-lockup.mjs\` (then
 * prettier); do not edit by hand. The paths carry no colour: the badge
 * fills them.
 */
export const LOCKUP_VIEW_BOX = ${JSON.stringify(viewBox)};

export const LOCKUP_PATHS: readonly string[] = ${JSON.stringify(paths, null, 2)};
`;

writeFileSync(join(root, 'packages', 'pdf', 'src', 'lockup.ts'), out);
console.warn(`lockup.ts: ${paths.length} paths, viewBox ${viewBox}`);
