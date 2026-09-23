/**
 * Draws a `SheetLayout` as an A4 PDF — Scope §11.3.
 *
 * Library: @react-pdf/renderer, which was already this package's dependency
 * and already in the lockfile, and which runs in plain Node — a Vercel
 * serverless route handler — with no headless browser. The office app lists
 * it in `serverExternalPackages` so Next does not try to bundle it.
 *
 * Nothing is decided here. Page breaks, headings, "(continued)", the footer
 * on the last page only, every cell's text: all of it is `layoutSheet()`,
 * held by the golden files. Each <Page> is drawn with `wrap={false}` and
 * sized so twelve rows plus the worst-case section headings and the footer
 * fit, so react-pdf never adds a page of its own and "Page X of Y" stays the
 * layout's count.
 *
 * Colours are literal here, unlike every screen: this is a printed form that
 * matches THC's paper one, not a themed surface, and it has to read the same
 * in black and white.
 */

import type { ReactNode } from 'react';
import { Document, Image, Page, Path, Svg, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { LOGO_CORK, LOGO_GLASSES, LOGO_VIEW_BOX } from './logo.ts';
import { COMPANY, COMPANY_LINE, SHEET_COLUMNS, SHEET_TITLE } from './sheet.ts';
import type { SheetLayout, SheetPage, SheetRow } from './sheet.ts';

/** A photo that can be embedded: react-pdf draws PNG and JPEG only. */
export interface SheetPhoto {
  data: Buffer;
  format: 'png' | 'jpg';
}

/** Keyed by `SheetRow.photoPath`. A missing key is an empty Photo cell. */
export type SheetPhotos = ReadonlyMap<string, SheetPhoto>;

const INK = '#111111';
const MUTED = '#5b5b5b';
const RULE = '#9a9a9a';
const SECTION_FILL = '#eeeeee';

/* Column widths from the wireframe's colgroup (52/196/74/70/118/130/74),
   scaled to A4 inside 28pt margins: 539pt. */
const WIDTHS = [39, 148, 56, 53, 89, 98, 56] as const;
const ROW_H = 32;
const PHOTO = 26;

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 24, paddingHorizontal: 28, fontFamily: 'Helvetica', fontSize: 8.5, color: INK },
  head: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 8 },
  logo: { width: 30, height: 30, borderRadius: 15, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  brandSub: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  titleBox: { marginLeft: 'auto', alignItems: 'flex-end' },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 14, letterSpacing: 1 },
  date: { fontSize: 9, marginTop: 2 },
  ev: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 6 },
  evName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  cont: { fontSize: 9, color: MUTED, marginLeft: 6 },
  po: { marginLeft: 'auto', fontSize: 9 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: INK },
  tr: { flexDirection: 'row' },
  th: {
    fontFamily: 'Helvetica-Bold', fontSize: 7.5, textAlign: 'center', paddingVertical: 4, paddingHorizontal: 2,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: INK,
  },
  td: { height: ROW_H, paddingHorizontal: 3, justifyContent: 'center', borderRightWidth: 1, borderBottomWidth: 1, borderColor: RULE },
  tdLast: { borderRightColor: INK },
  center: { textAlign: 'center' },
  sec: {
    fontFamily: 'Helvetica-Bold', fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 4, backgroundColor: SECTION_FILL,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: INK,
  },
  photo: { width: PHOTO, height: PHOTO, objectFit: 'cover', alignSelf: 'center' },
  name: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  id: { fontSize: 7.5, color: MUTED },
  role: { fontSize: 7.5, marginTop: 1 },
  foot: { marginTop: 10 },
  sign: { flexDirection: 'row', borderTopWidth: 1, borderLeftWidth: 1, borderColor: INK },
  signCell: { flex: 1, height: 44, padding: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: INK },
  signKey: { fontSize: 7, color: MUTED, textTransform: 'uppercase' },
  signVal: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 6 },
  company: { fontSize: 7.5, color: MUTED, marginTop: 6, textAlign: 'center' },
  pageNo: { position: 'absolute', bottom: 10, right: 28, fontSize: 7.5, color: MUTED },
});

function Logo() {
  return (
    <View style={s.logo}>
      <Svg viewBox={LOGO_VIEW_BOX} width={14} height={22}>
        <Path d={LOGO_GLASSES} fill="#ffffff" />
        <Path d={LOGO_CORK} fill="#ffffff" />
      </Svg>
    </View>
  );
}

