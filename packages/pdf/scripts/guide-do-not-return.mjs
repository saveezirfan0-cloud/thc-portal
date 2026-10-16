#!/usr/bin/env node
/**
 * Back Office guide: keeping a worker away from a client ("Do not return"),
 * including the case where the worker is NOT qualified at that client.
 *
 *   node packages/pdf/scripts/guide-do-not-return.mjs     (from the repository root)
 *
 * writes  docs/pdfs/THC-Guide-Do-Not-Return.pdf   (the deliverable)
 *    and  docs/21-guide-do-not-return.md          (the Markdown twin)
 *
 * from the ONE content structure at the top of this file (`DOC`), so the two
 * never drift. Same approach as thc-inputs.mjs: React.createElement against
 * @react-pdf/renderer, Plus Jakarta Sans fetched once into a cache directory
 * (THC_PDF_FONT_DIR, or <tmp>/thc-pdf-fonts), Helvetica if that is not possible.
 *
 * Sources: scope §9.6 (Client qualification, Do-not-return); the Qualifications
 * tab (apps/office/app/staff/[id]/Qualifications.tsx); set_do_not_return()
 * (20261014093100); the pool gate in auto_assign_candidates_pool()
 * (20261012140000); the client card (apps/office/app/clients/[id]).
 */
import { createElement as h } from 'react';
import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT_PDF = path.join(ROOT, 'docs/pdfs/THC-Guide-Do-Not-Return.pdf');
const OUT_MD = path.join(ROOT, 'docs/21-guide-do-not-return.md');
const MARK = path.join(ROOT, 'brand/thc-mark.png');

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CONTENT
// ═══════════════════════════════════════════════════════════════════════════
// Block kinds: p · bullets · steps · table {head, rows, widths} · note {tone, text}
// Inline **bold** is supported in p, bullets, steps, note and table cells.

