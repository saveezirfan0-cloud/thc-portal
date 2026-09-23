// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Checkbox, Radio } from '../components/Controls';

/**
 * D1 (§1.2): the shared Checkbox and Radio were drawn boxes over a native
 * input with `display: none`, so the keyboard could not reach them and a
 * screen reader did not see them. These drive them the way a keyboard user
 * does — Tab, Space, the arrow keys — and read the state the a11y tree gets.
 */
afterEach(cleanup);

function Agree({ disabled }: { disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <Checkbox checked={on} onChange={setOn} disabled={disabled}>
      Breaks are unpaid
    </Checkbox>
  );
}

const OPTIONS = ['Plan 1', 'Plan 2', 'Plan 4', 'Plan 5'] as const;

function Plans({ onPick, disabled }: { onPick?: (v: string) => void; disabled?: string }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <button type="button">before</button>
      <div role="radiogroup" aria-label="Student loan">
        {OPTIONS.map((o) => (
          <Radio
            key={o}
            checked={value === o}
            disabled={disabled === o}
            onChange={() => {
              setValue(o);
              onPick?.(o);
            }}
          >
            {o}
          </Radio>
        ))}
      </div>
      <div role="radiogroup" aria-label="Other">
        <Radio checked={false} onChange={() => undefined}>
          Elsewhere
        </Radio>
      </div>
    </>
  );
}

describe('Checkbox', () => {
  it('is a named checkbox in the a11y tree and in the tab order', async () => {
    const user = userEvent.setup();
    render(<Agree />);
    const box = screen.getByRole('checkbox', { name: 'Breaks are unpaid' });
    expect((box as HTMLInputElement).checked).toBe(false);
    await user.tab();
    expect(document.activeElement).toBe(box);
  });

  it('toggles with Space and publishes the state', async () => {
    const user = userEvent.setup();
    render(<Agree />);
    const box = screen.getByRole<HTMLInputElement>('checkbox');
    await user.tab();
    await user.keyboard(' ');
    expect(box.checked).toBe(true);
    expect(box.closest('label')!.querySelector('.box')!.className).toContain('on');
    await user.keyboard(' ');
    expect(box.checked).toBe(false);
  });

  it('still toggles from a click on its label text', async () => {
    const user = userEvent.setup();
    render(<Agree />);
    await user.click(screen.getByText('Breaks are unpaid'));
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
  });

  it('is skipped by Tab and inert when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox checked={false} onChange={onChange} disabled>
        Locked
      </Checkbox>,
    );
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Locked' });
    expect(box.disabled).toBe(true);
    await user.tab();
    expect(document.activeElement).not.toBe(box);
    await user.click(screen.getByText('Locked'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Radio', () => {
  it('is a named radio in the a11y tree', () => {
    render(<Plans />);
    const group = screen.getByRole('radiogroup', { name: 'Student loan' });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(4);
    for (const o of OPTIONS) expect(screen.getByRole('radio', { name: o })).toBeTruthy();
  });

  it('is reached by Tab and selected with Space', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Plans onPick={onPick} />);
    await user.tab(); // the "before" button
    await user.tab();
    const first = screen.getByRole<HTMLInputElement>('radio', { name: 'Plan 1' });
    expect(document.activeElement).toBe(first);
    await user.keyboard(' ');
    expect(first.checked).toBe(true);
    expect(onPick).toHaveBeenLastCalledWith('Plan 1');
  });

  it('moves and selects with the arrow keys, wrapping, inside its own group', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Plans onPick={onPick} />);
    const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });
    radio('Plan 1').focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radio('Plan 2'));
    expect(radio('Plan 2').checked).toBe(true);
    expect(radio('Plan 1').checked).toBe(false);

    await user.keyboard('{ArrowRight}');
    expect(radio('Plan 4').checked).toBe(true);

    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(document.activeElement).toBe(radio('Plan 1'));
    expect(radio('Plan 1').checked).toBe(true);

    // Wraps from the first to the last, never into the neighbouring group.
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(radio('Plan 5'));
    expect(radio('Plan 5').checked).toBe(true);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radio('Plan 1'));
    expect(radio('Elsewhere').checked).toBe(false);

    expect(onPick.mock.calls.map(([v]) => v)).toEqual([
      'Plan 2',
      'Plan 4',
      'Plan 2',
      'Plan 1',
      'Plan 5',
      'Plan 1',
    ]);
  });

  it('skips a disabled radio', async () => {
    const user = userEvent.setup();
    render(<Plans disabled="Plan 2" />);
    const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });
    radio('Plan 1').focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radio('Plan 4'));
    expect(radio('Plan 4').checked).toBe(true);
    expect(radio('Plan 2').checked).toBe(false);
  });
});

describe('the styles keep the native input focusable and ringed', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'components.css'),
    'utf8',
  );

  it('hides .check-input visually, never with display:none', () => {
    const rule = /\.check-input \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
    expect(rule).toMatch(/clip-path:\s*inset\(50%\)/);
  });

  it('draws the focus ring on the box from the focus token', () => {
    const rule = /\.check-input:focus-visible \+ \.box \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('var(--focus-line)');
  });
});
