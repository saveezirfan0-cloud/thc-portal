import { drawTimesheetInvoice } from './draw';

/**
 * The one place this screen reaches `drawTimesheetInvoice(invoiceId)`
 * (`_lib/draw.ts`, owned by the Generate bot). If its name or its return
 * shape moves, this file is the one-line fix.
 *
 * It is tolerant of both ways a draw can say no: throwing, and returning
 * `{ ok: false, message | error }`.
 */
export async function redrawTimesheetInvoice(
  invoiceId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const result = (await drawTimesheetInvoice(invoiceId)) as unknown;
    if (result && typeof result === 'object') {
      const r = result as { ok?: unknown; message?: unknown; error?: unknown };
      if (r.ok === false) {
        const text = typeof r.message === 'string' ? r.message : typeof r.error === 'string' ? r.error : '';
        return { ok: false, message: text || 'The invoice could not be drawn. Try again in a minute.' };
      }
    }
    return { ok: true };
  } catch (error) {
    console.error('[invoices] re-draw failed', { invoiceId, error });
    return {
      ok: false,
      message: 'The invoice could not be drawn. Nothing was changed; try again in a minute.',
    };
  }
}
