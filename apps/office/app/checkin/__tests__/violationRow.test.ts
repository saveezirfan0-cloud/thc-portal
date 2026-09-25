import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent, MouseEvent } from 'react';
import { violationRowProps } from '../violationRow';

/**
 * §9.5 / §9.6: the violation log's rows on /checkin and on the profile's
 * Shifts tab behave the same — unresolved entries carry the coral bar, and
 * the whole row opens the detail window, from the keyboard as well.
 */

function key(k: string, target?: object) {
  const currentTarget = {};
  return {
    key: k,
    target: target ?? currentTarget,
    currentTarget,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTableRowElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe('violationRowProps', () => {
  it('highlights an unresolved entry coral and makes it clickable', () => {
    const props = violationRowProps({ resolved: false }, () => {});
    expect(props.className.split(' ')).toEqual(['violation', 'clickable']);
    expect(props.style).toBeUndefined();
    expect(props.tabIndex).toBe(0);
  });

  it('dims a resolved entry, without the coral bar, and it still opens', () => {
    const props = violationRowProps({ resolved: true }, () => {});
    expect(props.className).toBe('clickable');
    expect(props.style).toEqual({ opacity: 0.45 });
    expect(violationRowProps({ resolved: true }, () => {}, 0.6).style).toEqual({ opacity: 0.6 });
  });

  it('opens on a click anywhere on the row', () => {
    const open = vi.fn();
    violationRowProps({ resolved: false }, open).onClick({} as MouseEvent<HTMLTableRowElement>);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens on Enter and Space, and keeps Space from scrolling the page', () => {
    const open = vi.fn();
    const props = violationRowProps({ resolved: false }, open);
    const enter = key('Enter');
    const space = key(' ');
    props.onKeyDown(enter);
    props.onKeyDown(space);
    expect(open).toHaveBeenCalledTimes(2);
    expect(space.preventDefault).toHaveBeenCalled();
  });

  it('ignores other keys, and keys that belong to a control inside the row', () => {
    const open = vi.fn();
    const props = violationRowProps({ resolved: false }, open);
    props.onKeyDown(key('Tab'));
    props.onKeyDown(key('a'));
    props.onKeyDown(key('Enter', { nested: 'button' }));
    expect(open).not.toHaveBeenCalled();
  });
});
