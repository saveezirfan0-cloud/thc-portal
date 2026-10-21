import { describe, expect, it } from 'vitest';
import {
  INVOICE_CSV_COLUMNS,
  NEW_STARTER_CSV_COLUMNS,
  PAYROLL_CSV_COLUMNS,
  financialCsv,
  invoiceCsv,
  newStarterCsv,
  payrollCsv,
  textCell,
  toCsv,
} from '../csv';
import type { InvoiceCsvRow, NewStarterCsvRow, PayrollCsvRow } from '../csv';

/**
 * Rows in the shape `payroll_report()` returns them — priced by SQL, which
 * 410_reports_payroll.sql pins figure by figure. The builder only writes
 * them down, so these figures are the same ones.
 */
function shift(
  staff: [number, string],
  n: number,
  over: Partial<PayrollCsvRow> = {},
): PayrollCsvRow {
  const day = String(3 + (n % 7)).padStart(2, '0');
  return {
    employee_id: staff[0],
    staff_name: staff[1],
    event_title: `Event ${n}`,
    client_name: 'Mandarin Oriental',
    role_name: 'Waiting Staff',
    shift_date: `2025-03-${day}`,
    starts_at: `2025-03-${day}T12:00:00Z`,
    ends_at: `2025-03-${day}T16:00:00Z`,
    check_in_at: `2025-03-${day}T12:00:00Z`,
    check_out_at: `2025-03-${day}T16:00:00Z`,
    kind: 'worked',
    unpaid_break_min: 0,
    payable_min: 240,
    rate: 14,
    base: 56,
    holiday: 6.76,
    total: 62.76,
    in_export: true,
    ...over,
  };
}

const TOM: [number, string] = [412, 'Tom Reid'];
const PRIYA: [number, string] = [655, 'Priya Sharma'];
const LUCA: [number, string] = [701, 'Luca Moretti'];

/** §9.9: "5 + 4 + 2 shifts = 11 rows, not 3" — at different rates. */
const WEEK: PayrollCsvRow[] = [
  shift(TOM, 0, {
    role_name: 'Bar Staff',
    event_title: 'Launch',
    starts_at: '2025-03-03T18:00:00Z',
    ends_at: '2025-03-03T23:00:00Z',
    check_in_at: '2025-03-03T17:55:00Z',
    check_out_at: '2025-03-03T23:02:00Z',
    payable_min: 300,
    rate: '15.50',
    base: '77.50',
    holiday: '9.35',
    total: '86.85',
  }),
  shift(TOM, 1, { payable_min: 360, base: 84, holiday: 10.14, total: 94.14 }),
  shift(TOM, 2, {
    role_name: 'Host',
    check_in_at: '2025-03-05T12:14:00Z',
    payable_min: 240,
    rate: 16,
    base: 64,
    holiday: 7.72,
    total: 71.72,
  }),
  shift(TOM, 3, {
    role_name: 'Bar Staff',
    unpaid_break_min: 20,
    payable_min: 220,
    rate: 15.5,
    base: 56.83,
    holiday: 6.86,
    total: 63.69,
  }),
  shift(TOM, 6, { kind: 'turned_away', check_in_at: null, check_out_at: null }),
  shift(PRIYA, 0),
  shift(PRIYA, 1),
  shift(PRIYA, 2),
  shift(PRIYA, 3),
  shift(LUCA, 4, { role_name: 'Bar Staff', rate: 15.5, base: 62, holiday: 7.48, total: 69.48 }),
  shift(LUCA, 5),
];

/** RULE-02: an unresolved No check-out, as payroll_report() returns it. */
const HELD = shift(LUCA, 5, {
  event_title: 'Party',
  check_out_at: null,
  payable_min: null,
  base: null,
  holiday: null,
  total: null,
  in_export: false,
});

function lines(csv: string): string[] {
  return csv
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n');
}

