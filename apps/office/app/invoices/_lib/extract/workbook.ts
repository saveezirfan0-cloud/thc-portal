import ExcelJS from 'exceljs';
import type { Grid } from './types';

/**
 * Bytes -> Grid[] for .xlsx (exceljs) and .csv. Legacy binary .xls is not
 * readable by exceljs: it comes back as `unsupported_xls` for the caller to
 * ask for a re-save as .xlsx (no unmaintained `xlsx` package).
 */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** A cell value as a plain scalar. Durations/times become "H:MM". */
export function plainCell(value: ExcelJS.CellValue, numFmt?: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime() - EXCEL_EPOCH;
    // a time-of-day or duration (before 1900-01-02 + any [h]:mm overflow)
    if (value.getUTCFullYear() <= 1900) {
      const mins = Math.round(ms / 60_000);
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
    return value;
  }
  if (typeof value === 'number') {
    if (numFmt && /h\]?:m/i.test(numFmt)) {
      const mins = Math.round(value * 1440);
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
    return value;
  }
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) {
      return plainCell(value.result as ExcelJS.CellValue, numFmt);
    }
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return null;
  }
  return value;
}

export async function readXlsx(bytes: Uint8Array): Promise<Grid[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const grids: Grid[] = [];
  wb.eachSheet((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const out: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        out[col - 1] = plainCell(cell.value, cell.numFmt);
      });
      rows[rowNumber - 1] = out;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    grids.push({ name: sheet.name, rows });
  });
  return grids;
}

/** RFC 4180-ish: quotes, doubled quotes, CRLF; sniffs `,` `;` or tab. */
export function parseCsv(text: string): unknown[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ',',
  );
  const rows: unknown[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => (c === '' ? null : c)));
}

export type SpreadsheetKind = 'xlsx' | 'xls' | 'csv';

export function spreadsheetKind(fileName: string, mime: string): SpreadsheetKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const m = mime.toLowerCase();
  if (ext === 'csv') return 'csv'; // Windows sends CSV as application/vnd.ms-excel
  if (ext === 'xlsx' || m.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'xls' || m === 'application/vnd.ms-excel') return 'xls';
  if (m === 'text/csv') return 'csv';
  return null;
}

export async function readSpreadsheet(
  kind: SpreadsheetKind,
  bytes: Uint8Array,
  fileName: string,
): Promise<Grid[]> {
  if (kind === 'xls') throw new Error('unsupported_xls');
  if (kind === 'csv') {
    return [
      {
        name: fileName.replace(/\.[^.]+$/, '') || 'Sheet1',
        rows: parseCsv(Buffer.from(bytes).toString('utf8')),
      },
    ];
  }
  return readXlsx(bytes);
}
