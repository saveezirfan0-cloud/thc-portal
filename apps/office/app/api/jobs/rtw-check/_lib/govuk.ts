import type { Browser, Page } from 'playwright-core';
import { GOVUK_ASSUMPTIONS as A } from './govuk-assumptions';

/**
 * The browser half of the gov.uk check (ADR-0025): fill the Home Office
 * form with the share code, date of birth and THC's company name, and
 * bring back the page as a PDF plus the applicant's photo.
 *
 * It decides nothing. Whether the page is a result, a "not found" or the
 * form again is read by Claude from the PDF (extract.ts), so a change in
 * wording costs a failed check, never a wrong answer.
 *
 * The inputs are held in memory for the life of one page and are never
 * logged; errors thrown from here are redacted by the caller.
 */

export interface GovUkInput {
  shareCode: string;
  /** YYYY-MM-DD */
  dob: string;
  companyName: string;
}

export interface GovUkPage {
  /** The result as a PDF: the service's own download when offered, else the page printed. */
  pdf: Buffer;
  /** The applicant's photo, when the page shows one where it is expected. */
  photo: Buffer | null;
}

/** Chromium on Vercel (@sparticuz/chromium), or a local binary for development. */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const local = process.env['RTW_CHROMIUM_PATH'];
  if (local) return chromium.launch({ executablePath: local, headless: true });
  const { default: serverless } = await import('@sparticuz/chromium');
  return chromium.launch({
    executablePath: await serverless.executablePath(),
    args: serverless.args,
    headless: true,
  });
}

async function fillIfPresent(page: Page, label: RegExp, value: string): Promise<boolean> {
  const field = page.getByLabel(label).first();
  if ((await field.count()) === 0) return false;
  await field.fill(value);
  return true;
}

async function clickIfPresent(page: Page, name: RegExp): Promise<boolean> {
  const button = page.getByRole('button', { name }).or(page.getByRole('link', { name })).first();
  if ((await button.count()) === 0) return false;
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: A.navigationTimeoutMs }),
    button.click({ timeout: A.navigationTimeoutMs }),
  ]);
  return true;
}

/**
 * Walk the form. Each page is filled with whichever of the known fields it
 * shows, then moved on; the walk stops at the first page with none of
 * them, which is the answer.
 */
async function walkForm(page: Page, input: GovUkInput): Promise<void> {
  const [year, month, day] = input.dob.split('-') as [string, string, string];
  await clickIfPresent(page, A.startButton);

  for (let step = 0; step < A.maxFormSteps; step += 1) {
    let filled = false;
    filled = (await fillIfPresent(page, A.shareCodeLabel, input.shareCode)) || filled;
    if (await fillIfPresent(page, A.dobDayLabel, String(Number(day)))) {
      await fillIfPresent(page, A.dobMonthLabel, String(Number(month)));
      await fillIfPresent(page, A.dobYearLabel, year);
      filled = true;
    }
    filled = (await fillIfPresent(page, A.companyLabel, input.companyName)) || filled;
    if (!filled) return;
    if (!(await clickIfPresent(page, A.continueButton))) return;
  }
}

async function officialPdf(page: Page): Promise<Buffer | null> {
  const control = page
    .getByRole('link', { name: A.downloadPdf })
    .or(page.getByRole('button', { name: A.downloadPdf }))
    .first();
  if ((await control.count()) === 0) return null;
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      control.click(),
    ]);
    const path = await download.path();
    if (!path) return null;
    const { readFile } = await import('node:fs/promises');
    return await readFile(path);
  } catch {
    return null;
  }
}

async function photo(page: Page): Promise<Buffer | null> {
  const image = page.locator(A.photoSelector).first();
  if ((await image.count()) === 0) return null;
  try {
    return await image.screenshot({ type: 'png', timeout: 5_000 });
  } catch {
    return null;
  }
}

/** One check, one browser context, closed whatever happens. */
export async function checkOnGovUk(browser: Browser, input: GovUkInput): Promise<GovUkPage> {
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(A.navigationTimeoutMs);
    await page.goto(A.startUrl, { waitUntil: 'domcontentloaded', timeout: A.navigationTimeoutMs });
    await walkForm(page, input);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    const picture = await photo(page);
    const pdf =
      (await officialPdf(page)) ??
      (await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
    return { pdf, photo: picture };
  } finally {
    await context.close().catch(() => undefined);
  }
}