const DOC = {
  title: 'Keeping a worker away from a client',
  subtitle: 'Back Office guide · “Do not return”, including a worker who is not qualified there',
  version: 'Version 1.0 · 16.10.2026 · Scope v1.6 §9.6',
  sections: [
    {
      heading: 'The short answer',
      blocks: [
        {
          kind: 'p',
          text: 'To stop a worker being offered a client’s shifts, switch **Do not return** on for that client. It is the only hard gate in client qualification. Removing a qualification is not the same thing, and a worker who was never qualified at the client has nothing to remove.',
        },
        {
          kind: 'p',
          text: 'The switch lives on a client qualification row, so a worker with no row for the client has no switch yet. The fix is two steps: **add the client to the worker (any one of their roles), then switch Do not return on for that row.** The bar overrides the qualification. Adding the row does not make them first choice for anything.',
        },
      ],
    },
    {
      heading: 'Which control do I need?',
      blocks: [
        {
          kind: 'table',
          head: ['Control', 'Where', 'What it does', 'Use it when'],
          widths: [1.1, 1.4, 2.6, 2.1],
          rows: [
            [
              '**Do not return**',
              'Profile > Client qualification, or client card > Qualified staff',
              'Excluded from this client outright: not invited in either wave, shift never on their Radar, cannot be invited manually. Needs a reason.',
              'A client has asked for someone not to come back, or you decide they should not.',
            ],
            [
              'Remove',
              'Same row',
              'Takes the worker out of Wave 1 (first choice) for that client and role only. A later clean shift can grant it again.',
              'The worker should no longer be a first-choice name. Not a bar.',
            ],
            [
              'Block',
              'Profile (header)',
              'Bars the worker everywhere, from every client.',
              'The worker should not be booked at all.',
            ],
          ],
        },
      ],
    },
    {
      heading: 'Steps: the worker is not qualified at the client',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open **Staff**, then the worker’s profile, then the **Client qualification** tab.',
            'Click **+ Add client**. Choose the client from the directory. If it is not listed, create it under **Clients** first.',
            'Tick **one** of the worker’s roles (the list offers only roles they already hold). One is enough: the bar covers every role at that client. Leave the note empty: the reason you give in step 6 is saved in the note and replaces anything typed here.',
            'Click **Add**. A row for the client appears with Do not return off.',
            'On that row, switch **Do not return** on. A dialog opens.',
            'Type the **Reason** (required). Write what the next person needs to decide whether to lift it: who asked, when, and why if known. It is shown on that client’s events under *Unavailable > Do not return*, appears in the row’s Note column, and is kept if the flag is ever switched off.',
            'Click **Do not return**. The row turns red and its **Remove** button is disabled.',
            'Check the worker’s **Shifts** tab and open invitations for the client, and withdraw anything already in place (see “What it does not do”).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Already qualified?** Skip steps 2–4. Open the existing row and switch Do not return on. The same switch is on the client card under **Qualified staff** if you are starting from the client’s side.',
        },
      ],
    },
    {
      heading: 'Worked example: Jonathan Ryder at Mandarin Oriental',
      blocks: [
        {
          kind: 'p',
          text: 'Mandarin Oriental has asked that Jonathan Ryder does not return. He has no qualification there. On his profile the tab lists only United Grand Lodge (Waiting Staff and Waiting Staff (UGLE)), so there is no Mandarin Oriental row and no switch.',
        },
        {
          kind: 'table',
          head: ['Field', 'Value'],
          widths: [2, 5],
          rows: [
            ['Worker', 'Jonathan Ryder · THC-06096'],
            ['Client', 'Mandarin Oriental'],
            [
              'Role to tick',
              'Waiting Staff (either of his two roles works; the bar is client-wide)',
            ],
            [
              'Reason (example)',
              'Mandarin Oriental asked that he does not return. Request received DD.MM.YYYY from [name]. Replace with the real date, contact and reason.',
            ],
            [
              'Result',
              'Not offered Mandarin Oriental shifts in either wave, never on his Radar, cannot be invited manually.',
            ],
            ['His United Grand Lodge rows', 'Untouched. The bar is per client.'],
          ],
        },
      ],
    },
    {
      heading: 'What it does',
      blocks: [
        {
          kind: 'bullets',
          items: [
            '**Auto-assign:** the worker is filtered out as `do_not_return` before scoring, so they appear in neither Wave 1 nor Wave 2. The check is any row for that worker and client carrying the flag, whatever its role.',
            '**Radar:** the client’s shifts never appear to them.',
            '**Manual invites:** the office cannot invite them to that client’s events.',
            '**One switch, all rows:** the flag is stored per row, but switching it moves every row the worker has at that client together.',
            '**Audit:** switching on and off is written to the audit log with the reason.',
            '**Safe from a mis-click:** while it is on, Remove is disabled, so nobody can delete the row and quietly un-bar the worker.',
          ],
        },
      ],
    },
    {
      heading: 'What it does not do',
      blocks: [
        {
          kind: 'bullets',
          items: [
            '**It does not withdraw anything already in place.** The function only sets the flag and writes the audit row. An invitation already sent, or a booking already made, at that client stays until you withdraw or cancel it by hand.',
            '**It does not tell the worker.** The action sends no notification. Tell them yourself if that is appropriate.',
            '**It does not affect other clients.** For a bar everywhere use Block on the profile.',
          ],
        },
      ],
    },
    {
      heading: 'Lifting it later',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open the worker’s Client qualification tab, or the client card under Qualified staff.',
            'Switch **Do not return** off. No reason is needed, and the old reason is kept.',
            'If the row was only there to carry the bar, you may now **Remove** it. Remove asks for confirmation.',
          ],
        },
      ],
    },
    {
      heading: 'If something does not work',
      blocks: [
        {
          kind: 'table',
          head: ['You see', 'Why', 'What to do'],
          widths: [2, 2.6, 2.6],
          rows: [
            [
              'The role list is empty or missing the role you want',
              'It offers only roles the worker already holds.',
              'Add the role on the profile Overview first, or tick another role they hold.',
            ],
            [
              'Buttons are greyed out',
              'The profile has been removed (GDPR), or you are signed in as a read-only viewer.',
              'A removed profile cannot be edited. Ask an office admin if you only have viewer access.',
            ],
            [
              'The dialog will not confirm',
              'The reason is empty.',
              'Enter a reason. It is required.',
            ],
            [
              'Remove is disabled on the row',
              'Do not return is on.',
              'Switch it off first. This is intended.',
            ],
            [
              'The worker still sees a Mandarin Oriental shift',
              'It was offered or booked before the bar.',
              'Withdraw the invitation or cancel the booking by hand.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**Known quirk:** the tab has no way to bar a worker who has no row at that client, hence the add-then-bar workaround above. It is safe, but a direct “bar this client” action would be tidier. That would be a product change and is not built.',
        },
      ],
    },
    {
      heading: 'Quick reference for any worker and client',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Staff > worker > Client qualification.',
            'No row for the client? **+ Add client** > client > one role > Add.',
            'Switch **Do not return** on > enter the reason > confirm.',
            'Withdraw any invitation or booking already in place at that client.',
          ],
        },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// 2 · MARKDOWN TWIN
// ═══════════════════════════════════════════════════════════════════════════

const mdCell = (s) => s.replace(/\|/g, '\\|');

function mdBlock(b) {
  switch (b.kind) {
    case 'p':
      return b.text;
    case 'bullets':
      return b.items.map((t) => `- ${t}`).join('\n');
    case 'steps':
      return b.items.map((t, i) => `${i + 1}. ${t}`).join('\n');
    case 'note':
      return `> ${b.text}`;
    case 'table':
      return [
        `| ${b.head.map(mdCell).join(' | ')} |`,
        `| ${b.head.map(() => '---').join(' | ')} |`,
        ...b.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`),
      ].join('\n');
    default:
      throw new Error(`unknown block ${b.kind}`);
  }
}

function toMarkdown(doc) {
  const out = [
    `# 21 · ${doc.title}`,
    '',
    `_${doc.subtitle}. ${doc.version}._`,
    '',
    'Generated from `packages/pdf/scripts/guide-do-not-return.mjs` together with `docs/pdfs/THC-Guide-Do-Not-Return.pdf`. Edit the script, not this file.',
    '',
  ];
  for (const sec of doc.sections) {
    out.push(`## ${sec.heading}`, '');
    for (const b of sec.blocks) out.push(mdBlock(b), '');
  }
  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · PDF
// ═══════════════════════════════════════════════════════════════════════════

const NAVY = '#141A2C';
const CYAN = '#3EDCEC';
const TEAL = '#0B8A99';
const CREAM = '#F6F4EF';
const MUTED = '#5A6072';
const RULE = '#D9D5CC';
const CORAL = '#C2410C';

const OLD_UA = 'Mozilla/5.0 (Windows NT 6.1; rv:2.0) Gecko/20100101 Firefox/4.0';
const FONT_WEIGHTS = [400, 600, 700];

async function registerFonts() {
  const dir = process.env.THC_PDF_FONT_DIR || path.join(os.tmpdir(), 'thc-pdf-fonts');
  const file = (w) => path.join(dir, `plus-jakarta-sans-${w}.woff`);
  const present = (w) => fs.existsSync(file(w)) && fs.statSync(file(w)).size > 1000;
  try {
    if (!FONT_WEIGHTS.every(present)) {
      fs.mkdirSync(dir, { recursive: true });
      const cssUrl = `https://fonts.googleapis.com/css?family=Plus+Jakarta+Sans:${FONT_WEIGHTS.join(',')}`;
      const css = await (
        await fetch(cssUrl, {
          headers: { 'user-agent': OLD_UA },
          signal: AbortSignal.timeout(20000),
        })
      ).text();
      for (const w of FONT_WEIGHTS) {
        if (present(w)) continue;
        const m = new RegExp(`font-weight:\\s*${w};[^}]*?url\\(([^)]+\\.woff)\\)`).exec(css);
        if (!m) throw new Error(`no static WOFF for weight ${w} in the Google Fonts CSS`);
        const res = await fetch(m[1], { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`${res.status} fetching weight ${w}`);
        fs.writeFileSync(file(w), Buffer.from(await res.arrayBuffer()));
      }
    }
    Font.register({
      family: 'Plus Jakarta Sans',
      fonts: FONT_WEIGHTS.map((w) => ({ src: file(w), fontWeight: w })),
    });
    return 'Plus Jakarta Sans';
  } catch (err) {
    console.error(
      `guide-do-not-return: Plus Jakarta Sans not available (${err.message}); falling back to Helvetica.`,
    );
    return 'Helvetica';
  }
}

Font.registerHyphenationCallback((word) => [word]);

let FAMILY = 'Helvetica';
let s;

function buildStyles() {
  const bold = { fontFamily: FAMILY, fontWeight: 700 };
  s = StyleSheet.create({
    page: {
      paddingTop: 54,
      paddingBottom: 60,
      paddingHorizontal: 50,
      fontFamily: FAMILY,
      fontSize: 10,
      color: NAVY,
      backgroundColor: '#FFFFFF',
    },
    cover: { marginBottom: 18, paddingBottom: 14, borderBottomWidth: 2, borderBottomColor: CYAN },
    mark: { width: 34, height: 34, marginBottom: 12 },
    title: { ...bold, fontSize: 24, lineHeight: 1.2, marginBottom: 6 },
    subtitle: { fontSize: 11, lineHeight: 1.4, color: TEAL, marginBottom: 6 },
    version: { fontSize: 8.5, color: MUTED },
    h2: { ...bold, fontSize: 14, marginTop: 16, marginBottom: 7, lineHeight: 1.25 },
    p: { fontSize: 10, lineHeight: 1.5, marginBottom: 7 },
    bold,
    code: { fontFamily: 'Courier', fontSize: 9, color: TEAL },
    row: { flexDirection: 'row', marginBottom: 4 },
    bullet: { width: 12, color: TEAL, ...bold },
    stepNo: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: NAVY,
      color: CREAM,
      textAlign: 'center',
      fontSize: 8.5,
      lineHeight: 1.9,
      marginRight: 8,
      ...bold,
    },
    itemText: { flex: 1, fontSize: 10, lineHeight: 1.5 },
    table: { borderWidth: 0.75, borderColor: RULE, marginBottom: 9 },
    th: { flexDirection: 'row', backgroundColor: NAVY },
    thText: { ...bold, fontSize: 8.5, color: CREAM, padding: 5 },
    tr: { flexDirection: 'row', borderTopWidth: 0.75, borderTopColor: RULE },
    trAlt: { backgroundColor: CREAM },
    td: { fontSize: 9, lineHeight: 1.4, padding: 5 },
    note: { borderLeftWidth: 3, padding: 8, marginBottom: 9, backgroundColor: CREAM },
    noteText: { fontSize: 9.5, lineHeight: 1.45 },
    footer: {
      position: 'absolute',
      bottom: 26,
      left: 50,
      right: 50,
      flexDirection: 'row',
      justifyContent: 'space-between',
      fontSize: 8,
      color: MUTED,
    },
  });
}

/** `**bold**`, `*italic*` (rendered plain) and `code` runs inside a string. */
function inline(text, base) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**')) return h(Text, { key: i, style: s.bold }, part.slice(2, -2));
    if (part.startsWith('`')) return h(Text, { key: i, style: s.code }, part.slice(1, -1));
    if (part.startsWith('*')) return h(Text, { key: i }, part.slice(1, -1));
    return h(Text, { key: i, style: base }, part);
  });
}

