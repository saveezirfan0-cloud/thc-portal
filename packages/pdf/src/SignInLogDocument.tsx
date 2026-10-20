/**
 * Draws the sign-in / sign-out log attached to THC's invoice (ADR-0176,
 * amended 20.10.2026) as an A4 landscape PDF: the mark and the title, what
 * it supports, one table per event — who worked, when they were booked,
 * when they actually signed in and out, the break deducted and the hours
 * charged — and the total hours, which equal the invoice's. Every string is
 * `signInLog.ts`'s; nothing is worked out here.
 *
 * Colours are literal, as on the invoice: a document for a client's
 * accounts team, not a themed surface. A row is never split across pages.
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
import { invoiceHours } from './invoice.ts';
import type { InvoiceDocumentData } from './invoice.ts';
import { SIGN_IN_LOG_COLUMNS, signInLogSections, signInLogSubtitle } from './signInLog.ts';

const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const RULE = '#dddddd';
const BAND = '#eeeeee';

/* 786pt between 28pt margins (A4 landscape): Staff · Emp. ID · Role ·
   Booked · Signed in · Signed out · Break · Hours · Notes. */
const W = [140, 48, 100, 78, 62, 62, 58, 44, 194] as const;
const RIGHT = new Set([7]);

const s = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 28,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: INK,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandName: { fontSize: 10.5, letterSpacing: 1.5, marginLeft: 8, lineHeight: 1.25 },
  title: { marginLeft: 'auto', fontFamily: 'Helvetica-Bold', fontSize: 18 },
  subtitle: { marginTop: 10, fontSize: 10, fontFamily: 'Helvetica-Bold' },
  intro: { marginTop: 4, fontSize: 8, color: MUTED, lineHeight: 1.4 },
  section: { marginTop: 14 },
  heading: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginBottom: 4 },
  thead: { flexDirection: 'row', backgroundColor: BAND, paddingVertical: 5 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#444444', paddingHorizontal: 3 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: RULE, paddingVertical: 4 },
  td: { fontSize: 8, paddingHorizontal: 3 },
  subtotal: { flexDirection: 'row', paddingVertical: 4 },
  total: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1.2,
    borderTopColor: INK,
    marginTop: 12,
    paddingTop: 6,
  },
  totalK: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 8 },
  totalV: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  pageNo: { position: 'absolute', bottom: 18, right: 28, fontSize: 7, color: MUTED },
  foot: { position: 'absolute', bottom: 18, left: 28, fontSize: 7, color: MUTED },
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

export function SignInLogDocument({ data }: { data: InvoiceDocumentData }) {
  const sections = signInLogSections(data);
  const co = data.seller.company ?? {};
  return (
    <Document
      title={`Sign-in and sign-out log · Invoice ${data.number}`}
      author={co.name ?? 'The Hospitality Company'}
    >
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.top}>
          <View style={s.brand}>
            <Svg viewBox={LOGO_VIEW_BOX} width={20} height={31}>
              <Path d={LOGO_GLASSES} fill={INK} />
              <Path d={LOGO_CORK} fill={INK} />
            </Svg>
            <Text style={s.brandName}>{'THE HOSPITALITY\n     COMPANY'}</Text>
          </View>
          <Text style={s.title}>SIGN-IN AND SIGN-OUT LOG</Text>
        </View>

        <Text style={s.subtitle}>{signInLogSubtitle(data)}</Text>
        <Text style={s.intro}>
          Each worker signs in and out in the THC Staff App at the venue. Times are UK time
          (24-hour). Hours are the time worked within the booked shift, less unpaid breaks, and are
          the hours charged on the invoice.
        </Text>

        {sections.map((section) => (
          <View key={section.heading} style={s.section}>
            <Text style={s.heading} minPresenceAhead={40}>
              {section.heading}
            </Text>
            <View style={s.thead}>
              <Cells cells={SIGN_IN_LOG_COLUMNS} style={s.th} />
            </View>
            {section.rows.map((row, i) => (
              <View key={i} style={s.tr} wrap={false}>
                <Cells cells={row} style={s.td} />
              </View>
            ))}
            <View style={s.subtotal} wrap={false}>
              <Cells
                cells={['', '', '', '', '', '', 'Hours', invoiceHours(section.payableMin), '']}
                style={{ ...s.td, fontFamily: 'Helvetica-Bold' }}
              />
            </View>
          </View>
        ))}

        <View style={s.total} wrap={false}>
          <Text style={s.totalK}>Total hours (as invoiced):</Text>
          <Text style={s.totalV}>{invoiceHours(data.payableMin)}</Text>
        </View>

        <Text style={s.foot} fixed>
          {co.name ?? 'The Hospitality Company'}
          {co.email ? ` · ${co.email}` : ''}
        </Text>
        <Text
          style={s.pageNo}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Invoice ${data.number} · Sign-in log · Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderSignInLogPdf(data: InvoiceDocumentData): Promise<Buffer> {
  return renderToBuffer(<SignInLogDocument data={data} />);
}
