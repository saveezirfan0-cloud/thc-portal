import { UkDateField } from '@thc/ui';
import type { ReportView } from '../view-model';

/**
 * The arbitrary date range (§9.9 Tabs 1 and 2). A plain GET form: the
 * range lives in the URL, so a report can be bookmarked or sent to someone
 * and opens on the same figures.
 *
 * The dates are typed dd/mm/yyyy (`UkDateField`, ADR-0140): a native date
 * input wrote mm/dd/yyyy on a US-locale device. Each field submits its
 * `yyyy-mm-dd` under the same name the URL always carried.
 */
export function RangeForm({ view }: { view: ReportView }) {
  return (
    <form method="get" action="/reports" className="daterange">
      <input type="hidden" name="tab" value={view.tab} />
      {view.tab === 'financial' ? <input type="hidden" name="by" value={view.by} /> : null}
      <UkDateField
        label="From (UK date)"
        labelHidden
        name="from"
        defaultValue={view.from}
        required
      />
      <span className="muted">→</span>
      <UkDateField label="To (UK date)" labelHidden name="to" defaultValue={view.to} required />
      <button type="submit" className="btn sm">
        Apply
      </button>
    </form>
  );
}
