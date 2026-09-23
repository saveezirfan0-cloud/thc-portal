import { describe, expect, it } from 'vitest';
import { pickCheckLog } from '../checkLog';

const refused = (attempted: string) => ({
  check_in_at: null,
  check_out_at: null,
  manager_finish_at: null,
  attempted_at: attempted,
});
const accepted = (at: string, out: string | null = null) => ({
  check_in_at: at,
  check_out_at: out,
  manager_finish_at: null,
  attempted_at: at,
});

describe('the check log the shift screen reads (§1.5: one row per press)', () => {
  it('skips a refused press that comes back first and reads the accepted one', () => {
    // Turned away / outside the geofence at 16:58, then checked in at 17:02.
    const logs = [refused('2026-06-14T15:58:00Z'), accepted('2026-06-14T16:02:00Z')];
    expect(pickCheckLog(logs)).toBe(logs[1]);
    expect(pickCheckLog(logs)?.check_in_at).toBe('2026-06-14T16:02:00Z');
  });

  it('whatever order PostgREST returns them in', () => {
    const logs = [
      accepted('2026-06-14T16:02:00Z', '2026-06-14T22:30:00Z'),
      refused('2026-06-14T15:58:00Z'),
    ];
    expect(pickCheckLog(logs)?.check_out_at).toBe('2026-06-14T22:30:00Z');
    expect(pickCheckLog([...logs].reverse())?.check_out_at).toBe('2026-06-14T22:30:00Z');
  });

  it('takes the EARLIEST check-in, as `order by check_in_at limit 1` does in SQL', () => {
    const late = accepted('2026-06-14T16:40:00Z');
    const early = accepted('2026-06-14T16:05:00Z');
    expect(pickCheckLog([late, early])).toBe(early);
  });

  it('reads nothing at all when every press was refused — never a refused row', () => {
    expect(
      pickCheckLog([refused('2026-06-14T15:58:00Z'), refused('2026-06-14T16:31:00Z')]),
    ).toBeNull();
  });

  it('copes with no logs', () => {
    expect(pickCheckLog([])).toBeNull();
    expect(pickCheckLog(null)).toBeNull();
    expect(pickCheckLog(undefined)).toBeNull();
  });
});
