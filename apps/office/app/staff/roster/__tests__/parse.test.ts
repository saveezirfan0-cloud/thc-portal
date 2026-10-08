import { describe, expect, it } from 'vitest';
import { parseRoster, splitLine } from '../parse';

/** ADR-0107 · reading the invite list the office pastes. */
describe('parseRoster', () => {
  it('reads a sheet copied out of a spreadsheet (tab-separated)', () => {
    const { rows, problems } = parseRoster(
      'Email\tFirst name\tLast name\tPayroll ID\tGroup\nsam@x.co\tSam\tSpud\t1641A\tSpudBros Express\nnia@x.co\tNia\tNorm\t1500\tTHC',
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        email: 'sam@x.co',
        first_name: 'Sam',
        last_name: 'Spud',
        payroll_id: '1641A',
        group: 'SpudBros Express',
      },
      { email: 'nia@x.co', first_name: 'Nia', last_name: 'Norm', payroll_id: '1500', group: 'THC' },
    ]);
  });

  it('reads a CSV, with quotes, a BOM and Windows line endings', () => {
    const { rows } = parseRoster(
      '﻿email,first_name,last_name,payroll_id,group\r\n"sam@x.co","Sam","O""Spud",1641A,spud\r\n',
    );
    expect(rows).toEqual([
      {
        email: 'sam@x.co',
        first_name: 'Sam',
        last_name: 'O"Spud',
        payroll_id: '1641A',
        group: 'spud',
      },
    ]);
  });

  it('does not care about the order of the columns or what they are called', () => {
    const { rows } = parseRoster(
      'Company,Surname,Forename,E-mail,Payroll No\nTHC,Norm,Nia,nia@x.co,1500',
    );
    expect(rows[0]).toEqual({
      email: 'nia@x.co',
      first_name: 'Nia',
      last_name: 'Norm',
      payroll_id: '1500',
      group: 'THC',
    });
  });

  it('leaves a missing optional column empty', () => {
    const { rows, problems } = parseRoster('Email,Group\nsam@x.co,spud');
    expect(problems).toEqual([]);
    expect(rows[0]).toEqual({
      email: 'sam@x.co',
      first_name: '',
      last_name: '',
      payroll_id: '',
      group: 'spud',
    });
  });

  it('skips blank lines', () => {
    expect(parseRoster('Email,Group\n\nsam@x.co,spud\n\n').rows).toHaveLength(1);
  });

  it('says so when there is no Email column, and sends nothing', () => {
    const out = parseRoster('Name,Group\nSam,spud');
    expect(out.rows).toEqual([]);
    expect(out.problems.join(' ')).toMatch(/No Email column/);
  });

  it('says so when there is no Group column — it never guesses who is SpudBros', () => {
    const out = parseRoster('Email,Payroll ID\nsam@x.co,1');
    expect(out.rows).toEqual([]);
    expect(out.problems.join(' ')).toMatch(/No Group column/);
  });

  it('asks for the list when nothing was pasted', () => {
    expect(parseRoster('  \n ').problems).toEqual(['Paste the list first.']);
  });

  it('does not use one column twice', () => {
    // "Payroll" and "ID" both mean Payroll ID; only the first is taken.
    const { rows } = parseRoster('Email,Group,Payroll,ID\nsam@x.co,spud,1641A,99');
    expect(rows[0]!.payroll_id).toBe('1641A');
  });
});

describe('splitLine', () => {
  it('keeps a comma inside quotes', () => {
    expect(splitLine('a,"b, c",d', ',')).toEqual(['a', 'b, c', 'd']);
  });
});