function Table({ head, rows, widths }) {
  const total = widths.reduce((a, b) => a + b, 0);
  const w = (i) => ({ width: `${(widths[i] / total) * 100}%` });
  return h(
    View,
    { style: s.table },
    h(
      View,
      { style: s.th, wrap: false },
      ...head.map((c, i) => h(Text, { key: i, style: [s.thText, w(i)] }, c)),
    ),
    ...rows.map((r, ri) =>
      h(
        View,
        { key: ri, style: ri % 2 ? [s.tr, s.trAlt] : s.tr, wrap: false },
        ...r.map((c, ci) => h(Text, { key: ci, style: [s.td, w(ci)] }, inline(c))),
      ),
    ),
  );
}

function Block(b, key) {
  switch (b.kind) {
    case 'p':
      return h(Text, { key, style: s.p }, inline(b.text));
    case 'bullets':
      return h(
        View,
        { key },
        ...b.items.map((t, i) =>
          h(
            View,
            { key: i, style: s.row, wrap: false },
            h(Text, { style: s.bullet }, '•'),
            h(Text, { style: s.itemText }, inline(t)),
          ),
        ),
      );
    case 'steps':
      return h(
        View,
        { key },
        ...b.items.map((t, i) =>
          h(
            View,
            { key: i, style: [s.row, { marginBottom: 6 }], wrap: false },
            h(Text, { style: s.stepNo }, String(i + 1)),
            h(Text, { style: s.itemText }, inline(t)),
          ),
        ),
      );
    case 'note':
      return h(
        View,
        {
          key,
          style: [s.note, { borderLeftColor: b.tone === 'warn' ? CORAL : TEAL }],
          wrap: false,
        },
        h(Text, { style: s.noteText }, inline(b.text)),
      );
    case 'table':
      return h(Table, { key, ...b });
    default:
      throw new Error(`unknown block ${b.kind}`);
  }
}

