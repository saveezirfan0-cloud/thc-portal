import { describe, expect, it } from 'vitest';
import { mapLimit } from '../mapLimit';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mapLimit', () => {
  it('keeps the order of the items', async () => {
    const out = await mapLimit([30, 10, 20], 2, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(['0:30', '1:10', '2:20']);
  });

  it('never has more than `limit` calls in flight', async () => {
    let inFlight = 0;
    let most = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await tick();
      inFlight--;
    });
    expect(most).toBe(3);
  });

  it('handles an empty list and a limit below one', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    expect(await mapLimit(['a', 'b'], 0, async (s) => s.toUpperCase())).toEqual(['A', 'B']);
  });

  it('rejects when a call rejects, as Promise.all does', async () => {
    await expect(
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
