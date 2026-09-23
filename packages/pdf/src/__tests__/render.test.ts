import { describe, expect, it } from 'vitest';
import { countPdfPages, photoFormat, renderSheetPdf } from '../SheetDocument';
import type { SheetPhoto } from '../SheetDocument';
import { layoutSheet } from '../sheet';
import { GALA, galaPeople, removedWaiter, signOutPeople } from './fixtures';

/** A 1×1 PNG: enough to prove a selfie is embedded, not linked. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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
    expect(countPdfPages(pdf)).toBe(3);
  });

  it('draws a 25-worker event on three pages', async () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: galaPeople(20) });
    expect(countPdfPages(await renderSheetPdf(layout))).toBe(3);
  });

  it('draws the one-page sign-out timesheet on one page, footer included', async () => {
    const layout = layoutSheet({ kind: 'signout', event: GALA, people: signOutPeople() });
    expect(countPdfPages(await renderSheetPdf(layout))).toBe(1);
  });

  it('fits the worst case on a page: twelve rows, each in its own role section, plus the footer', async () => {
    const people = galaPeople(12).map((p, i) => ({
      ...p,
      roleName: `Role ${String(i).padStart(2, '0')}`,
      sectionId: `s${i}`,
    }));
    const layout = layoutSheet({ kind: 'signout', event: GALA, people: people.slice(0, 12) });
    expect(layout.pages).toHaveLength(1);
    expect(countPdfPages(await renderSheetPdf(layout))).toBe(1);
  });

  it('renders a copy with a removed worker (no photo) without complaint', async () => {
    const layout = layoutSheet({ kind: 'allocation', event: GALA, people: [removedWaiter()] });
    expect(countPdfPages(await renderSheetPdf(layout))).toBe(1);
  });
});

describe('photoFormat', () => {
  it('recognises PNG and JPEG and nothing else', () => {
    expect(photoFormat(PNG)).toBe('png');
    expect(photoFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(photoFormat(Buffer.from('RIFF....WEBP', 'latin1'))).toBeNull();
  });
});