function Doc(doc) {
  const mark = fs.existsSync(MARK) ? fs.readFileSync(MARK) : null;
  return h(
    Document,
    { title: doc.title, author: 'The Hospitality Company', subject: doc.subtitle },
    h(
      Page,
      { size: 'A4', style: s.page },
      h(
        View,
        { style: s.cover },
        mark ? h(Image, { src: mark, style: s.mark }) : null,
        h(Text, { style: s.title }, doc.title),
        h(Text, { style: s.subtitle }, doc.subtitle),
        h(Text, { style: s.version }, doc.version),
      ),
      ...doc.sections.map((sec, i) =>
        h(
          View,
          { key: i },
          // The heading travels with the first block, never alone at a page foot.
          h(View, { wrap: false }, h(Text, { style: s.h2 }, sec.heading), Block(sec.blocks[0], 0)),
          ...sec.blocks.slice(1).map((b, bi) => Block(b, bi + 1)),
        ),
      ),
      h(
        View,
        { style: s.footer, fixed: true },
        h(Text, null, 'The Hospitality Company · Back Office guide'),
        h(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · RUN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  FAMILY = await registerFonts();
  buildStyles();

  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  const pdf = await renderToBuffer(Doc(DOC));
  fs.writeFileSync(OUT_PDF, pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  process.stdout.write(
    `wrote ${path.relative(ROOT, OUT_PDF)} (${(pdf.length / 1024).toFixed(0)} KB, ${pages} pages, ${FAMILY})\n`,
  );

  const md = toMarkdown(DOC);
  fs.writeFileSync(OUT_MD, md.endsWith('\n') ? md : `${md}\n`);
  process.stdout.write(`wrote ${path.relative(ROOT, OUT_MD)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
