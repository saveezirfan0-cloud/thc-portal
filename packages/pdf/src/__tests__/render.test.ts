import { describe, expect, it } from 'vitest';
import {
  A4_POINTS,
  countPdfPages,
  pdfPageSizes,
  photoFormat,
  renderSheetPdf,
} from '../SheetDocument';
import type { SheetPhoto } from '../SheetDocument';
import { layoutSheet } from '../sheet';
import { GALA, galaPeople, removedWaiter, signOutPeople } from './fixtures';

/** A 1×1 PNG: enough to prove a selfie is embedded, not linked. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Every page is a full A4 portrait sheet, and there are exactly `pages` of
 * them. Before ADR-0074 the <Page> carried wrap={false}, which sizes the
 * page to its content: a 5-row sheet was 595 × 388 pt.
 */
function expectA4Pages(pdf: Buffer, pages: number) {
  expect(countPdfPages(pdf)).toBe(pages);
  const sizes = pdfPageSizes(pdf);
  expect(sizes).toHaveLength(pages);
  for (const size of sizes) {
    expect(size.width).toBeCloseTo(A4_POINTS.width, 1);
    expect(size.height).toBeCloseTo(A4_POINTS.height, 1);
  }
}

/**
 * The real PDF bytes, through @react-pdf/renderer in Node — the path the
 * office route handler takes. The golden files in sheet.test.ts hold what is
 * on each page; this holds that the drawing produces exactly those pages, so
 * react-pdf never adds an overflow page of its own.
 */
describe('rendered PDF (§11.3)', () => {
  it('draws a 27-row allocation sheet on exactly three pages', async () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: galaPeople(22) });
    const photos = new Map<string, SheetPhoto>([['412/selfie.jpg', { data: PNG, format: 'png' }]]);
    const pdf = await renderSheetPdf(layout, photos);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expectA4Pages(pdf, 3);
  });

  it('draws a 25-worker event on three pages', async () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: galaPeople(20) });
    expectA4Pages(await renderSheetPdf(layout), 3);
  });

  it('draws the one-page sign-out timesheet on one page, footer included', async () => {
    const layout = layoutSheet({ kind: 'signout', event: GALA, people: signOutPeople() });
    expectA4Pages(await renderSheetPdf(layout), 1);
  });

  it('fits the worst case on a page: twelve rows, each in its own role section, plus the footer', async () => {
    const people = galaPeople(12).map((p, i) => ({
      ...p,
      roleName: `Role ${String(i).padStart(2, '0')}`,
      sectionId: `s${i}`,
    }));
    const layout = layoutSheet({ kind: 'signout', event: GALA, people: people.slice(0, 12) });
    expect(layout.pages).toHaveLength(1);
    expectA4Pages(await renderSheetPdf(layout), 1);
  });

  it('draws a short sheet — three rows, five rows — on a full A4 page, not a strip', async () => {
    for (const rows of [3, 5]) {
      const people = galaPeople(0).slice(0, rows);
      const layout = layoutSheet({ kind: 'allocation', event: GALA, people });
      expect(layout.rowCount).toBe(rows);
      expectA4Pages(await renderSheetPdf(layout), 1);
    }
  });

  it('draws an empty sheet (nobody confirmed) on one A4 page', async () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: [] });
    expectA4Pages(await renderSheetPdf(layout), 1);
  });

  it('fits twelve rows with the longest names and comments on one A4 page', async () => {
    const people = galaPeople(12)
      .slice(0, 12)
      .map((p, i) => ({
        ...p,
        name: `Maximiliana-Alexandra Featherstonehaugh-Worthington ${i}`,
        roleName: `Senior Front of House Supervisor ${String(i).padStart(2, '0')}`,
        sectionId: `s${i}`,
        status: 'no_show' as const,
        breakMin: 45,
      }));
    const layout = layoutSheet({ kind: 'signout', event: GALA, people });
    expect(layout.pages).toHaveLength(1);
    expectA4Pages(await renderSheetPdf(layout), 1);
  });

  it('renders a copy with a removed worker (no photo) without complaint', async () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: [removedWaiter()] });
    expectA4Pages(await renderSheetPdf(layout), 1);
  });
});

describe('photoFormat', () => {
  it('recognises PNG and JPEG and nothing else', () => {
    expect(photoFormat(PNG)).toBe('png');
    expect(photoFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(photoFormat(Buffer.from('RIFF....WEBP', 'latin1'))).toBeNull();
  });
});
