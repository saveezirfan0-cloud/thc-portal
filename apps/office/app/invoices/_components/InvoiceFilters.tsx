import Link from 'next/link';
import { Select, UkDateField } from '@thc/ui';
import type { ClientOption } from '../_lib/types';
import {
  QUICK_RANGES,
  STATUS_GROUPS,
  STATUS_GROUP_LABEL,
  XERO_FILTER_LABEL,
  listHref,
} from '../_lib/view-model';
import type { InvoiceView, XeroFilter } from '../_lib/view-model';

/**
 * The filters of "All generated invoices" (audit §2.4): client, From / To
 * (typed dd/mm/yyyy), the quick ranges, a "# / client / PO" search, the
 * status chips, and — new with ADR-0210 — Source and Xero. A plain GET form:
 * the filters live in the URL, so a list can be bookmarked or sent to
 * someone and opens on the same invoices.
 *
 * The old tool's Paid chip is gone: this database has no paid state
 * (credit notes and payments are Xero's). The chips are Draft / Generated,
 * Sent and Void, with Void off by default.
 */
export function InvoiceFilters({ view, clients }: { view: InvoiceView; clients: ClientOption[] }) {
  return (
    <form method="get" action="/invoices" className="inv-filters" aria-label="Filter invoices">
      <input type="hidden" name="f" value="1" />
      {view.tab !== 'all' ? <input type="hidden" name="tab" value={view.tab} /> : null}
      <div className="row">
        <Select
          name="client"
          aria-label="Client"
          className="inv-client"
          defaultValue={view.client}
        >
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
        <div className="daterange">
          <UkDateField label="From (UK date)" labelHidden name="from" defaultValue={view.from ?? ''} />
          <span className="muted">→</span>
          <UkDateField label="To (UK date)" labelHidden name="to" defaultValue={view.to ?? ''} />
        </div>
        <input
          className="input inv-search"
          type="search"
          name="q"
          defaultValue={view.q}
          placeholder="Search # / client / PO…"
          aria-label="Search by number, client or PO"
        />
        <button type="submit" className="btn sm primary">
          Apply
        </button>
        <Link className="btn sm ghost" href="/invoices">
          Clear All
        </Link>
      </div>

      <div className="row">
        <div className="inv-ranges" role="group" aria-label="Quick ranges">
          {QUICK_RANGES.map((range) => (
            <Link
              key={range.value}
              className={`btn sm${view.range === range.value || (range.value === 'all' && view.range === 'all') ? ' primary' : ''}`}
              href={listHref(view, { range: range.value, from: null, to: null, page: 1 })}
            >
              {range.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="row">
        {STATUS_GROUPS.map((group) => (
          <label key={group} className="inv-chip">
            <input
              type="checkbox"
              name="status"
              value={group}
              defaultChecked={view.statuses.includes(group)}
            />
            {STATUS_GROUP_LABEL[group]}
          </label>
        ))}
        <Select name="source" aria-label="Source" defaultValue={view.source}>
          <option value="">Source: all</option>
          <option value="events">Source: Events</option>
          <option value="timesheet">Source: Timesheet</option>
        </Select>
        <Select name="xero" aria-label="Xero" defaultValue={view.xero}>
          <option value="">Xero: all</option>
          {(Object.keys(XERO_FILTER_LABEL) as Exclude<XeroFilter, ''>[]).map((key) => (
            <option key={key} value={key}>
              Xero: {XERO_FILTER_LABEL[key]}
            </option>
          ))}
        </Select>
      </div>
    </form>
  );
}
