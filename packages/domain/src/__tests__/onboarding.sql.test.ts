import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHARE_CODE_SQL_PATTERN } from '../shareCode.ts';
import { deriveStatement } from '../hmrc.ts';
import {
  CONTRACT_VERSION_CLAUSE_28_PENDING,
  POSTCODE_SQL_PATTERN,
  RELATIVE_SQL_PATTERN,
  UK_PIN_BOUNDS,
  VISA_TYPES,
  requiredDocuments,
} from '../onboarding.ts';
import type { RtwBranch, UkDocChoice } from '../onboarding.ts';

/**
 * The wizard's rules exist twice: here, where the screens read them, and in
 * the onboarding migrations, where the database refuses what breaks them.
 * Two copies drift, so this reads the deployed SQL and holds each literal to
 * its TypeScript twin — the approach staffMachine.sql.test.ts takes for the
 * §2.12 machine.
 */
const MIGRATIONS = join(import.meta.dirname, '../../../../supabase/migrations');
const documents = readFileSync(
  join(MIGRATIONS, '20260923120000_onboarding_wizard_documents.sql'),
  'utf8',
);

describe('share code (§2.5) — SQL and TypeScript agree', () => {
  it('is_valid_share_code() uses the same pattern', () => {
    expect(documents).toContain(`normalise_share_code(p) ~ '${SHARE_CODE_SQL_PATTERN}'`);
  });
});

describe('home address (§10.3 2/11) — SQL and TypeScript agree', () => {
  it('the postcode pattern', () => {
    expect(documents).toContain(`v_pc !~ '${POSTCODE_SQL_PATTERN}'`);
  });
  it('the pin box', () => {
    const b = UK_PIN_BOUNDS;
    expect(documents).toContain(
      `p_lat not between ${b.minLat.toFixed(1)} and ${b.maxLat.toFixed(1)} or p_lng not between ${b.minLng.toFixed(1)} and ${b.maxLng}`,
    );
  });
});

describe('visa types (§2.5 pt 3) — SQL and TypeScript agree', () => {
  it('onboarding_save_right_to_work() accepts exactly the dropdown', () => {
    const list = VISA_TYPES.map((v) => `'${v}'`).join(', ');
    expect(documents).toContain(`not in (${list})`);
  });
});

describe('document sets (§2.5 pts 1–5) — SQL and TypeScript agree', () => {
  // Parse the VALUES list of onboarding_required_docs(): (key, accepts, applies-predicate).
  const start = documents.indexOf('create or replace function public.onboarding_required_docs');
  const block = documents.slice(start, documents.indexOf('$$;', start));
  const values = block.slice(
    block.indexOf('from (values') + 'from (values'.length,
    block.indexOf(') r(req_key'),
  );
  // One row per line that opens with `('`; a predicate may run onto the next line.
  const rows = values
    .split(/\n\s*\('/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const accepts = /array\[([^\]]+)\]/.exec(chunk)?.[1] ?? '';
      const tail = chunk.slice(chunk.indexOf('::doc_type[],') + '::doc_type[],'.length);
      return {
        key: chunk.slice(0, chunk.indexOf("'")),
        accepts: accepts.split(',').map((s) => s.trim().replace(/'/g, '')),
        predicate: tail
          .replace(/\),?\s*$/, '')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    });

  /** Evaluate the SQL predicate for one branch + choice — the only shapes it uses. */
  function applies(predicate: string, branch: RtwBranch, choice: UkDocChoice): boolean {
    return predicate.split(' and ').every((clause) => {
      const eq = /^p_branch = '(\w+)'$/.exec(clause);
      if (eq) return branch === eq[1];
      const inList = /^p_branch in \(([^)]+)\)$/.exec(clause);
      if (inList) return inList[1]!.split(',').some((s) => s.trim() === `'${branch}'`);
      if (clause === "coalesce(p_uk_choice, 'passport') = 'passport'") return choice === 'passport';
      if (clause === "p_uk_choice = 'birth_certificate'") return choice === 'birth_certificate';
      throw new Error(`unrecognised predicate: ${clause}`);
    });
  }

  it('parses every row', () => {
    expect(rows.length).toBe(8);
  });

  const cases: [RtwBranch, UkDocChoice][] = [
    ['uk_irish', 'passport'],
    ['uk_irish', 'birth_certificate'],
    ['eu_settled', 'passport'],
    ['work_visa', 'passport'],
    ['international_student', 'passport'],
    ['dependant_other', 'passport'],
  ];

  it.each(cases)('%s (%s)', (branch, choice) => {
    const sql = rows
      .filter((r) => applies(r.predicate, branch, choice))
      .map((r) => `${r.key}:${r.accepts.join('|')}`);
    const ts = requiredDocuments(branch, choice).map((r) => `${r.key}:${r.accepts.join('|')}`);
    expect(sql).toEqual(ts);
  });
});

const contract = readFileSync(
  join(MIGRATIONS, '20260923120200_onboarding_wizard_contract.sql'),
  'utf8',
);

describe('references (§2.10) — SQL and TypeScript agree', () => {
  it('looks_like_relative() uses the same word list', () => {
    expect(contract).toContain(`~ '${RELATIVE_SQL_PATTERN}'`);
  });
});

describe('HMRC (§2.8) — SQL and TypeScript agree', () => {
  it('hmrc_statement_for() routes as deriveStatement() does', () => {
    const start = contract.indexOf('create or replace function public.hmrc_statement_for');
    const body = contract.slice(start, contract.indexOf('$$;', start)).replace(/\s+/g, ' ');
    expect(body).toContain(
      "when p_q1 is null then null when p_q1 then 'C' when p_q2 is null then null when p_q2 then 'C' when p_q3 is null then null when p_q3 then 'B' else 'A'",
    );
    const cases = [
      [true, null, null, 'C'],
      [false, true, null, 'C'],
      [false, false, true, 'B'],
      [false, false, false, 'A'],
    ] as const;
    for (const [q1, q2, q3, want] of cases) {
      expect(deriveStatement({ q1OtherJob: q1, q2Pension: q2, q3Since6April: q3 })).toBe(want);
    }
  });
});

describe('the agreement awaiting clause 28 (§2.11) — SQL and TypeScript agree', () => {
  it('is the version 20260930140100 publishes, flagged, with clause 28 in it', () => {
    const contract = readFileSync(
      join(MIGRATIONS, '20260930140100_thc_agency_worker_contract.sql'),
      'utf8',
    );
    expect(contract).toContain(`'${CONTRACT_VERSION_CLAUSE_28_PENDING}',`);
    expect(contract).toMatch(/\$contract\$, E'\\n'\),\n\s+now\(\),\n\s+true\n\)/);
    expect(contract).toContain('28. DUTY TO DISCLOSE CRIMINAL CONVICTIONS.');
  });
});