describe('Payroll CSV (§9.9 Tab 2)', () => {
  it('matches the snapshot: 5 + 4 + 2 shifts are 11 rows, not 3', async () => {
    const csv = payrollCsv(WEEK);
    expect(lines(csv)).toHaveLength(1 + 11);
    await expect(csv).toMatchFileSnapshot('./__golden__/payroll-5-4-2.csv');
  });

  it('has exactly the specified columns, in order', () => {
    expect(lines(payrollCsv([]))[0]).toBe(
      'Employee ID,Staff,Event,Client,Role,Date,Scheduled start–end,Check in,Check out,Break deduction,Payable hours,Rate,Base,Holiday,Total',
    );
    expect(PAYROLL_CSV_COLUMNS).toHaveLength(15);
  });

  it('puts an Employee ID on every row', () => {
    for (const line of lines(payrollCsv(WEEK)).slice(1)) {
      expect(line).toMatch(/^THC-\d{5},/);
    }
  });

  it('keeps the exact rate on every line — never averaged', () => {
    const rates = lines(payrollCsv(WEEK))
      .slice(1)
      .filter((l) => l.startsWith('THC-00412'))
      .map((l) => l.split(',')[11]);
    expect(new Set(rates)).toEqual(new Set(['15.50', '14.00', '16.00']));
  });

  it('breaks holiday out in its own column and never blends it into the rate', () => {
    const first = lines(payrollCsv(WEEK))[1]!.split(',');
    expect(first.slice(11)).toEqual(['15.50', '77.50', '9.35', '86.85']);
  });

  it('writes UK times, the break deduction and decimal payable hours', () => {
    const fourth = lines(payrollCsv(WEEK))[4]!.split(',');
    expect(fourth.slice(5, 11)).toEqual([
      '06/03/2025',
      '12:00–16:00',
      '12:00',
      '16:00',
      '0:20',
      '3.67',
    ]);
  });

  it('writes "Turned away" instead of check-in/out times (RULE-15)', () => {
    const row = lines(payrollCsv(WEEK))
      .find((l) => l.includes('Event 6'))!
      .split(',');
    expect(row.slice(7, 9)).toEqual(['Turned away', '']);
  });

  it('HOLDS a shift with an unresolved No check-out: it is not exported with a guessed figure', () => {
    const csv = payrollCsv([...WEEK, HELD]);
    expect(lines(csv)).toHaveLength(1 + 11);
    expect(csv).not.toContain('Party');
  });

  it('holds it even if a caller forgot to filter — in_export: false never reaches finance', () => {
    expect(lines(payrollCsv([HELD]))).toHaveLength(1);
  });
});

describe('New Starter CSV (§9.9 Tab 3)', () => {
  const chen: NewStarterCsvRow = {
    staff_name: 'Chen Wei',
    employee_id: 960,
    ni_number: 'QQ123456A',
    home_address: 'Flat 4, 12 Exhibition Rd, London SW7 2HE',
    address_line_1: 'Flat 4',
    address_line_2: '12 Exhibition Rd',
    address_line_3: null,
    town: 'London',
    postcode: 'SW7 2HE',
    country: 'United Kingdom',
    passport_country: 'China',
    date_of_birth: '2003-11-21',
    gender: 'M',
    first_shift_date: '2026-09-10',
    hmrc_statement: 'B',
    student_loan: 'Plan 2',
    bank_account_holder: 'Chen Wei',
    bank_sort_code: '40-47-84',
    bank_account_number: '07313310',
  };

  it('has exactly the confirmed columns, bank details last — no role, no salutation', () => {
    expect(lines(newStarterCsv([]))[0]).toBe(
      'Staff,Employee ID,NI Number,Home address,Address line 1,Address line 2,Address line 3,Town / City,Postcode,Country,Passport country,Date of birth,Gender,First shift date,HMRC Statement,Student Loan,Account holder,Sort code,Account number',
    );
    expect(NEW_STARTER_CSV_COLUMNS).not.toContain('Role');
  });

  it('writes the full NI number and bank details, quotes the comma-bearing address and uses DD/MM/YYYY', () => {
    expect(lines(newStarterCsv([chen]))[1]).toBe(
      'Chen Wei,THC-00960,QQ123456A,"Flat 4, 12 Exhibition Rd, London SW7 2HE",Flat 4,12 Exhibition Rd,,London,SW7 2HE,United Kingdom,China,21/11/2003,M,10/09/2026,B,Plan 2,Chen Wei,40-47-84,07313310',
    );
  });

  it('carries the address in its own fields beside the full line, and the passport country (ADR-0159)', () => {
    const cells = lines(newStarterCsv([chen]))[1]!;
    const head = lines(newStarterCsv([]))[0]!.split(',');
    expect(head.indexOf('Home address')).toBeLessThan(head.indexOf('Address line 1'));
    expect(head.indexOf('Country') + 1).toBe(head.indexOf('Passport country'));
    expect(cells).toContain(',Flat 4,12 Exhibition Rd,,London,SW7 2HE,');
  });

  it('leaves the passport country and the address lines blank when none is on file', () => {
    const row = {
      ...chen,
      home_address: null,
      address_line_1: null,
      address_line_2: null,
      address_line_3: null,
      town: null,
      postcode: null,
      country: null,
      passport_country: null,
    };
    expect(lines(newStarterCsv([row]))[1]).toContain('QQ123456A,,,,,,,,,21/11/2003');
  });

  it('leaves bank details blank for a starter who has not given them yet', () => {
    const row = {
      ...chen,
      bank_account_holder: null,
      bank_sort_code: null,
      bank_account_number: null,
    };
    expect(lines(newStarterCsv([row]))[1]).toMatch(/,Plan 2,,,$/);
  });

  it('leaves a missing NI number blank rather than inventing one', () => {
    expect(lines(newStarterCsv([{ ...chen, ni_number: null }]))[1]).toContain('THC-00960,,');
  });
});

