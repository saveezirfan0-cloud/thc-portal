import { describe, expect, it } from 'vitest';
import { isAuthorisedJobCall } from '../_lib/auth';
import { ExtractionError, toPageReading } from '../_lib/extract';
import { GOVUK_ASSUMPTIONS } from '../_lib/govuk-assumptions';

const SECRET = 'a'.repeat(40);

describe('the runner door (ADR-0025)', () => {
  it('opens for the relay holding RTW_JOB_SECRET', () => {
    expect(isAuthorisedJobCall(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('stays shut for a wrong, missing or differently-shaped token', () => {
    expect(isAuthorisedJobCall(`Bearer ${'b'.repeat(40)}`, SECRET)).toBe(false);
    expect(isAuthorisedJobCall(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(isAuthorisedJobCall(null, SECRET)).toBe(false);
    expect(isAuthorisedJobCall(SECRET, SECRET)).toBe(false);
    expect(isAuthorisedJobCall('Bearer ', SECRET)).toBe(false);
  });

  it('stays shut when the secret is unset or too short to be one', () => {
    expect(isAuthorisedJobCall('Bearer ', undefined)).toBe(false);
    expect(isAuthorisedJobCall('Bearer ', '')).toBe(false);
    expect(isAuthorisedJobCall('Bearer short', 'short')).toBe(false);
  });
});

describe("Claude's reading is checked once more before it is used", () => {
  const good = {
    pageKind: 'result',
    found: true,
    hasRightToWork: true,
    holderName: '  MARIA GARCIA ',
    rightToWorkUntil: '2028-03-31',
    noTimeLimit: false,
    permissionType: 'Skilled Worker visa',
    conditions: '',
    termTimeWeeklyHours: null,
  };

  it('trims names and turns empty text into null', () => {
    expect(toPageReading(good)).toMatchObject({ holderName: 'MARIA GARCIA', conditions: null });
  });

  it('refuses an unknown page kind, a non-boolean or a silly number of hours', () => {
    expect(() => toPageReading({ ...good, pageKind: 'cookies' })).toThrow(ExtractionError);
    expect(() => toPageReading({ ...good, found: 'yes' })).toThrow(ExtractionError);
    expect(() => toPageReading({ ...good, termTimeWeeklyHours: 20.5 })).toThrow(ExtractionError);
    expect(() => toPageReading(null)).toThrow(ExtractionError);
  });
});

describe('the gov.uk assumptions are in one place', () => {
  it('names a GOV.UK service URL over https', () => {
    expect(GOVUK_ASSUMPTIONS.startUrl).toMatch(/^https:\/\/[a-z0-9.-]+\.service\.gov\.uk\//);
  });

  it('matches the labels the GOV.UK Design System would use', () => {
    expect(GOVUK_ASSUMPTIONS.shareCodeLabel.test('Enter the share code')).toBe(true);
    expect(GOVUK_ASSUMPTIONS.dobDayLabel.test('Day')).toBe(true);
    expect(GOVUK_ASSUMPTIONS.companyLabel.test('What is your company name?')).toBe(true);
    expect(GOVUK_ASSUMPTIONS.continueButton.test('Continue')).toBe(true);
  });
});
