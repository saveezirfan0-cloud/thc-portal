import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The New Starter job builds a CSV and nothing else. Through the `@thc/pdf`
 * barrel it loaded @react-pdf and pdfkit, whose standard fonts this route is
 * not traced with, and every 15-minute run logged "Cannot find module
 * …/pdfkit/js/standard-fonts/Helvetica.cjs" — 2,680 of them by 17.10.2026
 * (go-live audit M9). It must import the CSV subpath only.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the new-starter-report job imports', () => {
  for (const file of ['route.ts', '_lib/run.ts']) {
    it(`${file} never reaches the @thc/pdf barrel`, () => {
      const src = readFileSync(join(DIR, file), 'utf8');
      expect(src).not.toMatch(/from '@thc\/pdf'/);
    });
  }

  it('and the subpath it uses is exported by the package', () => {
    const pkg = JSON.parse(
      readFileSync(
        join(DIR, '..', '..', '..', '..', '..', '..', 'packages', 'pdf', 'package.json'),
        'utf8',
      ),
    ) as { exports: Record<string, string> };
    expect(pkg.exports['./csv']).toBe('./src/csv.ts');
  });
});