function Header({ layout, page }: { layout: SheetLayout; page: SheetPage }) {
  return (
    <>
      <View style={s.head}>
        <Logo />
        <View>
          <Text style={s.brandName}>{COMPANY.name}</Text>
          <Text style={s.brandSub}>{COMPANY.strapline}</Text>
        </View>
        <View style={s.titleBox}>
          <Text style={s.title}>{SHEET_TITLE}</Text>
          <Text style={s.date}>Date: {layout.dateLabel}</Text>
        </View>
      </View>
      <View style={s.ev}>
        <Text style={s.evName}>
          {page.continued ? `${layout.title} · ${layout.dateLabel}` : layout.title}
        </Text>
        {page.continued ? <Text style={s.cont}>(continued)</Text> : null}
        {layout.poNumber ? <Text style={s.po}>PO Number: {layout.poNumber}</Text> : null}
      </View>
    </>
  );
}

function Cell({ index, children, center }: { index: number; children?: ReactNode; center?: boolean }) {
  return (
    <View style={[s.td, { width: WIDTHS[index] }, index === WIDTHS.length - 1 ? s.tdLast : {}]}>
      {typeof children === 'string' ? <Text style={center ? s.center : {}}>{children}</Text> : children}
    </View>
  );
}

function Row({ row, photos }: { row: SheetRow; photos: SheetPhotos }) {
  const photo = row.photoPath ? photos.get(row.photoPath) : undefined;
  return (
    <View style={s.tr} wrap={false}>
      <Cell index={0}>{photo ? <Image style={s.photo} src={{ data: photo.data, format: photo.format }} /> : null}</Cell>
      <Cell index={1}>
        <Text>
          <Text style={s.name}>{row.name}</Text>
          {row.idLabel ? <Text style={s.id}> {row.idLabel}</Text> : null}
        </Text>
        <Text style={s.role}>{row.role}</Text>
      </Cell>
      <Cell index={2} center>{row.startTime}</Cell>
      <Cell index={3} center>{row.finishTime}</Cell>
      <Cell index={4}>{row.signature}</Cell>
      <Cell index={5}>{row.comments}</Cell>
      <Cell index={6} center>{row.hoursWorked}</Cell>
    </View>
  );
}

function Footer({ layout }: { layout: SheetLayout }) {
  return (
    <View style={s.foot}>
      <View style={s.sign}>
        <View style={s.signCell}>
          <Text style={s.signKey}>Total Hours</Text>
          <Text style={s.signVal}>{layout.totalHours}</Text>
        </View>
        <View style={s.signCell}>
          <Text style={s.signKey}>Manager&apos;s Name (PRINT)</Text>
        </View>
        <View style={s.signCell}>
          <Text style={s.signKey}>Manager&apos;s Signature</Text>
        </View>
        <View style={s.signCell}>
          <Text style={s.signKey}>Date</Text>
        </View>
      </View>
      <Text style={s.company}>{COMPANY_LINE}</Text>
    </View>
  );
}

export function SheetDocument({ layout, photos }: { layout: SheetLayout; photos?: SheetPhotos }) {
  const images = photos ?? new Map<string, SheetPhoto>();
  return (
    <Document title={layout.title} author={COMPANY.name} creator={COMPANY.name} producer={COMPANY.name}>
      {layout.pages.map((page) => (
        <Page key={page.number} size="A4" style={s.page} wrap={false}>
          <Header layout={layout} page={page} />
          <View style={s.table}>
            <View style={s.tr}>
              {SHEET_COLUMNS.map((label, index) => (
                <Text key={label} style={[s.th, { width: WIDTHS[index] }]}>
                  {label}
                </Text>
              ))}
            </View>
            {page.lines.map((line, index) =>
              line.type === 'section' ? (
                <Text key={`s${index}`} style={s.sec}>
                  {line.label}
                </Text>
              ) : (
                <Row key={line.row.bookingId} row={line.row} photos={images} />
              ),
            )}
          </View>
          {page.footer ? <Footer layout={layout} /> : null}
          <Text style={s.pageNo}>
            Page {page.number} of {page.of}
          </Text>
        </Page>
      ))}
    </Document>
  );
}

/** The PDF bytes for a laid-out sheet. Node only (route handlers, tests). */
export async function renderSheetPdf(layout: SheetLayout, photos?: SheetPhotos): Promise<Buffer> {
  return renderToBuffer(<SheetDocument layout={layout} photos={photos} />);
}

/**
 * PNG or JPEG by magic number, or null for anything react-pdf cannot embed
 * (WebP, HEIC). An unembeddable selfie leaves the Photo cell empty rather
 * than failing the whole sheet.
 */
export function photoFormat(bytes: Uint8Array): SheetPhoto['format'] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Counts the pages in rendered PDF bytes, for tests and the document log. */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
