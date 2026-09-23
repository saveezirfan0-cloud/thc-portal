import type { ReportView } from '../view-model';

/**
 * The arbitrary date range (§9.9 Tabs 1 and 2). A plain GET form: the
 * range lives in the URL, so a report can be bookmarked or sent to someone
 * and opens on the same figures.
 */
export function RangeForm({ view }: { view: ReportView }) {
  return (
    <form method="get" action="/reports" className="daterange">
      <input type="hidden" name="tab" value={view.tab} />
      {view.tab === 'financial' ? <input type="hidden" name="by" value={view.by} /> : null}
      <input
        className="input"
        type="date"
        name="from"
        defaultValue={view.from}
        aria-label="From"
        required
      />
      <span className="muted">→</span>
      <input
        className="input"
        type="date"
        name="to"
        defaultValue={view.to}
        aria-label="To"
        required
      />
      <button type="submit" className="btn sm">
        Apply
      </button>
    </form>
  );
}
