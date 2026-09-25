import { describe, expect, it } from 'vitest';
import { MESSAGES, checkedOutOffSiteMessage, rpcMessage } from '../messages';

/**
 * The §5.1 copy for one RPC result. The screen renders whatever this
 * returns into its Alert, so the sentence with the time in it is pinned
 * here rather than through a click.
 */
describe('rpcMessage (§5.1)', () => {
  const hhmm = (iso: string) => `T${iso.slice(11, 16)}`;

  it('quotes the recorded last on-site time for an off-site check-out', () => {
    const text = rpcMessage(
      { messageKey: 'checked_out_off_site', recordedAt: '2026-09-24T16:00:00+00:00' },
      hhmm,
    );
    expect(text).toBe(
      'You checked out away from the venue — we’ve recorded your last time on site, T16:00.',
    );
  });

  it('still reads without a time, and the time is never in the fixed table', () => {
    expect(rpcMessage({ messageKey: 'checked_out_off_site' }, hhmm)).toBe(
      checkedOutOffSiteMessage(null),
    );
    expect(MESSAGES).not.toHaveProperty('checked_out_off_site');
  });

  it('has copy for a check-out pressed before the section starts', () => {
    expect(rpcMessage({ messageKey: 'check_out_not_open' }, hhmm)).toBe(
      'Check-out opens at the scheduled start of your shift.',
    );
  });

  it('is null for an unknown key rather than a stray string', () => {
    expect(rpcMessage({ messageKey: 'something_else' }, hhmm)).toBeNull();
    expect(rpcMessage({}, hhmm)).toBeNull();
  });
});
