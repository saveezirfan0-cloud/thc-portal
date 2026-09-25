/**
 * ASSUMED — confirm against the live service (ADR-0025).
 *
 * gov.uk's employer service ("View a job applicant's right to work details",
 * gov.uk/view-right-to-work) has no API; the FALLBACK adapter fills in its
 * web form in a headless Chromium, the way a manager would. gov.uk was not
 * reachable from the environment this was written in, so EVERYTHING below —
 * the start URL, the order of the pages, the labels and buttons, and the
 * wording of the result page — is a reasoned guess, kept in this one file.
 * Each selector is a list of strategies tried in order, label and role
 * first (they survive restyling), CSS last.
 *
 * To confirm on first use (OWNER-TODO §8): run one check by hand with a
 * real share code of someone who consents, compare each page with the
 * strategies and patterns below, and adjust this file and the synthetic
 * fixtures in __tests__/fixtures. Until then, a page that does not look
 * like this ends as `govuk_page_changed:<step>` (the step name only — no
 * page text is ever logged, because the result page carries the person's
 * name and date of birth), which retries and then goes to the office —
 * never a silent pass.
 *
 * Environment:
 *   RTW_GOVUK_ENABLED              `true` to allow this adapter at all
 *   RTW_GOVUK_START_URL            default below
 *   RTW_GOVUK_TIMEOUT_MS           per step (default 30000)
 *   RTW_CHROMIUM_EXECUTABLE_PATH   a local Chrome for development; on Vercel
 *                                  @sparticuz/chromium supplies one
 */

export const GOVUK_DEFAULT_START_URL = 'https://right-to-work.service.gov.uk/rtw-view';

/** How to find one thing on a page. */
export type Strategy =
  { label: RegExp } | { role: 'button' | 'link' | 'textbox'; name: RegExp } | { css: string };

export interface GovukSelectors {
  /** The start page's "Start now", if the flow has one. Optional. */
  start: Strategy[];
  shareCode: Strategy[];
  dobDay: Strategy[];
  dobMonth: Strategy[];
  dobYear: Strategy[];
  companyName: Strategy[];
  /** "Continue" / "Submit" between steps. */
  next: Strategy[];
  /** Where the result is read from. */
  resultRoot: Strategy[];
}

export const GOVUK_SELECTORS: GovukSelectors = {
  start: [
    { role: 'button', name: /start now/i },
    { role: 'link', name: /start now/i },
  ],
  shareCode: [
    { label: /share code/i },
    { css: 'input[name="shareCode"]' },
    { css: 'input#shareCode' },
    { css: 'input[name*="share" i]' },
  ],
  dobDay: [{ label: /^day$/i }, { css: 'input[name$="day" i]' }],
  dobMonth: [{ label: /^month$/i }, { css: 'input[name$="month" i]' }],
  dobYear: [{ label: /^year$/i }, { css: 'input[name$="year" i]' }],
  companyName: [
    { label: /company|organisation|organization|employer|your name/i },
    { css: 'input[name*="company" i]' },
    { css: 'input[name*="checker" i]' },
  ],
  next: [
    { role: 'button', name: /^continue$/i },
    { role: 'button', name: /continue|submit|view details|check/i },
    { css: 'button[type="submit"]' },
  ],
  resultRoot: [{ css: 'main' }, { css: '#main-content' }, { css: 'body' }],
};

/**
 * The fields each page is expected to show, in order. A step's fields are
 * filled when the first of them is on the page; a step not shown is
 * skipped (gov.uk may ask for the date of birth and the share code on the
 * same page, or in the other order).
 */
export const GOVUK_STEPS = ['shareCode', 'dateOfBirth', 'companyName'] as const;

/** Up to this many Continue presses before the result must be on screen. */
export const GOVUK_MAX_PAGES = 6;

// ---------------------------------------------------------------------
// Reading the result page. Text patterns, applied to the page's visible
// text (innerText of the result root).
// ---------------------------------------------------------------------

export const GOVUK_RESULT = {
  /** gov.uk found no record for the share code and date of birth. */
  notFound: [
    /we (?:could not|couldn't|cannot|can't) find/i,
    /details (?:do not|don't) match/i,
    /(?:the )?share code (?:is|has) (?:not valid|invalid|incorrect|expired)/i,
    /share code (?:you entered )?(?:has expired|is not recognised)/i,
    /no (?:matching )?record/i,
  ],
  /** A record, saying the person may not work. Checked before `right`. */
  noRight: [
    /(?:does not|doesn't|do not|don't) have (?:the |a )?right to work/i,
    /(?:cannot|can't|is not allowed to|are not allowed to) work in the UK/i,
    /no right to work/i,
  ],
  /** A record, saying they may. */
  right: [
    /(?:has|have) (?:the )?(?:permission|right) to work in the UK/i,
    /(?:can|is allowed to|are allowed to) work in the UK/i,
    /right to work (?:in the UK )?(?:is )?(?:valid|confirmed)/i,
  ],
  /** The end date, captured as printed ("31 March 2028"). */
  until: [
    /(?:until|expires on|expiry date|valid until|end date)[:\s]+(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i,
    /(?:until|expires on|expiry date|valid until|end date)[:\s]+(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i,
  ],
  /** Settled status / indefinite leave: no end date, stated, never inferred. */
  noTimeLimit: [
    /no time limit/i,
    /indefinite(?:ly| leave)/i,
    /settled status(?! - pre)/i,
    /\bwithout (?:a )?time limit/i,
  ],
  /** The person's name, on a "Name" line or as the page's H1. */
  name: [/^\s*(?:full )?name\s*[:\n]\s*(.+)$/im],
  /** gov.uk's reference for the check. */
  reference: [/reference(?: number)?[:\s]+([A-Z0-9][A-Z0-9-]{5,})/i],
  /** The heading after which conditions are listed, one per line. */
  conditionsHeading:
    /^\s*(?:conditions|restrictions|work restrictions|conditions of (?:their )?(?:permission|leave))\s*:?\s*$/im,
  /** A line that is a condition wherever it appears. */
  conditionLine: [
    /\bhours? (?:a|per|each) week\b/i,
    /\bterm[\s-]?time\b/i,
    /\b(?:cannot|can't|can only|must not|may only)\b.*\bwork/i,
    /\bno (?:work )?restrictions?\b/i,
  ],
} as const;

/** Section headings that end a conditions list. */
export const GOVUK_SECTION_END =
  /^\s*(?:name|date of birth|reference|details|what (?:you|to) (?:need|do)|download|print|photo|nationality)\b/i;
