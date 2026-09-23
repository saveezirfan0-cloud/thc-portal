import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOKUP_PATH,
  readLookupAnswer,
  runInviteSweep,
  willoApiConfig,
  willoLookupPath,
  willoLookupRequest,
} from '../willo';
import type {
  HttpAnswer,
  HttpGetSpec,
  HttpRequestSpec,
  InviteDue,
  InviteSweepDeps,
  RecordOutcome,
} from '../willo';

/**
 * The "create candidate in Willo" sweep is idempotent across a lost link
 * (ADR-0024, docs/14 §4): Willo creates the candidate — and sends E1 —
 * at most once per onboarding period, whatever fails after it answers.
 *
 * `creates` below counts POSTs to the create endpoint, which is the
 * number of E1s Willo sends.
 */
const env = (vars: Record<string, string>) => (name: string) => vars[name];
const CONFIG = willoApiConfig(env({ WILLO_API_KEY: 'key-1', WILLO_INTERVIEW_KEY: 'int-1' }))!;

function row(over: Partial<InviteDue> = {}): InviteDue {
  return {
    staff_id: 'staff-1',
    first_name: 'Mei',
    last_name: 'Lin',
    email: 'mei@example.com',
    phone: '+447700900001',
    attempt: 1,
    known_candidate_id: null,
    prior_candidate_ids: [],
    ...over,
  };
}

/**
 * A fake Willo + a fake database. Willo remembers every candidate it
 * created with its external id; the database remembers recorded keys the
 * way `willo_invite_created` does (record first, then link).
 */
function world(opts: {
  createAnswer?: () => HttpAnswer;
  lookupAnswer?: (spec: HttpGetSpec) => HttpAnswer;
  recordFails?: number;
  lookupPath?: string | null;
}) {
  const state = {
    creates: 0,
    lookups: 0,
    willo: [] as { key: string; external_id: string }[],
    recorded: [] as string[],
    linked: null as string | null,
    failures: [] as string[],
    recordFailsLeft: opts.recordFails ?? 0,
    logs: [] as string[],
  };
  const deps: InviteSweepDeps = {
    config: CONFIG,
    lookupPath: opts.lookupPath === undefined ? DEFAULT_LOOKUP_PATH : opts.lookupPath,
    async http(spec: HttpRequestSpec | HttpGetSpec) {
      if (spec.method === 'GET') {
        state.lookups += 1;
        if (opts.lookupAnswer) return opts.lookupAnswer(spec);
        const id = decodeURIComponent(new URL(spec.url).searchParams.get('external_id') ?? '');
        return {
          status: 200,
          text: JSON.stringify({ results: state.willo.filter((c) => c.external_id === id) }),
        };
      }
      state.creates += 1;
      if (opts.createAnswer) return opts.createAnswer();
      const body = JSON.parse(spec.body) as { external_id: string };
      const key = `W-${state.creates}`;
      state.willo.push({ key, external_id: body.external_id });
      return { status: 201, text: JSON.stringify({ key }) };
    },
    async recordCreated(_staff, key): Promise<RecordOutcome> {
      if (state.recordFailsLeft > 0) {
        state.recordFailsLeft -= 1;
        return { ok: false, message: 'fetch failed' };
      }
      if (!state.recorded.includes(key)) state.recorded.push(key);
      if (state.linked === key) return { ok: true, outcome: 'already_linked' };
      state.linked = key;
      return { ok: true, outcome: 'linked' };
    },
    async recordFailure(_staff, reason) {
      state.failures.push(reason);
    },
    log(_level, message) {
      state.logs.push(message);
    },
  };
  return { state, deps };
}

