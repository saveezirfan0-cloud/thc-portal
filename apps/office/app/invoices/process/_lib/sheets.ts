import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { SheetPreview } from '../types';

/**
 * A light, read-only look at a spreadsheet for the Review screen's
 * "Source document" pane (audit §2.2: a tab per worksheet). Nothing here is
 * the extraction — the rows come from `runExtraction()`; this only lets the
 * reviewer compare against what was uploaded.
 */
export const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const PREVIEW_MAX_ROWS = 300;
export const PREVIEW_MAX_COLS = 24;
export const PREVIEW_MAX_SHEETS = 12;

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ''
      : value
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ')
          .replace(/ 00:00$/, '');
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v['richText'])) {
      return (v['richText'] as { text?: string }[]).map((p) => p.text ?? '').join('');
    }
    if ('result' in v) return cellText(v['result']);
    if (typeof v['text'] === 'string') return v['text'];
    if (typeof v['error'] === 'string') return v['error'];
    return '';
  }
  return String(value);
}

export type SheetRead = { ok: true; sheets: SheetPreview[] } | { ok: false; note: string };

export async function readSheets(buffer: Buffer, extension: string): Promise<SheetRead> {
  if (extension === 'xls') {
    return {
      ok: false,
      note: 'A table preview is not available for old .xls files — download the file to compare.',
    };
  }
  if (buffer.byteLength > PREVIEW_MAX_BYTES) {
    return { ok: false, note: 'This file is too large to preview here — download it to compare.' };
  }
  try {
    const workbook = new ExcelJS.Workbook();
    if (extension === 'csv') {
      await workbook.csv.read(Readable.from(buffer));
    } else {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    }
    const sheets: SheetPreview[] = [];
    workbook.eachSheet((sheet) => {
      if (sheets.length >= PREVIEW_MAX_SHEETS) return;
      const rows: string[][] = [];
      let truncated = false;
      const cols = Math.min(sheet.columnCount, PREVIEW_MAX_COLS);
      for (let r = 1; r <= sheet.rowCount; r += 1) {
        if (r > PREVIEW_MAX_ROWS) {
          truncated = true;
          break;
        }
        const row = sheet.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= cols; c += 1) cells.push(cellText(row.getCell(c).value));
        rows.push(cells);
      }
      if (sheet.columnCount > PREVIEW_MAX_COLS) truncated = true;
      sheets.push({ name: sheet.name || `Sheet ${sheets.length + 1}`, rows, truncated });
    });
    return { ok: true, sheets };
  } catch {
    return { ok: false, note: 'This file could not be shown here — download it to compare.' };
  }
}
