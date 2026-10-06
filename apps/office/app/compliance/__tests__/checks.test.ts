import { describe, expect, it } from 'vitest';
import { parseRtwCheckRow } from '../../_lib/rtwCheck';
import type { RtwCheckRow } from '../../_lib/rtwCheck';
import { checkCounts, checkGroup, checkLine, elapsedLabel, filterChecks } from '../checks';

const NOW = '2026-09-30T13:30:00Z';

const check = (over: Record<string, unknown>): RtwCheckRow =>
  parseRtwCheckRow({
    check_id: 'c1',
    document_id: 'd1',
    staff_id: 's1',
    status: 'queued',
    attempts: 0,
    max_attempts: 5,
    created_at: '2026-09-30T13:00:00Z',
    stuck: false,
    ...over,
  })!;

describe('elapsedLabel', () => {
  it('reads in minutes, hours and days', () => {
    expect(elapsedLabel('2026-09-30T13:00:00Z', '2026-09-30T13:00:20Z')).toBe('under a minute');
    expect(elapsedLabel('2026-09-30T13:00:00Z', '2026-09-30T13:12:00Z')).toBe('12 min');
    expect(elapsedLabel('2026-09-30T12:00:00Z', '2026-09-30T13:05:00Z')).toBe('1 h 05 min');
    expect(elapsedLabel('2026-09-28T09:00:00Z', '2026-09-30T13:00:00Z')).toBe('2 d 4 h');
  });
});

describe('the gov.uk check monitor', () => {
  it('groups a stuck check with the problems, not "in progress"', () => {
    expect(checkGroup(check({ status: 'queued' }))).toBe('progress');
    expect(checkGroup(check({ status: 'queued', stuck: true }))).toBe('problems');
    expect(checkGroup(check({ status: 'running' }))).toBe('progress');
    expect(checkGroup(check({ status: 'failed' }))).toBe('problems');
    expect(checkGroup(check({ status: 'needs_review' }))).toBe('review');
    expect(checkGroup(check({ status: 'passed' }))).toBe('finished');
    expect(checkGroup(check({ status: 'rejected' }))).toBe('finished');
  });

  it('counts and filters by group', () => {
    const rows = [
      { check: check({ status: 'queued' }), name: 'A' },
      { check: check({ status: 'failed' }), name: 'B' },
      { check: check({ status: 'needs_review' }), name: 'C' },
    ];
    expect(checkCounts(rows)).toEqual({ progress: 1, review: 1, finished: 0, problems: 1 });
    expect(filterChecks(rows, 'problems').map((r) => r.name)).toEqual(['B']);
    expect(filterChecks(rows, 'all')).toHaveLength(3);
  });

  it('says a first attempt is waiting for the runner, and times it from when it was filed', () => {
    const line = checkLine(check({ status: 'queued' }), NOW);
    expect(line.detail).toContain('Waiting for the next runner pass');
    expect(line.tries).toBe('0 of 5');
    expect(line.elapsed).toBe('30 min');
  });

  it('says a retry failed and when the next try is, with the error', () => {
    const line = checkLine(
      check({
        status: 'queued',
        attempts: 2,
        next_attempt_at: '2026-09-30T13:40:00Z',
        error: 'timeout',
      }),
      NOW,
    );
    expect(line.detail).toContain('Attempt 2 of 5 did not finish');
    expect(line.detail).toContain('trying again at 30.09.2026 14:40 UK time');
    expect(line.detail).toContain('Why: gov.uk did not answer in time');
    expect(line.tries).toBe('2 of 5');
  });

  it('stops the clock at the finish for a finished check', () => {
    const line = checkLine(
      check({ status: 'failed', attempts: 5, finished_at: '2026-09-30T13:10:00Z' }),
      NOW,
    );
    expect(line.elapsed).toBe('10 min');
    expect(line.detail).toContain('Gave up after 5 of 5 attempts');
  });

  it('names a stuck check as not running', () => {
    const line = checkLine(check({ status: 'queued', stuck: true }), NOW);
    expect(line.label).toBe('Not running');
    expect(line.tone).toBe('coral');
    expect(line.detail).toContain('RTW_GOVUK_ENABLED');
  });
});
