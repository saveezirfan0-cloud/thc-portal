import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capturedApplicant, describeShape } from '../willo';

/**
 * Who a delivery for an UNKNOWN Willo participant is about (ADR-0087).
 * Best effort and defensive: THC's payload is not pinned down (ADR-0066), so
 * the reader looks where a participant's details usually are and must never
 * mistake the reviewer, the interview or the company for the applicant.
 */
const KEY = '5b046807a81e41278fa24f0e8ad8f3fb';
const INTERVIEW = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';

describe('capturedApplicant', () => {
  it('reads first and last name and the email beside the participant’s key', () => {
    const body = JSON.stringify({
      event: 'New Response',
      data: {
        participant: {
          key: KEY,
          first_name: 'Oluwafunmi',
          last_name: 'Shosanya',
          email: 'Funmi.Shosanya@Example.com',
        },
      },
    });
    expect(capturedApplicant(body, KEY)).toEqual({
      name: 'Oluwafunmi Shosanya',
      email: 'funmi.shosanya@example.com',
    });
  });

  it('takes a single name field from the object that holds the key', () => {
    const body = JSON.stringify({
      participant: { id: KEY, name: '  Ana   Acc ', email_address: 'ana@willo.test' },
    });
    expect(capturedApplicant(body, KEY)).toEqual({ name: 'Ana Acc', email: 'ana@willo.test' });
  });

  it('understands flat, prefixed fields and camelCase', () => {
    expect(
      capturedApplicant(
        JSON.stringify({
          candidate_key: KEY,
          candidate_name: 'Ben Req',
          candidate_email: 'ben@willo.test',
        }),
        KEY,
      ),
    ).toEqual({ name: 'Ben Req', email: 'ben@willo.test' });
    expect(
      capturedApplicant(
        JSON.stringify({ data: { participantKey: KEY, firstName: 'Cal', lastName: 'Mis' } }),
        KEY,
      ),
    ).toEqual({ name: 'Cal Mis', email: null });
  });

  it('prefers the nearest object to the key, then falls back to its parents', () => {
    const body = JSON.stringify({
      data: { email: 'parent@willo.test', participant: { key: KEY, name: 'Dee Docs' } },
    });
    expect(capturedApplicant(body, KEY)).toEqual({ name: 'Dee Docs', email: 'parent@willo.test' });
  });

  it('never takes the reviewer, the interview or the company for the applicant', () => {
    const body = JSON.stringify({
      event: 'Stage Change',
      user: { name: 'Sam Reviewer', email: 'sam@thc.example' },
      reviewed_by: { first_name: 'Sam', email: 'sam@thc.example' },
      interview: { key: INTERVIEW, name: 'Hospitality Staff Interview' },
      company: { name: 'The Hospitality Company', email: 'hello@thc.example' },
      data: { stage: { name: 'Accepted' }, participant: { key: KEY } },
    });
    expect(capturedApplicant(body, KEY)).toEqual({ name: null, email: null });
  });

  it('does not trust a bare name outside the object that holds the key', () => {
    const body = JSON.stringify({
      name: 'Hospitality Staff Interview',
      data: { participant: { key: KEY }, stage: { name: 'Accepted' } },
    });
    expect(capturedApplicant(body, KEY).name).toBeNull();
  });

  it('falls back to a name or email elsewhere in the body when nothing sits beside the key', () => {
    const body = JSON.stringify({
      key: KEY,
      details: { applicant: { first_name: 'Gus', last_name: 'Gone', email: 'gus@willo.test' } },
    });
    expect(capturedApplicant(body, KEY)).toEqual({ name: 'Gus Gone', email: 'gus@willo.test' });
  });

  it('keeps only what looks like an address, and tidies and caps the name', () => {
    const body = JSON.stringify({
      participant: { key: KEY, name: `Zed\u0000\n${'x'.repeat(300)}`, email: 'not an address' },
    });
    const found = capturedApplicant(body, KEY);
    expect(found.email).toBeNull();
    expect(found.name).toMatch(/^Zed x+$/);
    expect(found.name!.length).toBe(120);
    expect(
      capturedApplicant(JSON.stringify({ participant: { key: KEY, email: '<a@b.co>' } }), KEY)
        .email,
    ).toBeNull();
  });

  it('never throws: not JSON, not an object, nothing to find', () => {
    expect(capturedApplicant('nope', KEY)).toEqual({ name: null, email: null });
    expect(capturedApplicant('[1,2]', KEY)).toEqual({ name: null, email: null });
    expect(capturedApplicant('{}', KEY)).toEqual({ name: null, email: null });
    expect(capturedApplicant(JSON.stringify({ participant: { key: KEY } }), KEY)).toEqual({
      name: null,
      email: null,
    });
  });

  it('survives a deeply nested body', () => {
    let body: unknown = { key: KEY, email: 'deep@willo.test' };
    for (let i = 0; i < 50; i += 1) body = { a: body };
    expect(() => capturedApplicant(JSON.stringify(body), KEY)).not.toThrow();
  });

  it('leaves the delivery log values-free: the shape never carries what was captured', () => {
    const raw = JSON.stringify({
      event: 'New Response',
      participant: { key: KEY, name: 'Oluwafunmi Shosanya', email: 'funmi@example.com' },
    });
    expect(capturedApplicant(raw, KEY).name).toBe('Oluwafunmi Shosanya');
    const shape = describeShape(raw).join('\n');
    expect(shape).not.toContain('Oluwafunmi');
    expect(shape).not.toContain('example.com');
  });
});

describe('the receiver (supabase/functions/willo-webhook/index.ts)', () => {
  // The Edge Function runs on Deno and cannot be imported here; what it must
  // do with a delivery is pinned by reading it.
  const source = readFileSync(
    new URL('../../../../supabase/functions/willo-webhook/index.ts', import.meta.url),
    'utf8',
  );

  it('never logs the applicant’s name or email', () => {
    const logging = source
      .split('\n')
      .filter((line) => /console\.(log|warn|error|info)/.test(line));
    expect(logging.length).toBeGreaterThan(0);
    for (const line of logging) expect(line).not.toMatch(/applicant|p_name|p_email/);
    // The refusal passes them to the database, once, and nowhere else.
    expect(source.match(/p_name/g)).toHaveLength(1);
  });

  it('records every 500 it answers with willo_record_failure', () => {
    const answers500 = [...source.matchAll(/json\(500,/g)].length;
    // The only bare 500s: the catch-all before a delivery was read, and the
    // body of fail() itself.
    expect(answers500).toBe(2);
    expect(source).toContain("db.rpc('willo_record_failure'");
    for (const code of [
      'plan_failed',
      'record_failed',
      'not_configured',
      'provisioning_failed',
      'accept_failed',
      'refusal_not_recorded',
      'unexpected',
    ]) {
      expect(source).toContain(`'${code}'`);
    }
  });

  it('answers 500, not 200, when it could not write the refusal of an unknown participant', () => {
    expect(source).toMatch(/could not record the refusal[\s\S]{0,300}refusal_not_recorded/);
  });
});
