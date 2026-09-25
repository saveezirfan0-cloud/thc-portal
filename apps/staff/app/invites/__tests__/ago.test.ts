import { describe, expect, it } from 'vitest';
import { invitedAgo } from '../ago';

/** wireframes/staff/invites.html: "Invited 2 h ago", "Invited yesterday". */
const NOW = new Date('2026-09-25T14:00:00Z'); // 15:00 UK
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('invitedAgo()', () => {
  it('counts minutes under the hour', () => {
    expect(invitedAgo(ago(0), NOW)).toBe('Invited just now');
    expect(invitedAgo(ago(25), NOW)).toBe('Invited 25 min ago');
  });

  it('counts hours for the rest of the same UK day', () => {
    expect(invitedAgo(ago(120), NOW)).toBe('Invited 2 h ago');
    expect(invitedAgo(ago(14 * 60), NOW)).toBe('Invited 14 h ago'); // 01:00 UK today
  });

  it('says "yesterday" for the previous UK day, however few hours ago', () => {
    expect(invitedAgo(ago(15 * 60 + 30), NOW)).toBe('Invited yesterday'); // 23:30 UK yesterday
    expect(invitedAgo(ago(30 * 60), NOW)).toBe('Invited yesterday');
  });

  it('counts days within the week, then gives the date', () => {
    expect(invitedAgo(ago(3 * 24 * 60), NOW)).toBe('Invited 3 days ago');
    expect(invitedAgo(ago(10 * 24 * 60), NOW)).toBe('Invited 15 Sep');
  });
});