describe('CSV hygiene', () => {
  it('starts with a BOM and ends every line with CRLF', () => {
    const csv = toCsv(['a'], [['1']]);
    expect(csv).toBe('\uFEFFa\r\n1\r\n');
  });

  it('defuses a name a spreadsheet would run as a formula', () => {
    expect(textCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(textCell('Tom')).toBe('Tom');
  });

  it('does not touch a negative number in a money column', () => {
    const csv = financialCsv([
      {
        group_label: 'Mon 03 Mar',
        is_total: false,
        events: ['Launch'],
        cancelled_events: [],
        payable_min: 60,
        base: 20,
        holiday: 2.41,
        payroll: 22.41,
        invoicing: 10,
        margin: -12.41,
        actual_sections: 1,
        forecast_sections: 0,
        pending: 0,
      },
    ]);
    expect(lines(csv)[1]).toBe('Mon 03 Mar,Launch,1.00,20.00,2.41,22.41,10.00,-12.41,actual');
  });
});

describe('Invoicing CSV (ADR-0172)', () => {
  // Rows as invoice_export_rows returns them, priced by SQL (pgTAP 902).
  function line(event: string, staff: string, over: Partial<InvoiceCsvRow> = {}): InvoiceCsvRow {
    return {
      event_id: event,
      event_date: '2024-11-12',
      event_title: `Gala ${event}`,
      client_name: 'Leonardo Hotel St Pauls',
      po_number: 'PO-4471',
      employee_id: 89901,
      staff_name: staff,
      role_name: 'Waiting Staff',
      starts_at: '2024-11-12T12:00:00Z',
      ends_at: '2024-11-12T16:00:00Z',
      check_in_at: '2024-11-12T12:00:00Z',
      check_out_at: '2024-11-12T16:00:00Z',
      kind: 'worked',
      unpaid_break_min: 0,
      payable_min: 240,
      charge_rate: '22.97',
      invoicing: '91.88',
      ...over,
    };
  }

  it('writes the header, then each shift, then a total row per event', () => {
    const csv = invoiceCsv([
      line('a', 'Ina Able'),
      line('a', 'Ivo Baker', { invoicing: 91.88 }),
      line('b', 'Iris Cole', {
        event_title: 'Lunch',
        po_number: null,
        payable_min: 300,
        invoicing: '114.85',
      }),
    ]);
    const rows = lines(csv);
    expect(rows[0]).toBe(INVOICE_CSV_COLUMNS.join(','));
    expect(rows[1]).toBe(
      '12/11/2024,Leonardo Hotel St Pauls,Gala a,PO-4471,THC-89901,Ina Able,Waiting Staff,12:00–16:00,12:00,16:00,0:00,4.00,22.97,91.88,',
    );
    expect(rows[3]).toBe(
      '12/11/2024,Leonardo Hotel St Pauls,Gala a — total,PO-4471,,,,,,,,8.00,,,183.76',
    );
    expect(rows[5]).toBe('12/11/2024,Leonardo Hotel St Pauls,Lunch — total,,,,,,,,,5.00,,,114.85');
    expect(rows).toHaveLength(6);
  });

  it('keeps the total out of the Amount column, so a column sum is right', () => {
    const rows = lines(invoiceCsv([line('a', 'Ina Able'), line('a', 'Ivo Baker')])).map((r) =>
      r.split(','),
    );
    const amount = INVOICE_CSV_COLUMNS.indexOf('Amount');
    const sum = rows.slice(1).reduce((total, r) => total + Number(r[amount] || 0), 0);
    expect(sum.toFixed(2)).toBe('183.76');
  });

  it('adds the total in pence, so it never drifts', () => {
    const csv = invoiceCsv([0, 1, 2].map((n) => line('a', `W${n}`, { invoicing: '0.10' })));
    expect(lines(csv)[4]?.endsWith(',0.30')).toBe(true);
  });

  it('marks a section cancelled on the day', () => {
    const csv = invoiceCsv([
      line('a', 'Ina Able', { kind: 'cancelled_on_day', check_in_at: null, check_out_at: null }),
    ]);
    expect(lines(csv)[1]).toContain(',Event cancelled on the day,,');
  });

  it('is only a header when nothing is ready', () => {
    expect(lines(invoiceCsv([]))).toHaveLength(1);
  });

  it('writes an overrun as its own row after the shift, and the total still adds up (ADR-0184)', () => {
    const out = '2024-11-12T17:15:00Z';
    const csv = invoiceCsv([
      line('a', 'Ina Able', { check_out_at: out }),
      line('a', 'Ina Able', {
        kind: 'overrun',
        starts_at: '2024-11-12T16:00:00Z',
        ends_at: out,
        check_out_at: out,
        payable_min: 75,
        invoicing: '28.71',
      }),
    ]);
    const rows = lines(csv);
    expect(rows[1]).toContain(',Waiting Staff,12:00–16:00,12:00,17:15,0:00,4.00,22.97,91.88,');
    expect(rows[2]).toBe(
      '12/11/2024,Leonardo Hotel St Pauls,Gala a,PO-4471,THC-89901,Ina Able,Overrun – Waiting Staff,16:00–17:15,,17:15,0:00,1.25,22.97,28.71,',
    );
    expect(rows[3]?.endsWith(',5.25,,,120.59')).toBe(true);
  });
});
