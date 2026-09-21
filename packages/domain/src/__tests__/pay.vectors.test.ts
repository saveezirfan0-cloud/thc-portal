import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * pay.vectors.json is the single source of truth for §5.1–5.2. pgTAP cannot
 * read it — `supabase test db` runs pg_prove with only supabase/ in reach — so
 * the cases are generated into supabase/tests/_shared/pay_vectors.psql. This
 * test is what stops the copy from going stale: change a vector without
 * regenerating and CI fails here, before the two implementations can disagree
 * in silence.
 */
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-vectors-sql.mjs');
const generated = resolve(here, '../../../../supabase/tests/_shared/pay_vectors.psql');

describe('the generated pgTAP vectors', () => {
  it('match pay.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout'], { encoding: 'utf8' });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });
});