describe('the invite sweep (ADR-0024)', () => {
  it('creates once and records + links the key', async () => {
    const { state, deps } = world({});
    const result = await runInviteSweep(deps, [row()]);
    expect(result).toEqual({ due: 1, created: 1, relinked: 0, found: 0, failed: 0 });
    expect(state.creates).toBe(1);
    expect(state.linked).toBe('W-1');
    expect(state.lookups).toBe(0); // a first attempt cannot have created anybody
  });

  it('retries the record in the same run before giving up', async () => {
    const { state, deps } = world({ recordFails: 2 });
    const result = await runInviteSweep(deps, [row()]);
    expect(result.created).toBe(1);
    expect(state.linked).toBe('W-1');
  });

  it('a key already on file this period is linked, never created again', async () => {
    const { state, deps } = world({});
    const result = await runInviteSweep(deps, [row({ attempt: 2, known_candidate_id: 'W-9' })]);
    expect(result.relinked).toBe(1);
    expect(state.creates).toBe(0);
    expect(state.lookups).toBe(0);
    expect(state.linked).toBe('W-9');
  });

  it('THE DEFECT: created in Willo, record lost — the retry finds them by external_id, no second E1', async () => {
    const { state, deps } = world({ recordFails: 3 });
    const first = await runInviteSweep(deps, [row({ attempt: 1 })]);
    expect(first.failed).toBe(1);
    expect(state.creates).toBe(1);
    expect(state.linked).toBeNull();
    expect(state.failures[0]).toMatch(/^created W-1, not recorded/);

    // Next lease: the database knows nothing (the record never landed).
    const second = await runInviteSweep(deps, [row({ attempt: 2 })]);
    expect(second).toEqual({ due: 1, created: 0, relinked: 0, found: 1, failed: 0 });
    expect(state.creates).toBe(1); // still exactly one E1
    expect(state.linked).toBe('W-1');
  });

  it('never creates while it cannot tell whether Willo has them (5xx / network on the lookup)', async () => {
    const { state, deps } = world({ lookupAnswer: () => ({ status: 503, text: 'down' }) });
    const result = await runInviteSweep(deps, [row({ attempt: 2 })]);
    expect(result.failed).toBe(1);
    expect(state.creates).toBe(0);
    expect(state.failures[0]).toMatch(/lookup http_503/);

    const { state: s2, deps: d2 } = world({
      lookupAnswer: () => {
        throw new Error('ECONNRESET');
      },
    });
    await runInviteSweep(d2, [row({ attempt: 3 })]);
    expect(s2.creates).toBe(0);
  });

  it('creates as before when Willo has no such lookup, or it is turned off', async () => {
    const { state, deps } = world({ lookupAnswer: () => ({ status: 405, text: '' }) });
    expect((await runInviteSweep(deps, [row({ attempt: 2 })])).created).toBe(1);
    expect(state.creates).toBe(1);

    const off = world({ lookupPath: null });
    expect((await runInviteSweep(off.deps, [row({ attempt: 2 })])).created).toBe(1);
    expect(off.state.lookups).toBe(0);
  });

  it('does not re-link last period’s interview after a Reset (§2.12)', async () => {
    const { state, deps } = world({
      lookupAnswer: () => ({
        status: 200,
        text: JSON.stringify([{ key: 'W-old', external_id: 'staff-1' }]),
      }),
    });
    const result = await runInviteSweep(deps, [
      row({ attempt: 2, prior_candidate_ids: ['W-old'] }),
    ]);
    expect(result.created).toBe(1);
    expect(state.linked).toBe('W-1');
  });

  it('a recorded-but-not-linked key counts as failed and is not created again', async () => {
    const { state, deps } = world({});
    deps.recordCreated = async () => ({
      ok: true,
      outcome: 'not_linked',
      code: 'not_awaiting_interview',
    });
    const result = await runInviteSweep(deps, [row()]);
    expect(result.failed).toBe(1);
    expect(state.creates).toBe(1);
    expect(state.logs).toContain('[willo-invite] recorded but not linked');
  });

  it('a failed create is recorded for the backoff', async () => {
    const { state, deps } = world({ createAnswer: () => ({ status: 500, text: 'boom' }) });
    const result = await runInviteSweep(deps, [row()]);
    expect(result.failed).toBe(1);
    expect(state.failures[0]).toMatch(/^http_500/);
  });

  it('one bad row does not stop the others', async () => {
    // Row a: the create fails AND its failure cannot be recorded. Row b is fine.
    let calls = 0;
    const { state, deps } = world({
      createAnswer: () => {
        calls += 1;
        return calls === 1
          ? { status: 500, text: '' }
          : { status: 201, text: JSON.stringify({ key: 'W-b' }) };
      },
    });
    deps.recordFailure = async () => {
      throw new Error('db down');
    };
    const result = await runInviteSweep(deps, [row({ staff_id: 'a' }), row({ staff_id: 'b' })]);
    expect(result).toMatchObject({ due: 2, created: 1, failed: 1 });
    expect(state.linked).toBe('W-b');
  });
});

describe('readLookupAnswer', () => {
  it('only accepts a candidate carrying our staff id', () => {
    const everybody = JSON.stringify({
      results: [{ key: 'W-x', external_id: 'someone-else' }, { key: 'W-y' }],
    });
    expect(readLookupAnswer(200, everybody, 'staff-1')).toEqual({ kind: 'none' });
    const ours = JSON.stringify({ data: [{ id: 'W-z', externalId: 'staff-1' }] });
    expect(readLookupAnswer(200, ours, 'staff-1')).toEqual({
      kind: 'found',
      willoCandidateId: 'W-z',
    });
    const single = JSON.stringify({ data: { key: 'W-s', external_id: 'staff-1' } });
    expect(readLookupAnswer(200, single, 'staff-1')).toEqual({
      kind: 'found',
      willoCandidateId: 'W-s',
    });
  });

  it('reads statuses', () => {
    expect(readLookupAnswer(404, '', 's')).toEqual({ kind: 'none' });
    expect(readLookupAnswer(401, '', 's').kind).toBe('unsupported');
    expect(readLookupAnswer(429, '', 's').kind).toBe('retry');
    expect(readLookupAnswer(200, '<html>', 's').kind).toBe('unsupported');
  });

  it('skips excluded keys', () => {
    const two = JSON.stringify([
      { key: 'W-old', external_id: 's' },
      { key: 'W-new', external_id: 's' },
    ]);
    expect(readLookupAnswer(200, two, 's', ['W-old'])).toEqual({
      kind: 'found',
      willoCandidateId: 'W-new',
    });
  });
});

describe('lookup configuration', () => {
  it('defaults, overrides and turns off', () => {
    expect(willoLookupPath(env({}))).toBe(DEFAULT_LOOKUP_PATH);
    expect(willoLookupPath(env({ WILLO_LOOKUP_PATH: '/c?ext={externalId}' }))).toBe(
      '/c?ext={externalId}',
    );
    expect(willoLookupPath(env({ WILLO_LOOKUP_PATH: 'off' }))).toBeNull();
  });

  it('builds a GET with the key in a header and the staff id encoded', () => {
    const spec = willoLookupRequest(CONFIG, DEFAULT_LOOKUP_PATH, 'a b');
    expect(spec.method).toBe('GET');
    expect(spec.url).toContain('/interviews/int-1/candidates/?external_id=a%20b');
    expect(spec.url).not.toContain('key-1');
    expect(spec.headers['Authorization']).toBe('Bearer key-1');
  });
});
