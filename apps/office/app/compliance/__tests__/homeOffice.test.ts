import { describe, expect, it } from 'vitest';
import {
  HOME_OFFICE_APPROVED_LABEL,
  HOME_OFFICE_UNTIL_HINT,
  homeOfficeVerifyProblem,
  rtwDateRule,
} from '../rtw';
import { canAttachHomeOfficeResult, homeOfficeAttachLabel } from '../conditions';
import {
  DOCUMENT_FILTERS,
  documentLine,
  foundLine,
  verifyAllowed,
  verifyHint,
  verifyStep,
} from '../queue';
import { reviewErrorMessage, uploadRefusal } from '../messages';
import type { QueueRow } from '../types';

/**
 * The Home Office check result on the office's side (ADR-0182): attached by
 * the office, verified with the date approved printed on it and a
 * right-to-work date six months on (THC, 22.10.2026), never read by the AI.
 */
const row = (over: Partial<QueueRow> = {}): QueueRow =>
  ({
    kind: 'document',
    item_id: 'doc-1',
    staff_id: 'staff-1',
    display_name: 'Hamid Karimi',
    item_type: 'home_office_check_result',
    item_label: 'Right to work · Home Office check',
    rtw_branch: 'home_office_check',
    share_code: 'H1234567',
    file_path: null,
    mime_type: null,
    size_bytes: null,
    is_reupload: false,
    previous_rejection: null,
    ...over,
  }) as QueueRow;

describe('the Verify dialog’s rule', () => {
  it('asks for the date approved, then the right to work until — no "no time limit"', () => {
    expect(rtwDateRule('home_office_check_result', 'home_office_check')).toEqual({
      field: 'right_to_work_until',
      label: 'Right to work until',
      hint: 'Six months from the date approved. Change it only if the result says otherwise.',
      allowNoTimeLimit: false,
      approvedOn: true,
    });
    expect(HOME_OFFICE_APPROVED_LABEL).toBe('Date approved (on the Home Office result)');
    expect(HOME_OFFICE_UNTIL_HINT).toMatch(/^Six months from the date approved/);
  });

  it('says what is missing or wrong before the database does', () => {
    const today = '2026-10-22';
    expect(homeOfficeVerifyProblem('', '', today)).toMatch(/date approved/);
    expect(homeOfficeVerifyProblem('2026-10-23', '2027-04-23', today)).toMatch(/future/);
    expect(homeOfficeVerifyProblem('2026-10-20', '', today)).toMatch(/right to work until/);
    expect(homeOfficeVerifyProblem('2026-10-20', '2026-10-20', today)).toMatch(/after the date/);
    expect(homeOfficeVerifyProblem('2026-01-10', '2026-07-10', today)).toMatch(/run out/);
    expect(homeOfficeVerifyProblem('2026-10-20', '2027-04-20', today)).toBeNull();
  });
});

describe('the queue row', () => {
  it('cannot be verified until the result is attached', () => {
    expect(verifyAllowed(row())).toBe(false);
    expect(verifyHint(row())).toMatch(/attach the result/);
    expect(documentLine(row())).toBe('Home Office reference H1234567 · result not attached yet');
    expect(foundLine(row()).text).toBe('Waiting for the office to attach the result');
  });

  it('once attached, Verify opens the date dialog', () => {
    const attached = row({ file_path: 'staff-1/home-office-check-result/a.pdf' });
    expect(verifyAllowed(attached)).toBe(true);
    expect(verifyStep(attached)).toBe('confirm_date');
    expect(verifyHint(attached)).toMatch(/date approved/);
    expect(foundLine(attached)).toEqual({
      text: 'Not read automatically — enter the date approved on Verify',
      confidence: null,
    });
  });

  it('has a filter of its own', () => {
    expect(DOCUMENT_FILTERS.find((f) => f.value === 'home_office')?.types).toEqual([
      'home_office_check_result',
    ]);
  });
});

describe('the upload', () => {
  it('is offered on the Home Office check route only, on a live profile', () => {
    expect(
      canAttachHomeOfficeResult({ status: 'compliant', rtw_branch: 'home_office_check' }),
    ).toBe(true);
    expect(
      canAttachHomeOfficeResult({ status: 'documents', rtw_branch: 'home_office_check' }),
    ).toBe(true);
    expect(canAttachHomeOfficeResult({ status: 'removed', rtw_branch: 'home_office_check' })).toBe(
      false,
    );
    expect(canAttachHomeOfficeResult({ status: 'compliant', rtw_branch: 'work_visa' })).toBe(false);
  });

  it('reads "Attach new …" once a result is on file (a renewal)', () => {
    expect(homeOfficeAttachLabel([])).toBe('Attach Home Office check result');
    expect(
      homeOfficeAttachLabel([
        { doc_type: 'home_office_check_result', review_status: 'pending', file_path: null },
      ]),
    ).toBe('Attach Home Office check result');
    expect(
      homeOfficeAttachLabel([
        { doc_type: 'home_office_check_result', review_status: 'verified', file_path: 'x.pdf' },
      ]),
    ).toBe('Attach new Home Office check result');
  });

  it('names its refusals in words', () => {
    expect(uploadRefusal('not_home_office_branch')).toMatch(/Home Office check route/);
    expect(reviewErrorMessage('home_office_result_missing')).toBe(
      'Attach the Home Office check result before verifying it.',
    );
    expect(reviewErrorMessage('approved_on_required')).toMatch(/date approved/);
    expect(reviewErrorMessage('until_before_approved')).toMatch(/after the date/);
  });
});
