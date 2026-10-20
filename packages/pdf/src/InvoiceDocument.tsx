/**
 * Draws THC's invoice (ADR-0176) as an A4 PDF, after THC's own invoice:
 * the mark and name top left, INVOICE top right, the company block, Invoice
 * to / Invoice details, the shift lines, the totals, Payment details and
 * the late-payment wording. Every string is `invoice.ts`'s; nothing is
 * priced here.
 *
 * Colours are literal, as on the timesheet: a document sent to a client's
 * accounts team, not a themed surface. The line table flows over as many
 * pages as it needs; a line is never split.
 */

import {
  Document,
  Page,
  Path,
  Svg,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { LOGO_CORK, LOGO_GLASSES, LOGO_VIEW_BOX } from './logo.ts';
import {
  INVOICE_COLUMNS,
  invoiceDate,
  invoiceEventDates,
  invoiceHours,
  invoiceMoney,
  invoiceRows,
  invoiceTerms,
  invoiceVatLabel,
} from './invoice.ts';
import type { InvoiceDocumentData } from './invoice.ts';

const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const RULE = '#dddddd';
const BAND = '#eeeeee';

/* 539pt between 28pt margins: Date · Staff · Role · Start · End · Break ·
   Hours · Rate · Total. */
const W = [56, 108, 92, 38, 38, 50, 44, 50, 63] as const;
const RIGHT = new Set([6, 7, 8]);

const s = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 40,
    paddingHorizontal: 28,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: INK,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandName: { fontSize: 10.5, letterSpacing: 1.5, marginLeft: 8, lineHeight: 1.25 },
  invoiceTitle: { marginLeft: 'auto', fontFamily: 'Helvetica-Bold', fontSize: 26 },
  company: { marginTop: 14 },
  companyName: { fontFamily: 'Helvetica-Bold', fontSize: 12, marginBottom: 4 },
  small: { fontSize: 8, color: '#444444', lineHeight: 1.4 },
  rule: { borderBottomWidth: 0.8, borderBottomColor: RULE, marginVertical: 14 },
  two: { flexDirection: 'row' },
  col: { width: '52%' },
  colR: { width: '48%' },
  label: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: MUTED,
    letterSpacing: 1,
    marginBottom: 6,
  },
  billName: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 2 },
  body: { fontSize: 9, lineHeight: 1.4 },
  kv: { flexDirection: 'row', marginBottom: 2 },
  k: { width: 92, fontSize: 8.5, color: MUTED },
  v: { fontSize: 9 },
  thead: { flexDirection: 'row', backgroundColor: BAND, paddingVertical: 6, marginTop: 18 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#444444', paddingHorizontal: 3 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: RULE, paddingVertical: 5 },
  td: { fontSize: 8, paddingHorizontal: 3 },
  totalsRow: { flexDirection: 'row', backgroundColor: BAND, paddingVertical: 6 },
  summary: { marginTop: 16, marginLeft: 'auto', width: 230 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  sumK: { fontSize: 9, color: '#444444' },
  sumV: { fontSize: 9 },
  due: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1.5,
    borderTopColor: INK,
    paddingTop: 6,
    marginTop: 4,
  },
  dueK: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  dueV: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  payTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 6 },
  payK: { width: 110, fontSize: 8.5, color: MUTED },
  late: {
    fontSize: 7.5,
    color: MUTED,
    lineHeight: 1.4,
    borderBottomWidth: 0.8,
    borderBottomColor: RULE,
    paddingBottom: 4,
  },
  thanks: { textAlign: 'center', fontSize: 10, color: '#444444', marginTop: 10 },
  thanksCo: { textAlign: 'center', fontSize: 8, color: MUTED, marginTop: 2 },
  pageNo: { position: 'absolute', bottom: 18, right: 28, fontSize: 7, color: MUTED },
});

function Cells({
  cells,
  style,
}: {
  cells: readonly string[];
  style: { fontSize: number; paddingHorizontal: number; fontFamily?: string; color?: string };
}) {
  return (
    <>
      {cells.map((text, i) => (
        <Text key={i} style={[style, { width: W[i], textAlign: RIGHT.has(i) ? 'right' : 'left' }]}>
          {text}
        </Text>
      ))}
    </>
  );
}

export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const co = data.seller.company ?? {};
  const bank = data.seller.bank ?? {};
  const rows = invoiceRows(data.lines);
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
            <Text style={s.billName}>{data.billTo.name}</Text>
            {data.billTo.contact ? <Text style={s.body}>{data.billTo.contact}</Text> : null}
            {(data.billTo.emails ?? []).slice(0, 1).map((e) => (
              <Text key={e} style={s.body}>
                {e}
              </Text>
            ))}
            {data.billTo.address ? <Text style={s.body}>{data.billTo.address}</Text> : null}
          </View>
          <View style={s.colR}>
            <Text style={s.label}>INVOICE DETAILS</Text>
            {[
              ['Invoice Number:', String(data.number)],
              ['Invoice Date:', invoiceDate(data.invoiceDate)],
              ['Event Date:', invoiceEventDates(data.periodFrom, data.periodTo)],
              ['PO Number:', data.poNumber ?? '—'],
            ].map(([k, v]) => (
              <View key={k} style={s.kv}>
                <Text style={s.k}>{k}</Text>
                <Text style={s.v}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.thead}>
          <Cells cells={INVOICE_COLUMNS} style={s.th} />
        </View>
        {rows.map((row, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Cells cells={row} style={s.td} />
          </View>
        ))}
        <View style={s.totalsRow} wrap={false}>
          <Cells
            cells={[
              '',
              '',
              '',
              '',
              '',
              'Totals',
              invoiceHours(data.payableMin),
              '',
              invoiceMoney(data.net),
            ]}
            style={{ ...s.td, fontFamily: 'Helvetica-Bold' }}
          />
        </View>

        <View style={s.summary} wrap={false}>
          {[
            ['Total Hours:', invoiceHours(data.payableMin)],
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

export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
