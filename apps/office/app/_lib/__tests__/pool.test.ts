import { describe, expect, it } from 'vitest';
import { BULK_CONCURRENCY, mapPool } from '../pool';

/**
 * The bulk actions' bounded concurrency (go-live audit 17.10.2026, M5): at
 * most `limit` calls in flight, every result in its item's place, and a
 * stop that starts nothing new.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('mapPool', () => {
  it('never has more than the limit in flight, and keeps the order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, n) => n);
    const results = await mapPool(items, BULK_CONCURRENCY, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBe(BULK_CONCURRENCY);
    expect(results).toEqual(items.map((n) => n * 2));
  });

  it('runs them together, not one after another', async () => {
    const started: number[] = [];
    await mapPool([1, 2, 3], 8, async (n) => {
      started.push(n);
      await tick();
      return n;
    });
    expect(started).toEqual([1, 2, 3]);
  });

  it('a stop starts nothing new; what never started is undefined', async () => {
    const items = Array.from({ length: 30 }, (_, n) => n);
    const results = await mapPool(
      items,
      2,
      async (n) => {
        await tick();
        return n;
      },
      (n) => n === 3,
    );
    expect(results.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(results.filter((r) => r === undefined).length).toBeGreaterThan(20);
  });

  it('an empty list is an empty result', async () => {
    expect(await mapPool([], 8, async () => 1)).toEqual([]);
  });
});
