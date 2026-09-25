import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_CSV_COLUMNS,
  EXPORT_CAP,
  activityCsv,
  activityCsvFailed,
  activityCsvHead,
  activityCsvRows,
  activityFileName,
  csvCell,
  ukStamp,
} from '../csv';
import { exportHref, parseFilters } from '../view-model';
import type { ActivityRow } from '../view-model';

const row = (patch: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1,
  at: '2026-07-01T13:05:00Z',
  actor: 'u1',
  actor_name: 'Gisela M.',
  action: 'block_manual',
  entity: 'staff',
  entity_id: 's1',
  entity_label: 'Staff Alpha',
  data: { reason: 'Late twice', staffId: 's1' },
  ...patch,
});

describe('activity CSV', () => {
  it('opens with a BOM and the six columns the screen shows', () => {
    expect(ACTIVITY_CSV_COLUMNS.map((c) => c.header)).toEqual([
      'When (UK time)',
      'Who',
      'Action',
      'Area',
      'Record',
      'Details',
    ]);
    expect(activityCsvHead()).toBe('﻿When (UK time),Who,Action,Area,Record,Details\r\n');
  });

  it('writes a row in the activity log’s own words, the stamp in UK time', () => {
    // 13:05 UTC in July is 14:05 BST.
    expect(activityCsvRows([row()])).toBe(
      '2026-07-01 14:05,Gisela M.,Blocked worker,Staff,Staff Alpha,Reason: Late twice\r\n',
    );
  });

  it('stamps a winter entry in GMT, whatever zone the server runs in', () => {
    expect(ukStamp('2026-01-15T09:30:00Z')).toBe('2026-01-15 09:30');
  });

  it('names the system when nobody did it, and leaves an unlabelled record blank', () => {
    expect(
      activityCsvRows([row({ actor: null, actor_name: null, entity_label: null, data: null })]),
    ).toBe('2026-07-01 14:05,System,Blocked worker,Staff,,\r\n');
  });

  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('Smith, Jo')).toBe('"Smith, Jo"');
    expect(csvCell('said "no"')).toBe('"said ""no"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('defuses a typed reason that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+44 7700')).toBe("'+44 7700");
    const out = activityCsvRows([row({ data: { reason: '=1+1' } })]);
    expect(out).toContain('Reason: =1+1');
    expect(activityCsvRows([row({ entity_label: '@evil' })])).toContain(",'@evil,");
  });

  it('says so on its last line when it stopped at the cap', () => {
    const file = activityCsv([row()], true);
    const last = file.trimEnd().split('\r\n').pop() ?? '';
    expect(last).toMatch(/^"?Truncated: only the newest 10,000 entries/);
    expect(activityCsv([row()], false)).not.toMatch(/Truncated/);
    expect(EXPORT_CAP).toBe(10_000);
  });

  it('says so when a read failed part-way', () => {
    expect(activityCsvFailed('timeout')).toMatch(/^Export stopped early: timeout/);
  });

  it('names the file by the UK date and the area picked', () => {
    const late = new Date('2026-09-25T23:30:00Z'); // 00:30 on the 26th in London
    expect(activityFileName({ entity: null }, late)).toBe('thc-activity-log-2026-09-26.csv');
    expect(activityFileName({ entity: 'compliance_docs' }, late)).toBe(
      'thc-activity-log-compliance-docs-2026-09-26.csv',
    );
  });
});

describe('export link and filters', () => {
  it('carries the filters on screen, not the page', () => {
    const filters = parseFilters(
      (key) =>
        ({ entity: 'staff', actor: 'u1', q: ' late ', period: '7d', before: '900' })[key] ?? null,
    );
    expect(filters).toEqual({
      entity: 'staff',
      actor: 'u1',
      query: 'late',
      period: '7d',
      before: 900,
    });
    expect(exportHref(filters)).toBe('/activity/export?entity=staff&actor=u1&q=late&period=7d');
  });

  it('leaves the default period out and reads nonsense as the defaults', () => {
    const filters = parseFilters((key) => ({ period: 'forever', before: '-3' })[key] ?? null);
    expect(filters.period).toBe('30d');
    expect(filters.before).toBeNull();
    expect(exportHref(filters)).toBe('/activity/export');
  });
});
