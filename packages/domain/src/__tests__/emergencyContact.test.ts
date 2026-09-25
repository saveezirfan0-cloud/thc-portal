import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vectors from '../emergencyContact.vectors.json' with { type: 'json' };
import {
  E164_PATTERN,
  isE164,
  normaliseEmergencyPhone,
  validateEmergencyContact,
} from '../emergencyContact';

/**
 * ADR-0037 (docs/18 §2). emergencyContact.vectors.json is the contract
 * between this module and the staff_emergency_contacts CHECKs; pgTAP 650
 * runs the same cases through emergency_contact_vectors.psql.
 */
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-vectors-sql.mjs');
const generated = resolve(
  here,
  '../../../../supabase/tests/_shared/emergency_contact_vectors.psql',
);
const MIGRATION = resolve(
  here,
  '../../../../supabase/migrations/20260930100100_staff_additions_schema.sql',
);

describe('the phone — E.164, the /apply rule', () => {
  it.each(vectors.phones.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(isE164(c.input)).toBe(c.storable);
    expect(normaliseEmergencyPhone(c.input)).toBe(c.normalised);
  });

  it('is the same pattern as the table CHECK', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const m = /constraint staff_emergency_contacts_phone check \(phone ~ '([^']+)'\)/.exec(sql);
    expect(m?.[1]).toBe(E164_PATTERN.source);
  });
});

describe('validateEmergencyContact', () => {
  it.each(vectors.contacts.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = validateEmergencyContact(c.input);
    if (c.errors.length === 0) {
      expect(result).toEqual({
        ok: true,
        value: {
          name: c.input.name.trim(),
          relationship: c.input.relationship.trim(),
          phone: c.phone,
        },
      });
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(c.errors);
    }
  });
});

describe('the generated pgTAP vectors', () => {
  it('match emergencyContact.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout', 'emergencyContact'], {
      encoding: 'utf8',
    });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });
});
