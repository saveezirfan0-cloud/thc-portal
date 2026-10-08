/**
 * Reading the invite list (ADR-0105). Pure, so the sheet's messy edges can be
 * driven directly.
 *
 * The office pastes (or opens) a sheet: tab-separated when copied out of a
 * spreadsheet, comma-separated when saved as CSV. The first row names the
 * columns, in whatever words the sheet uses; the order does not matter. The
 * database reads the GROUP and every other value, so this file only turns
 * text into rows and says plainly what it could not read — it never guesses
 * a column.
 */

export interface RosterInputRow {
  email: string;
  first_name: string;
  last_name: string;
  payroll_id: string;
  group: string;
}

export interface ParsedRoster {
  rows: RosterInputRow[];
  /** Header problems and blank-line notes: nothing was sent until they are fixed. */
  problems: string[];
}

const COLUMN_WORDS: Readonly<Record<keyof RosterInputRow, readonly string[]>> = {
  email: ['email', 'emailaddress', 'e-mail', 'mail'],
  first_name: ['firstname', 'first', 'forename', 'givenname'],
  last_name: ['lastname', 'last', 'surname', 'familyname'],
  payroll_id: ['payrollid', 'payroll', 'payrollno', 'payrollnumber', 'employeeid', 'id'],
  group: ['group', 'type', 'company', 'category', 'employer', 'staffgroup', 'stafftype'],
};

/** "Payroll ID", "payroll_id" and "PAYROLL-ID" are the same column. */
function key(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, '');
}

/** One line into cells, honouring "quoted, cells" and "" for a quote. */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

export function parseRoster(text: string): ParsedRoster {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return { rows: [], problems: ['Paste the list first.'] };

  const delimiter = lines[0]!.includes('\t') ? '\t' : ',';
  const header = splitLine(lines[0]!, delimiter).map(key);

  const index: Partial<Record<keyof RosterInputRow, number>> = {};
  for (const field of Object.keys(COLUMN_WORDS) as (keyof RosterInputRow)[]) {
    const at = header.findIndex(
      (h, i) => COLUMN_WORDS[field].includes(h) && !Object.values(index).includes(i),
    );
    if (at >= 0) index[field] = at;
  }

  const problems: string[] = [];
  if (index.email === undefined) problems.push('No Email column found in the first row.');
  if (index.group === undefined) {
    problems.push(
      'No Group column found in the first row. It says which people are SpudBros Express and which are THC (call it Group, Type or Company).',
    );
  }
  if (problems.length > 0) return { rows: [], problems };

  const cell = (cells: string[], field: keyof RosterInputRow): string => {
    const at = index[field];
    return at === undefined ? '' : (cells[at] ?? '');
  };

  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    return {
      email: cell(cells, 'email'),
      first_name: cell(cells, 'first_name'),
      last_name: cell(cells, 'last_name'),
      payroll_id: cell(cells, 'payroll_id'),
      group: cell(cells, 'group'),
    };
  });
  return { rows, problems: [] };
}
