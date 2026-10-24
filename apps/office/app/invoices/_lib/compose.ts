import { buildTimesheetInvoiceEmail } from '@thc/notifications';
import type { TimesheetInvoiceEmail } from '@thc/notifications';
import type { InvoiceDetail } from './types';

/**
 * The email the compose modal opens with (ADR-0210, audit §5): the old
 * tool's saved wording, built by the notifications package so the subject
 * rule (display name - Inv n - w/c dd/mm/yy - (days) - PO, and the client's
 * "omit event dates" tick) lives in one place. The signature is the
 * browser's own (per user) and is appended by the modal.
 */
export function defaultInvoiceEmail(invoice: InvoiceDetail): TimesheetInvoiceEmail {
  const days = [
    ...new Set(
      invoice.lines
        .map((line) => line.lineDate)
        .filter((date): date is string => typeof date === 'string' && date !== ''),
    ),
  ].sort();
  return buildTimesheetInvoiceEmail({
    displayName: invoice.billTo.name || invoice.clientName,
    invoiceNumber: invoice.number,
    contactName: invoice.billTo.contact || null,
    weekCommencing: invoice.periodFrom,
    eventDays: days,
    poNumber: invoice.poNumber,
    omitEventDates: invoice.omitEventDates,
  });
}
