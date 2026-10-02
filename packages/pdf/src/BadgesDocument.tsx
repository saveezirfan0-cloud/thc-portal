/**
 * Draws a `BadgeLayout` as an A4 PDF of cut-out name badges — ADR-0081.
 *
 * Every page is a full A4 portrait sheet with ten 86 × 54 mm badges, two
 * across and five down, centred, with dashed cut lines shared between
 * neighbours. Each badge is the THC lockup (mark above the wordmark, from
 * `brand/thc-lockup.svg` via lockup.ts) and the first name under it.
 *
 * Nothing is decided here — who gets a badge, in what order, what it says
 * and which page it lands on is `layoutBadges()`. Colours are literal, as on
 * the sheet: this is a printed card, not a themed surface, and it has to
 * read the same in black and white.
 */

import {
  Document,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { BADGE_COLUMNS, BADGE_ROWS, BADGE_SIZE, badgeNameSize } from './badges.ts';
import type { Badge, BadgeLayout } from './badges.ts';
import { LOCKUP_PATHS, LOCKUP_VIEW_BOX } from './lockup.ts';
import { COMPANY } from './sheet.ts';

const INK = '#111111';
const CUT = '#9a9a9a';
/** The dashed cut line. The grid's own top and left line sit outside the badges. */
const CUT_W = 0.5;

/** A4 portrait in points (SheetDocument's A4_POINTS, restated to stay acyclic). */
const A4 = { width: 595.28, height: 841.89 } as const;
const GRID_WIDTH = BADGE_SIZE.width * BADGE_COLUMNS + CUT_W;
const GRID_HEIGHT = BADGE_SIZE.height * BADGE_ROWS + CUT_W;

/* The lockup's own proportions (viewBox 868.4 × 768), 25 mm tall: big enough
   that "The Hospitality Company" under the glasses reads at arm's length. */
const [, , VB_W, VB_H] = LOCKUP_VIEW_BOX.split(/\s+/).map(Number) as [
  number,
  number,
  number,
  number,
];
const LOCKUP_H = 72;
const LOCKUP_W = (LOCKUP_H * VB_W) / VB_H;

const s = StyleSheet.create({
  page: {
    paddingTop: (A4.height - GRID_HEIGHT) / 2,
    paddingLeft: (A4.width - GRID_WIDTH) / 2,
    fontFamily: 'Helvetica',
    color: INK,
  },
  grid: {
    width: GRID_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: CUT_W,
    borderLeftWidth: CUT_W,
    borderColor: CUT,
    borderStyle: 'dashed',
  },
  badge: {
    width: BADGE_SIZE.width,
    height: BADGE_SIZE.height,
    borderRightWidth: CUT_W,
    borderBottomWidth: CUT_W,
    borderColor: CUT,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  name: {
    fontFamily: 'Helvetica-Bold',
    marginTop: 6,
    textAlign: 'center',
    maxLines: 1,
    textOverflow: 'ellipsis',
  },
});

function Lockup() {
  return (
    <Svg viewBox={LOCKUP_VIEW_BOX} width={LOCKUP_W} height={LOCKUP_H}>
      {LOCKUP_PATHS.map((d, index) => (
        <Path key={index} d={d} fill={INK} />
      ))}
    </Svg>
  );
}

function BadgeCard({ badge }: { badge: Badge }) {
  return (
    <View style={s.badge} wrap={false}>
      <Lockup />
      <Text style={[s.name, { fontSize: badgeNameSize(badge.name) }]}>{badge.name}</Text>
    </View>
  );
}

export function BadgesDocument({ layout }: { layout: BadgeLayout }) {
  return (
    <Document
      title={layout.title}
      author={COMPANY.name}
      creator={COMPANY.name}
      producer={COMPANY.name}
    >
      {layout.pages.map((page) => (
        <Page key={page.number} size="A4" orientation="portrait" style={s.page}>
          {page.badges.length > 0 ? (
            <View style={s.grid}>
              {page.badges.map((badge) => (
                <BadgeCard key={badge.bookingId} badge={badge} />
              ))}
            </View>
          ) : null}
        </Page>
      ))}
    </Document>
  );
}

/** The PDF bytes for laid-out badges. Node only (route handlers, tests). */
export async function renderBadgesPdf(layout: BadgeLayout): Promise<Buffer> {
  return renderToBuffer(<BadgesDocument layout={layout} />);
}
