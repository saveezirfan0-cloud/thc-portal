import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_ROWS, cellText, readSheets } from '../_lib/sheets';

async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const all = wb.addWorksheet('All Employees');
  all.addRow(['First name', 'Last name (ID)', 'Total paid hours']);
  all.addRow(['Ana', 'Smith (1042)', '21:30']);
  all.addRow([
    { richText: [{ text: 'Bo' }, { text: 'b' }] },
    { formula: 'A1', result: 'x' },
    new Date('2026-10-19T00:00:00Z'),
  ]);
  const ana = wb.addWorksheet('Ana Smith');
  for (let i = 0; i < PREVIEW_MAX_ROWS + 20; i += 1) ana.addRow([`row ${i}`]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('source preview of a spreadsheet', () => {
  it('shows a tab per worksheet as plain text', async () => {
    const read = await readSheets(await workbook(), 'xlsx');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.sheets.map((s) => s.name)).toEqual(['All Employees', 'Ana Smith']);
    expect(read.sheets[0]!.rows[1]).toEqual(['Ana', 'Smith (1042)', '21:30']);
    expect(read.sheets[0]!.rows[2]![0]).toBe('Bob');
    expect(read.sheets[0]!.rows[2]![1]).toBe('x');
    expect(read.sheets[0]!.rows[2]![2]).toBe('2026-10-19');
  });

  it('keeps it light: long sheets are cut and say so', async () => {
    const read = await readSheets(await workbook(), 'xlsx');
    if (!read.ok) throw new Error('expected a read');
    expect(read.sheets[1]!.rows).toHaveLength(PREVIEW_MAX_ROWS);
    expect(read.sheets[1]!.truncated).toBe(true);
    expect(read.sheets[0]!.truncated).toBe(false);
  });

  it('reads a CSV as one sheet', async () => {
    const read = await readSheets(Buffer.from('Name,Hours\nAna,8\n'), 'csv');
    expect(read.ok && read.sheets[0]!.rows).toEqual([
      ['Name', 'Hours'],
      ['Ana', '8'],
    ]);
  });

  it('says why there is no table for an .xls, a broken file, or nothing', async () => {
    expect(await readSheets(Buffer.from('x'), 'xls')).toMatchObject({
      ok: false,
      note: expect.stringContaining('.xls'),
    });
    expect(await readSheets(Buffer.from('not a zip'), 'xlsx')).toMatchObject({ ok: false });
  });

  it('turns odd cell values into text', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(12.5)).toBe('12.5');
    expect(cellText({ text: 'link', hyperlink: 'https://x' })).toBe('link');
    expect(cellText({ error: '#N/A' })).toBe('#N/A');
  });
});
