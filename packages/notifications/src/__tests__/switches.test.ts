import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_EMAILS } from '../documents';
import {
  NOTIFICATION_SWITCHES,
  NOTIFICATION_SWITCH_GROUPS,
  SWITCHED_OFF_ERROR,
  isSwitchableCode,
  switchedOff,
} from '../switches';
import { TEMPLATES } from '../templates';

describe('notification switches (ADR-0083)', () => {
  it('has a switch for every code the drain can send, and nothing else', () => {
    const sendable = [
      ...Object.keys(TEMPLATES).filter((code) => code !== 'E1'),
      ...Object.keys(DOCUMENT_EMAILS),
    ].sort();
    expect(NOTIFICATION_SWITCHES.map((s) => s.code).sort()).toEqual(sendable);
  });

  it('lists each code once', () => {
    const codes = NOTIFICATION_SWITCHES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has no switch for E1 — Willo sends it, not us', () => {
    expect(isSwitchableCode('E1')).toBe(false);
  });

  it('groups each code under the channel it is sent on', () => {
    for (const group of NOTIFICATION_SWITCH_GROUPS) {
      for (const item of group.items) {
        const channel =
          item.code in DOCUMENT_EMAILS
            ? 'email'
            : TEMPLATES[item.code as keyof typeof TEMPLATES].channel;
        expect(channel, item.code).toBe(group.channel);
      }
    }
  });

  it('reads only a JSON false as off, as notification_switched_on() does', () => {
    expect(switchedOff({ BG08: false, N5: true, E3: 'false' })).toEqual(['BG08']);
    expect(switchedOff(['BG08'])).toEqual([]);
    expect(switchedOff(null)).toEqual([]);
    expect(switchedOff({ E1: false, NOPE: false })).toEqual([]);
  });

  it('names the reason the claim writes, word for word', () => {
    const sql = readFileSync(
      new URL(
        '../../../../supabase/migrations/20261002113000_notification_switches.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toContain(`error = '${SWITCHED_OFF_ERROR}'`);
  });
});
