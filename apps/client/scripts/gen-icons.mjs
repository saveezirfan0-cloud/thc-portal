/**
 * The Client Portal's home-screen icons (ADR-0052) — apps/client/public/
 * icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png.
 *
 * Generated from brand/thc-mark.svg, never hand-placed (brand/README.md,
 * docs/12 § Brand assets). The recipe is the Staff App's launcher icons
 * measured off the shipped files, so the two apps sit side by side on a
 * phone as one family; the home-screen label is what tells them apart:
 *
 *   ground  #3EDCEC  the dark-axis `--cyan` (packages/ui tokens.css)
 *   mark    #04080F  `--on-cyan` on that axis
 *   height  ~61% of the tile for `any` and the Apple icon, ~43% for
 *           `maskable`, so the mark stays inside the 80% safe circle
 *           Android crops to.
 *
 * Every tile is opaque: iOS paints a transparent Apple touch icon black.
 *
 * Rasterised with sharp, which the workspace already carries under Next
 * (nothing declares it), so it is resolved from there rather than added,
 * exactly as apps/staff/scripts/gen-push-badge.mjs does:
 *
 *   node apps/client/scripts/gen-icons.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const PUBLIC = join(HERE, '..', 'public');
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');

const GROUND = { r: 0x3e, g: 0xdc, b: 0xec, alpha: 1 };
const MARK = '#04080f';

const ICONS = [
  { file: 'icon-192.png', size: 192, markHeight: 0.61 },
  { file: 'icon-512.png', size: 512, markHeight: 0.61 },
  { file: 'icon-maskable-512.png', size: 512, markHeight: 0.43 },
  { file: 'apple-touch-icon.png', size: 180, markHeight: 0.59 },
];

const source = readFileSync(join(REPO, 'brand', 'thc-mark.svg'), 'utf8');
// The source inherits CSS `color`; a standalone raster has none to inherit.
const mark = Buffer.from(source.replace('fill="currentColor"', `fill="${MARK}"`));

for (const { file, size, markHeight } of ICONS) {
  const h = Math.round(size * markHeight);
  const inner = await sharp(mark, { density: 600 })
    .resize({ height: h, fit: 'inside' })
    .png()
    .toBuffer();
  const out = join(PUBLIC, file);
  // sharp composites last in its pipeline, so the alpha the overlay brings
  // with it is dropped in a second pass rather than chained.
  const tile = await sharp({
    create: { width: size, height: size, channels: 3, background: GROUND },
  })
    .composite([{ input: inner, gravity: 'centre' }])
    .png()
    .toBuffer();
  writeFileSync(out, await sharp(tile).removeAlpha().png().toBuffer());
  console.warn(`wrote ${out}`);
}
