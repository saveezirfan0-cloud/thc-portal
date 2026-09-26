import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUIZ_FAILED_COPY, QUIZ_FAILED_TITLE } from '@thc/domain';
import { TEMPLATES } from '@thc/notifications';
import { contractParagraphs } from '../content/contract';
import { INDUCTION_DECK, INDUCTION_IS_PLACEHOLDER, minutesLeft } from '../content/induction';
import { TUTORIAL_CARDS } from '../content/tutorial';
import { toDaterangeLiteral } from '../extractor';
import { reasonMessage } from '../messages';

describe('E4 and the terminal screen say the same thing (§10.1 case 3, §8)', () => {
  it('word for word', () => {
    expect(TEMPLATES.E4.body).toBe(QUIZ_FAILED_COPY);
    expect(TEMPLATES.E4.title).toBe(QUIZ_FAILED_TITLE);
  });
});

describe('the agreement as stored (§2.11)', () => {
  const body =
    '1. Status. This is a zero-hours agreement.\n\n5. Ongoing duty to disclose convictions. You undertake to declare any unspent criminal conviction.\n\nA closing line.';

  it('bolds each clause heading and changes nothing else', () => {
    expect(contractParagraphs(body)).toEqual([
      { heading: '1. Status.', text: 'This is a zero-hours agreement.' },
      {
        heading: '5. Ongoing duty to disclose convictions.',
        text: 'You undertake to declare any unspent criminal conviction.',
      },
      { heading: null, text: 'A closing line.' },
    ]);
  });

  it('reads THC’s layout: a heading on its own, then numbered sub-clauses and definitions', () => {
    const thc =
      '1. INTERPRETATION.\n\n1.1 The definitions and rules of interpretation in this clause apply to this Agreement.\n\n"AWR 2010" means the Agency Workers Regulations 2010 (SI 2010/93).\n\n3.10.3.1 explains the basis on which it is considered that an individual is a comparable employee; and\n\n5. TEMPORARY WORKER\'S OBLIGATIONS.\n\n7. BENEFITS. The Temporary Worker is not entitled to any benefits.';
    expect(contractParagraphs(thc)).toEqual([
      { heading: '1. INTERPRETATION.', text: '' },
      {
        heading: null,
        text: '1.1 The definitions and rules of interpretation in this clause apply to this Agreement.',
      },
      { heading: null, text: '"AWR 2010" means the Agency Workers Regulations 2010 (SI 2010/93).' },
      {
        heading: null,
        text: '3.10.3.1 explains the basis on which it is considered that an individual is a comparable employee; and',
      },
      { heading: "5. TEMPORARY WORKER'S OBLIGATIONS.", text: '' },
      { heading: '7. BENEFITS.', text: 'The Temporary Worker is not entitled to any benefits.' },
    ]);
  });

  it('THC’s published agreement (20260930140100) reads as 28 bold clauses, with the duty to disclose', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../../supabase/migrations/20260930140100_thc_agency_worker_contract.sql',
      ),
      'utf8',
    );
    const body = /\$contract\$\n([\s\S]*?)\n\$contract\$/.exec(sql)?.[1] ?? '';
    const paragraphs = contractParagraphs(body);
    const headings = paragraphs.flatMap((p) => (p.heading ? [p.heading] : []));
    expect(headings).toHaveLength(28);
    expect(headings.map((h) => Number.parseInt(h, 10))).toEqual(
      Array.from({ length: 28 }, (_, i) => i + 1),
    );
    expect(headings[0]).toBe('1. INTERPRETATION.');
    expect(headings[27]).toBe('28. DUTY TO DISCLOSE CRIMINAL CONVICTIONS.');
    expect(paragraphs.find((p) => p.heading?.startsWith('28.'))?.text).toMatch(
      /undertakes to declare any unspent criminal conviction/,
    );
    // Nothing left over from the PDF: no page footers, no contents page, no split words.
    expect(body).not.toMatch(/\b\d+ of 20\b|TABLE OF CONTENTS|\.{5}|f uture|self -cert/);
  });
});

describe('the induction viewer (§10.3 5/11)', () => {
  it('has a deck and counts the time down to the last slide', () => {
    expect(INDUCTION_DECK.length).toBeGreaterThan(1);
    expect(minutesLeft(0, 10)).toBe(6);
    expect(minutesLeft(9, 10)).toBe(1);
  });
});

describe('THC’s own induction deck (§10.3 5/11: "the supplied file is used as-is")', () => {
  it('is no longer the stand-in, and every page is one of THC’s slides', () => {
    expect(INDUCTION_IS_PLACEHOLDER).toBe(false);
    expect(INDUCTION_DECK).toHaveLength(21);
    for (const slide of INDUCTION_DECK) {
      expect(slide.image, slide.title).toMatch(/^\/induction\/slide-\d{2}\.webp$/);
      expect(slide.body, slide.title).toBeUndefined();
    }
  });

  it('ships every image it lists, in order', () => {
    const publicDir = join(__dirname, '../../../public');
    INDUCTION_DECK.forEach((slide, i) => {
      expect(slide.image).toBe(`/induction/slide-${String(i + 1).padStart(2, '0')}.webp`);
      expect(existsSync(join(publicDir, slide.image!)), slide.image).toBe(true);
    });
  });
});

describe('How it works (§10.3 11/11)', () => {
  it('is the wireframe’s four cards, the 12:00 deadline among them (§3.5)', () => {
    expect(TUTORIAL_CARDS).toHaveLength(4);
    expect(TUTORIAL_CARDS[1].title).toMatch(/12:00/);
    expect(TUTORIAL_CARDS[2].body).toMatch(/not a deadline/);
  });
});

describe('the extractor seam (§2.6)', () => {
  it('stores an inclusive holiday as the half-open range Postgres keeps', () => {
    expect(toDaterangeLiteral({ from: '2026-12-13', to: '2027-01-05' })).toBe(
      '[2026-12-13,2027-01-06)',
    );
  });
});

describe('refusals read as sentences', () => {
  it('maps the database’s codes', () => {
    expect(reasonMessage('bad_share_code')).toMatch(/9 letters and numbers starting with W/);
    expect(reasonMessage('missing_document:university_term_dates_letter')).toMatch(/Upload every/);
    expect(reasonMessage('reference_is_relative')).toMatch(/can’t be relatives/);
  });
  it('never shows a raw code', () => {
    expect(reasonMessage('some_unmapped_code')).toMatch(/Something went wrong/);
  });
});
