import { describe, expect, it } from 'vitest';
import { capReason } from '../staff';

/**
 * The bands the database's cap_band enum actually returns (0008,
 * 20260922093000). The directory was written against `opted_out_none`, a
 * word the enum never had, so a worker with a signed opt-out read as "cannot
 * be booked" — the opposite of the truth.
 */
describe('capReason — every band the database returns', () => {
  it('reads `uncapped` as no ceiling, not as a cap that cannot be calculated', () => {
    expect(capReason('uncapped', null)).toMatch(/No weekly ceiling/);
  });

  it('names the below-degree-level term band (completion letter requirement §1)', () => {
    expect(capReason('student_term_10', 10, '2026-12-13')).toBe(
      '10 h — term time, below degree level until 13.12.2026',
    );
  });

  it('names an expired right to work as a hard stop (acceptance criterion 6)', () => {
    expect(capReason('visa_expired_0', 0)).toBe('0 h — right to work expired, cannot be rostered');
  });

  it('names a work or dependant visa’s own hours limit (visa_limit, audit D36)', () => {
    expect(capReason('visa_limit', 20)).toBe('20 h — the hours limit on the visa');
  });
});
