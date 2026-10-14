// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ColumnCells,
  ColumnCellsFor,
  ColumnChooser,
  ColumnChooserFor,
  ColumnHeads,
  ColumnHeadsFor,
  ColumnPrefsProvider,
  TableScrollFor,
  useColumns,
} from '../components/ColumnChooser';
import type { SaveColumnPref } from '../components/ColumnChooser';
import type { ColumnDef, ColumnPrefs } from '../components/columns';

/**
 * The column chooser (ADR-0139): a labelled dialog that is never
 * drag-only, keeps the identifying and actions columns in place, says what
 * changed in a live region, and saves a person's choice once they stop.
 */

const DEFS: readonly ColumnDef[] = [
  { id: 'name', label: 'Venue', required: true },
  { id: 'address', label: 'Address' },
  { id: 'type', label: 'Type', width: 'm' },
  { id: 'radius', label: 'Geofence (m)', width: 's', className: 'num' },
  { id: 'margin', label: 'Avg margin', finance: true },
  { id: 'actions', label: 'Actions', required: true, blankHeader: true, className: 'cell-actions' },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

function List({ finance = true }: { finance?: boolean }) {
  const columns = useColumns('venues', DEFS, { finance });
  return (
    <div>
      <ColumnChooser columns={columns} label="Venues" />
      <table>
        <thead>
          <tr>
            <ColumnHeads columns={columns} />
          </tr>
        </thead>
        <tbody>
          <tr>
            <ColumnCells
              columns={columns}
              cells={{
                name: <td>Leonardo</td>,
                address: <td>10 Godliman St</td>,
                type: <td>Hotel</td>,
                radius: <td>150</td>,
                margin: <td>31%</td>,
                actions: <td>Edit</td>,
              }}
            />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const heads = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent);
const cells = () => Array.from(document.querySelectorAll('tbody td')).map((td) => td.textContent);
const trigger = () => document.querySelector<HTMLButtonElement>('.colchooser-btn')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const live = () => document.querySelector('.colchooser-live')!.textContent;
const checkbox = (name: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement>('.colchooser-list input')).find((input) =>
    input.closest('label')!.textContent!.startsWith(name),
  )!;
const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (el) => el.getAttribute('aria-label') === name || el.textContent === name,
  )!;
const key = (target: Element, init: KeyboardEventInit) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });

