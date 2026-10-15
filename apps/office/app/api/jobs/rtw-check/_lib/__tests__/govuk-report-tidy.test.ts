// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { TIDY_REPORT } from '../govuk';

/**
 * The tidy script on a page shaped like the live result (the report the
 * office was sent, 15.10.2026): a cookie banner above the GOV.UK header, the
 * result in a two-thirds column beside an empty third, the photo and the text
 * in a row of their own. The page's classes are ASSUMED where noted in
 * govuk.ts; the cookie banner here deliberately has none of them, so it is
 * found by its words.
 */
const PAGE = `
  <a class="govuk-skip-link" href="#main">Skip to main content</a>
  <div class="ukvi-consent"><div class="govuk-width-container"><div class="govuk-grid-row">
    <div class="govuk-grid-column-two-thirds">
      <h2>Cookies on UK Visas and Immigration services</h2>
      <p>We use some essential cookies to make this service work.</p>
      <button>Accept analytics cookies</button> <button>Reject analytics cookies</button>
    </div>
  </div></div></div>
  <header class="govuk-header"><div class="govuk-width-container">GOV.UK
    <p>View a job applicant's right to work</p></div></header>
  <div class="govuk-width-container" id="outer">
    <main class="govuk-main-wrapper" id="main">
      <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds" id="result">
          <div class="govuk-grid-row">
            <div class="govuk-grid-column-one-quarter" id="photo"><img alt="photo of applicant" src="x.png"></div>
            <div class="govuk-grid-column-three-quarters" id="text">
              <h1>SABIN PRAJAPATI</h1><p>They have the right to work in the UK.</p>
              <h2>Conditions</h2><p>Cookies on a site are not the result.</p>
            </div>
          </div>
        </div>
        <div class="govuk-grid-column-one-third" id="empty"> </div>
      </div>
    </main>
  </div>
  <footer class="govuk-footer">Crown copyright</footer>`;

const byId = (id: string) => document.getElementById(id)!;
const hidden = (el: Element) => (el as HTMLElement).style.getPropertyValue('display') === 'none';

describe('TIDY_REPORT', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    expect(window.eval(TIDY_REPORT)).toBe(true);
  });

  it('hides the cookie banner by its words, whatever its classes', () => {
    expect(hidden(document.querySelector('.ukvi-consent')!)).toBe(true);
  });

  it('hides the skip link and footer, and keeps the GOV.UK header and the result', () => {
    expect(hidden(document.querySelector('.govuk-skip-link')!)).toBe(true);
    expect(hidden(document.querySelector('footer')!)).toBe(true);
    expect(hidden(document.querySelector('header')!)).toBe(false);
    for (const id of ['outer', 'main', 'result', 'photo', 'text'])
      expect(hidden(byId(id))).toBe(false);
  });

  it('gives the result the whole width: the empty third goes, the two-thirds column takes the row', () => {
    expect(hidden(byId('empty'))).toBe(true);
    expect(byId('result').style.getPropertyValue('width')).toBe('100%');
    expect(byId('result').style.getPropertyPriority('width')).toBe('important');
    expect(byId('outer').style.getPropertyValue('max-width')).toBe('none');
  });

  it('leaves the photo beside the text: a column with a neighbour keeps its width', () => {
    expect(byId('photo').style.getPropertyValue('width')).toBe('');
    expect(byId('text').style.getPropertyValue('width')).toBe('');
  });

  it('prints on white', () => {
    expect(document.body.style.getPropertyValue('background')).toMatch(/#fff|rgb\(255, 255, 255\)/);
  });
});
