/**
 * EVERY assumption about the Home Office "View a job applicant's right to
 * work details" service, in one place (ADR-0025 §Assumptions).
 *
 *     ASSUMED — CONFIRM AGAINST THE LIVE SERVICE.
 *
 * Nothing here has been run against the real page: this environment has
 * no network route to it and no real share code. Each entry says how
 * fragile it is. When the live test (OWNER-TODO §4b, "Switch on the gov.uk
 * check") shows a difference, this file is the only one to change: the
 * browser steps in govuk.ts read these values and nothing else, and the
 * result is read by Claude from the page itself, not by selectors.
 *
 * Why labels, not CSS: GOV.UK services are built from the GOV.UK Design
 * System, whose inputs always carry a visible <label> and whose buttons
 * are real <button>s. Locating by accessible label and role survives a
 * restyle; a class name does not.
 */
export const GOVUK_ASSUMPTIONS = {
  /**
   * The employer-side service. gov.uk/view-right-to-work links here.
   * Fragility: LOW — a GOV.UK service URL rarely moves, and a move would
   * normally redirect.
   */
  startUrl: 'https://right-to-work.service.gov.uk/rtw-view',

  /**
   * A "Start now" button may or may not precede the form.
   * Fragility: LOW — optional; the step is skipped when absent.
   */
  startButton: /start now/i,

  /**
   * The share code field's label.
   * Fragility: MEDIUM — the wording ("Enter the share code", "Share code")
   * may change, but the words "share code" are the service's name for it.
   */
  shareCodeLabel: /share code/i,

  /**
   * Date of birth: the GOV.UK date input pattern — three inputs labelled
   * Day, Month and Year. Fragility: LOW for the pattern, MEDIUM for
   * whether it is on the same page as the share code (the steps below
   * fill whatever is present, page by page).
   */
  dobDayLabel: /^day$/i,
  dobMonthLabel: /^month$/i,
  dobYearLabel: /^year$/i,

  /**
   * The employer's company name, which the service asks for and prints on
   * the result. Fragility: MEDIUM — wording unknown; may be "company
   * name", "name of your company" or "organisation".
   */
  companyLabel: /company|organisation|organization|employer/i,

  /**
   * The button that moves the form on.
   * Fragility: MEDIUM — "Continue" is the Design System default; "Submit"
   * and "View" are the likely alternatives.
   */
  continueButton: /^(continue|submit|view|check|find)\b/i,

  /**
   * How many form pages to walk before expecting a result.
   * Fragility: MEDIUM — if the service adds a step this must grow.
   */
  maxFormSteps: 4,

  /**
   * The applicant's photograph on the result page. The first image inside
   * <main> that is not the crown logo. Fragility: HIGH — layout-dependent;
   * when it is not found the admin compares against the photo in the PDF.
   */
  photoSelector: 'main img:not([alt*="crown" i]):not([src*=".svg"])',

  /**
   * An official "download a PDF" link or button on the result, if any.
   * Fragility: HIGH — when absent, the result page is printed to PDF by
   * Chromium instead, which the Home Office guidance accepts as the
   * retained copy of an online check.
   */
  downloadPdf: /download.*pdf|save.*pdf|save (a copy|this page)/i,

  /** Per-navigation timeout. Fragility: n/a — a runtime budget. */
  navigationTimeoutMs: 30_000,
} as const;

/**
 * What Claude is told the page may be. Kept here because it is also an
 * assumption: that the service answers with a result page, a "not found"
 * page, or the form again with an error summary.
 */
export const GOVUK_PAGE_KINDS = ['result', 'not_found', 'form_error', 'other'] as const;
export type GovUkPageKind = (typeof GOVUK_PAGE_KINDS)[number];