describe('ColumnChooser', () => {
  it('draws the headers and cells in the declared order until changed', () => {
    mount(<List />);
    expect(heads()).toEqual(['Venue', 'Address', 'Type', 'Geofence (m)', 'Avg margin', '']);
    expect(document.querySelectorAll('thead th')[5]!.getAttribute('aria-label')).toBe('Actions');
    expect(document.querySelectorAll('thead th')[2]!.className).toBe('col-m');
    expect(cells()).toEqual(['Leonardo', '10 Godliman St', 'Hotel', '150', '31%', 'Edit']);
  });

  it('opens a labelled modal dialog, focuses the first tick and closes on Escape back to the button', () => {
    mount(<List />);
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    act(() => trigger().click());
    const box = dialog()!;
    expect(box.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(box.getAttribute('aria-labelledby')!)!;
    expect(title.textContent).toBe('Columns · Venues');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(checkbox('Address'));
    key(document.activeElement!, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps Tab inside the dialog', () => {
    mount(<List />);
    act(() => trigger().click());
    const done = button('Done');
    done.focus();
    key(done, { key: 'Tab' });
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(button('Close'));
    key(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(done);
  });

  it('hides a column, announces it, and cannot hide the required ones', () => {
    mount(<List />);
    act(() => trigger().click());
    act(() => checkbox('Type').click());
    expect(heads()).toEqual(['Venue', 'Address', 'Geofence (m)', 'Avg margin', '']);
    expect(cells()).toEqual(['Leonardo', '10 Godliman St', '150', '31%', 'Edit']);
    expect(live()).toBe('Column Type hidden');
    expect(checkbox('Venue').disabled).toBe(true);
    expect(checkbox('Actions').disabled).toBe(true);
    expect(trigger().getAttribute('aria-label')).toBe('Columns — 5 of 6 shown');
  });

  it('reorders by Move up / Move down and by Alt+Arrow, never past a held column', () => {
    mount(<List />);
    act(() => trigger().click());
    // The first movable column cannot go up; the last cannot go down.
    expect(button('Move Address up').disabled).toBe(true);
    expect(button('Move Avg margin down').disabled).toBe(true);
    act(() => button('Move Geofence (m) up').click());
    expect(heads()).toEqual(['Venue', 'Address', 'Geofence (m)', 'Type', 'Avg margin', '']);
    expect(live()).toBe('Geofence (m) moved to position 2 of 4');
    // Focus stays on the control that moved.
    expect(document.activeElement).toBe(button('Move Geofence (m) up'));

    const address = checkbox('Address');
    address.focus();
    key(address, { key: 'ArrowDown', altKey: true });
    expect(heads()).toEqual(['Venue', 'Geofence (m)', 'Address', 'Type', 'Avg margin', '']);
    expect(document.activeElement).toBe(checkbox('Address'));
    key(checkbox('Address'), { key: 'ArrowUp', altKey: true });
    key(checkbox('Address'), { key: 'ArrowUp', altKey: true });
    expect(heads()[0]).toBe('Venue');
    expect(heads()[1]).toBe('Address');
  });

  it('resets to the default and says so', () => {
    mount(<List />);
    act(() => trigger().click());
    expect(button('Reset to default').disabled).toBe(true);
    act(() => checkbox('Address').click());
    act(() => button('Reset to default').click());
    expect(heads()).toEqual(['Venue', 'Address', 'Type', 'Geofence (m)', 'Avg margin', '']);
    expect(live()).toBe('Columns reset to default');
  });

  it('never names a money column to a login without finance (ADR-0061)', () => {
    mount(<List finance={false} />);
    act(() => trigger().click());
    expect(dialog()!.textContent).not.toContain('Avg margin');
    expect(heads()).not.toContain('Avg margin');
  });

  it('has a stable dialog (snapshot)', () => {
    mount(<List />);
    act(() => trigger().click());
    expect(dialog()!.outerHTML.replace(/_r_[a-z0-9]+_|:r[a-z0-9]+:/g, 'ID')).toMatchSnapshot();
  });
});

describe('ColumnPrefsProvider', () => {
  it('paints the stored choice first, then saves a change once, after a quiet spell', async () => {
    vi.useFakeTimers();
    const save = vi.fn<SaveColumnPref>(async () => ({ ok: true }));
    const prefs: ColumnPrefs = {
      venues: { order: ['radius', 'address', 'type', 'margin'], hidden: ['type'] },
    };
    mount(
      <ColumnPrefsProvider prefs={prefs} save={save} delay={500}>
        <List />
      </ColumnPrefsProvider>,
    );
    expect(heads()).toEqual(['Venue', 'Geofence (m)', 'Address', 'Avg margin', '']);

    act(() => trigger().click());
    act(() => checkbox('Address').click());
    act(() => checkbox('Type').click());
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('venues', {
      order: ['radius', 'address', 'type', 'margin'],
      hidden: ['address'],
    });

    // Back to exactly the default is stored as "no choice".
    act(() => button('Reset to default').click());
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(save).toHaveBeenLastCalledWith('venues', null);
  });

  it('saves at once when the dialog closes, so leaving the page loses nothing', async () => {
    vi.useFakeTimers();
    const save = vi.fn<SaveColumnPref>(async () => ({ ok: true }));
    mount(
      <ColumnPrefsProvider prefs={{}} save={save} delay={5000}>
        <List />
      </ColumnPrefsProvider>,
    );
    act(() => trigger().click());
    act(() => checkbox('Type').click());
    await act(async () => {
      key(document.activeElement!, { key: 'Escape' });
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toEqual({
      order: ['address', 'type', 'radius', 'margin'],
      hidden: ['type'],
    });
    // Nothing is sent twice when the quiet spell ends.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps the list-keyed pieces of a server-rendered table in step', () => {
    mount(
      <ColumnPrefsProvider prefs={{}} save={async () => ({ ok: true })}>
        <ColumnChooserFor list="venues" defs={DEFS} finance={false} label="Venues" />
        <TableScrollFor list="venues" defs={DEFS} finance={false} minWidth="40rem">
          <table>
            <thead>
              <tr>
                <ColumnHeadsFor list="venues" defs={DEFS} finance={false} />
              </tr>
            </thead>
            <tbody>
              <tr>
                <ColumnCellsFor
                  list="venues"
                  defs={DEFS}
                  finance={false}
                  cells={{
                    name: <td>Leonardo</td>,
                    address: <td>10 Godliman St</td>,
                    type: <td>Hotel</td>,
                    radius: <td>150</td>,
                    margin: <td>31%</td>,
                    actions: <td>Edit</td>,
                  }}
                />
              </tr>
            </tbody>
          </table>
        </TableScrollFor>
      </ColumnPrefsProvider>,
    );
    expect(heads()).toEqual(['Venue', 'Address', 'Type', 'Geofence (m)', '']);
    const frame = () => document.querySelector<HTMLElement>('.tbl-frame')!;
    expect(frame().style.getPropertyValue('--tbl-min')).toBe('40rem');
    act(() => trigger().click());
    act(() => checkbox('Address').click());
    act(() => button('Move Geofence (m) up').click());
    expect(heads()).toEqual(['Venue', 'Geofence (m)', 'Type', '']);
    expect(cells()).toEqual(['Leonardo', '150', 'Hotel', 'Edit']);
    // Address's 10 of the 45.5 rem shown is gone: 40 × 35.5/45.5, to the half rem.
    expect(frame().style.getPropertyValue('--tbl-min')).toBe('31rem');
  });

  it('keeps a change that failed to save on screen and sends it again when back online', async () => {
    vi.useFakeTimers();
    const save = vi
      .fn<SaveColumnPref>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true });
    mount(
      <ColumnPrefsProvider prefs={{}} save={save} delay={100}>
        <List />
      </ColumnPrefsProvider>,
    );
    act(() => trigger().click());
    act(() => checkbox('Type').click());
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(heads()).not.toContain('Type');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toEqual({
      order: ['address', 'type', 'radius', 'margin'],
      hidden: ['type'],
    });
  });
});
