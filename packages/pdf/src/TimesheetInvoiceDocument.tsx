/**
 * Draws a timesheet invoice (ADR-0210) as an A4 PDF — the Back Office
 * invoice (`InvoiceDocument.tsx`: same mark, company block, tokens and
 * fonts) with the old tool's two line layouts, named staff or role
 * aggregated, and a due date. Every string is `timesheetInvoice.ts`'s;
 * nothing is priced here.
 */

import { Document, Page, Path, Svg, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { LOGO_CORK, LOGO_GLASSES, LOGO_VIEW_BOX } from './logo.ts';
import { INVOICE_INK as INK, invoiceStyles as s } from './InvoiceDocument.tsx';
import { invoiceMoney, invoiceTerms, invoiceVatLabel } from './invoice.ts';
import type { InvoiceDocumentData } from './invoice.ts';
import {
  TIMESHEET_RIGHT,
  timesheetBillTo,
  timesheetColumns,
  timesheetDetails,
  timesheetHours,
  timesheetRows,
  timesheetTotalHours,
  timesheetTotalsRow,
  timesheetWidths,
} from './timesheetInvoice.ts';

function Cells({
  cells,
  widths,
  style,
}: {
  cells: readonly string[];
  widths: readonly number[];
  style: { fontSize: number; paddingHorizontal: number; fontFamily?: string; color?: string };
}) {
  return (
    <>
      {cells.map((text, i) => (
        <Text
          key={i}
          style={[
            style,
            { width: widths[i], textAlign: TIMESHEET_RIGHT.has(i) ? 'right' : 'left' },
          ]}
        >
          {text}
        </Text>
      ))}
    </>
  );
}

export function TimesheetInvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const co = data.seller.company ?? {};
  const bank = data.seller.bank ?? {};
  const widths = timesheetWidths(data);
  const rows = timesheetRows(data);
  const bill = timesheetBillTo(data);
  return (
    <Document title={`Invoice ${data.number}`} author={co.name ?? 'The Hospitality Company'}>
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <View style={s.brand}>
            <Svg viewBox={LOGO_VIEW_BOX} width={22} height={34}>
              <Path d={LOGO_GLASSES} fill={INK} />
              <Path d={LOGO_CORK} fill={INK} />
            </Svg>
            <Text style={s.brandName}>{'THE HOSPITALITY\n     COMPANY'}</Text>
          </View>
          <Text style={s.invoiceTitle}>INVOICE</Text>
        </View>

        <View style={s.company}>
          <Text style={s.companyName}>{co.name ?? ''}</Text>
          {co.company_reg ? <Text style={s.small}>Company Reg: {co.company_reg}</Text> : null}
          {co.vat_reg ? <Text style={s.small}>VAT Reg: {co.vat_reg}</Text> : null}
          {co.email ? <Text style={s.small}>{co.email}</Text> : null}
          {co.website ? <Text style={s.small}>{co.website}</Text> : null}
        </View>

        <View style={s.rule} />

        <View style={s.two}>
          <View style={s.col}>
            <Text style={s.label}>INVOICE TO</Text>
            <Text style={s.billName}>{bill.name}</Text>
            {bill.lines.map((line) => (
              <Text key={line} style={s.body}>
                {line}
              </Text>
            ))}
          </View>
          <View style={s.colR}>
            <Text style={s.label}>INVOICE DETAILS</Text>
            {timesheetDetails(data).map(([k, v]) => (
              <View key={k} style={s.kv}>
                <Text style={s.k}>{k}</Text>
                <Text style={s.v}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.thead}>
          <Cells cells={timesheetColumns(data)} widths={widths} style={s.th} />
        </View>
        {rows.map((row, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Cells cells={row} widths={widths} style={s.td} />
          </View>
        ))}
        <View style={s.totalsRow} wrap={false}>
          <Cells
            cells={timesheetTotalsRow(data)}
            widths={widths}
            style={{ ...s.td, fontFamily: 'Helvetica-Bold' }}
          />
        </View>

        <View style={s.summary} wrap={false}>
          {[
            ['Total Hours:', timesheetHours(timesheetTotalHours(data.lines))],
            ['Subtotal:', invoiceMoney(data.net)],
            [`${invoiceVatLabel(data.vatRate)}:`, invoiceMoney(data.vat)],
          ].map(([k, v]) => (
            <View key={k} style={s.sumRow}>
              <Text style={s.sumK}>{k}</Text>
              <Text style={s.sumV}>{v}</Text>
            </View>
          ))}
          <View style={s.due}>
            <Text style={s.dueK}>TOTAL DUE:</Text>
            <Text style={s.dueV}>{invoiceMoney(data.total)}</Text>
          </View>
        </View>

        <View style={s.rule} />

        <View wrap={false}>
          <Text style={s.payTitle}>Payment Details</Text>
          {[
            ['Account Name:', bank.account_name ?? ''],
            ['Bank:', bank.bank ?? ''],
            ['Account Number:', bank.account_number ?? ''],
            ['Sort Code:', bank.sort_code ?? ''],
            ['Payment Terms:', invoiceTerms(data.termsDays)],
          ].map(([k, v]) => (
            <View key={k} style={s.kv}>
              <Text style={s.payK}>{k}</Text>
              <Text style={s.v}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.rule} />

        <View wrap={false}>
          {data.seller.late_payment_note ? (
            <Text style={s.late}>{data.seller.late_payment_note}</Text>
          ) : null}
          <Text style={s.thanks}>Thank you for your business</Text>
          <Text style={s.thanksCo}>{co.name ?? ''}</Text>
        </View>

        <Text
          style={s.pageNo}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Invoice ${data.number} · Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderTimesheetInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return renderToBuffer(<TimesheetInvoiceDocument data={data} />);
}
