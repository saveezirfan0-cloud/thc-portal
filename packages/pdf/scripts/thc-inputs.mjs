#!/usr/bin/env node
/**
 * "Inputs required from The Hospitality Company" — the hand-over checklist
 * sent to THC listing everything the build still needs from them.
 *
 *   node packages/pdf/scripts/thc-inputs.mjs          (from the repository root)
 *
 * writes  docs/pdfs/THC-Inputs-Required.pdf   (the deliverable)
 *    and  docs/17-inputs-from-thc.md           (the Markdown twin)
 *
 * from the ONE content structure at the top of this file (`DOC`), so the
 * two never drift. No JSX and no build step: React.createElement against
 * @react-pdf/renderer, which this package already depends on. The script
 * lives inside packages/pdf so the plain import resolves.
 *
 * Fonts. The product face is Plus Jakarta Sans. The copy in
 * packages/ui/fonts is a variable WOFF2, which react-pdf embeds without
 * usable outlines (it subsets TTF/WOFF only), so this script fetches the
 * static 400/600/700 WOFF files from Google Fonts once into a cache
 * directory (THC_PDF_FONT_DIR, or <tmp>/thc-pdf-fonts) and registers them.
 * If that is not possible (offline), it falls back to Helvetica and says so
 * on stderr — the document is still produced.
 *
 * Sources this content was written from: Scope of Work v1.6 Appendix B and
 * "Key decisions (summary)"; OWNER-TODO.md §4–§5; docs/14-handover.md §2
 * and §5; docs/15-open-questions.md Q1–Q6; ADR-0001, 0007, 0017, 0019,
 * 0021; docs/12-keys-and-assets.md; packages/notifications (E2b, CL1–CL6);
 * the quiz, contract, induction and privacy placeholders in the code; and
 * the documents THC sent on 26.09.2026 (Agency Worker Contract, H&S quiz
 * and induction deck, data protection policy), which set the "Received"
 * statuses. Version 1.1 folds back the edits PRs #67, #71 and #72 made to
 * docs/17 directly, so the Markdown twin is generated again.
 */

import { createElement as h, Fragment } from 'react';
import {
  Document,
  Font,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT_PDF = process.env.THC_PDF_OUT || path.join(ROOT, 'docs/pdfs/THC-Inputs-Required.pdf');
const OUT_MD = path.join(ROOT, 'docs/17-inputs-from-thc.md');
// A partial render (THC_PDF_PAGES / THC_PDF_ITEMS) is for looking at a
// layout; it must not overwrite the deliverable or its Markdown twin.
const PARTIAL = Boolean(process.env.THC_PDF_PAGES || process.env.THC_PDF_ITEMS);
if (PARTIAL && !process.env.THC_PDF_OUT) {
  console.error(
    'thc-inputs: a partial render needs THC_PDF_OUT=<path> so it does not overwrite the deliverable.',
  );
  process.exit(2);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CONTENT — the single source for both outputs
//
// Block grammar used in `sections[].blocks`:
//   'text'                       a paragraph (**bold** runs allowed)
//   { ul: ['a', 'b'] }           bullets
//   { quote: 'text' | [lines], label?: 'Subject: …' }
//   { table: { head: [...], rows: [[...]], widths?: [fractions] } }
//   { h: 'sub-heading' }
//   { note: 'small muted text' }
// ═══════════════════════════════════════════════════════════════════════════

const PRODUCT = 'The Hospitality Company staffing platform';

const E2_TEXT =
  'Thank you for taking the time to complete your interview with The Hospitality Company. On this occasion we will not be taking your application further. We wish you the very best.';
const E2B_TEXT =
  'Thank you for the time you have given to your application with The Hospitality Company. On this occasion we will not be taking your application further. We wish you the very best.';

// The duty-to-disclose clause as worded in the build team's draft
// (placeholder-2026-09), quoted in item 2 as the clause §2.11 insists on.
const CONTRACT_DISCLOSE_CLAUSE =
  '5. Ongoing duty to disclose convictions. You confirm that the criminal-conviction declaration you made during onboarding is accurate, and you undertake to declare any unspent criminal conviction that arises during your engagement, as soon as reasonably practicable, using the "Declare a criminal conviction" route in the app. The Company may pause your assignments while such a declaration is reviewed.';

/**
 * The five standard sections every input item carries. `untilHeading`
 * replaces the last heading once THC has sent the item and what is left is
 * what THC must still confirm.
 */
function std({
  need,
  why,
  format,
  send,
  until,
  untilHeading = 'What the platform does until it arrives',
  extra = [],
}) {
  return [
    { heading: 'What we need, exactly', blocks: need },
    ...extra,
    { heading: 'Why the platform needs it', blocks: why },
    { heading: 'Format and example', blocks: format },
    { heading: 'How to send it', blocks: send },
    { heading: untilHeading, blocks: until },
  ];
}

/** A product question from docs/15-open-questions.md, as its own item. */
function question({ ask, today, alternative, where }) {
  return [
    { heading: 'The question', blocks: [{ quote: ask, label: 'Ask' }] },
    { heading: 'What the platform does today', blocks: [today] },
    { heading: 'The alternative', blocks: [alternative] },
    { heading: 'Where it comes from', blocks: [{ note: where }] },
  ];
}

const KEYS_NOT_BY_EMAIL =
  'Keys and secrets never by email or messaging app: an email is copied to several servers and mailboxes on its way, is kept in Sent folders and backups, and a key that sits in an inbox is a key that can be found later. Use a password-manager share (1Password, Bitwarden or similar), or read it out on a call and we type it straight into the secure configuration.';

const ITEMS = [
  // ── B1 ───────────────────────────────────────────────────────────────────
  {
    id: 'B1',
    title: 'Willo: API key, interview key and stage mapping',
    short: 'Willo API key, interview key, stage mapping (B1)',
    why: 'The application form creates the candidate in Willo and Willo moves the kanban card (§2.4)',
    format: 'Three secret values + the stage list; secrets by password manager or on a call',
    who: 'Whoever administers THC’s Willo account, with Willo support',
    neededBy: 'UAT − 2 weeks',
    sections: std({
      need: [
        {
          ul: [
            '**Willo API key** — the secret key from THC’s Willo account (Settings, Integrations or API). It lets the platform create each applicant in Willo the moment they submit the application form.',
            '**Interview key** — the identifier of the Willo interview every applicant is invited to (the one interview THC uses for recruitment).',
            '**Webhook signing secret** — the secret Willo shows when a webhook is created in THC’s account, so the platform can tell a genuine Willo message from a forged one. If Willo asks you to type one rather than issuing it, tell us and we will supply one.',
            '**Stage mapping** — the names of the stages in THC’s Willo pipeline, spelt exactly as Willo shows them, and which of the platform’s stages each one means: Interview requested, Interview completed, Accepted (moves to Documents) or Rejected. The default in place today is: “New Response” = Interview completed · “Accepted” = Documents · “Rejected” = Rejected.',
            '**The review link format** — the web address that opens one candidate’s interview in Willo, for the “Review interview on Willo” button on the candidate profile.',
            '**Answers from Willo** to the six questions below — or a link to Willo’s API and webhook documentation and a named contact at Willo, and we will find the answers ourselves.',
          ],
        },
        'In return we give you the **webhook address** to paste into Willo. It has the form https://<project-id>.supabase.co/functions/v1/willo-webhook — one for staging now, one for production once item 8 is decided.',
      ],
      extra: [
        {
          heading: 'Six questions for Willo',
          blocks: [
            'The connection was built without access to THC’s Willo account, on sensible assumptions. Every assumption is a setting, not code, so the answers change configuration rather than needing a release — but we do need the answers.',
            {
              ul: [
                'How are webhook deliveries signed? Which header carries the signature (we assume x-willo-signature), which algorithm (we assume HMAC-SHA256 over the raw message body), hex or base64 — and is there a timestamp header for replay protection?',
                'What does a delivery look like? Where in the message are the event type, the candidate’s key, the stage name and the time? (We read the usual places: event or type; data.candidate.key; data.stage.name; created_at.)',
                'How is a candidate created by API? The address (we assume POST …/interviews/{interviewKey}/candidates/), the authentication (we assume Authorization: Bearer <API key>), the fields (first name, last name, email, phone, an external reference, “send invite”) and where the new candidate’s key comes back in the reply.',
                'If the same person is created twice, does Willo de-duplicate by email address?',
                'Is there a sandbox or test interview where we can send test deliveries before going live?',
                'Does THC’s Willo plan include API and webhook access? Some plans do not.',
              ],
            },
          ],
        },
      ],
      why: [
        'The candidate submits the form; the platform creates them in Willo and Willo sends the interview invitation. The moment the interview is finished, Willo tells the platform and the card moves to “Interview completed” by itself; the decision the manager makes inside Willo moves it again — no manual updating and no repeating the decision in the system (§2.4). The keys are held as secure configuration, never in the code, and the stage mapping is editable on the Settings page so a change to your Willo pipeline needs no release (§2.4, Appendix B1).',
      ],
      format: [
        'The API key, interview key and signing secret are long strings of letters and numbers copied from Willo’s settings pages. The stage mapping is a short list, for example: “New Response = Interview completed; Shortlisted = Interview completed; Accepted = Documents; Rejected = Rejected”.',
      ],
      send: [
        KEYS_NOT_BY_EMAIL,
        'The stage list, the review-link format and Willo’s answers are not secret and can come by email.',
      ],
      until: [
        'The application form works and every applicant is saved under “Interview requested”. No Willo invitation goes out and no card moves on its own; the office can move a candidate on by hand from the candidate profile. Once the keys are in, every applicant still waiting is created in Willo automatically on the first run — nothing is re-typed. Until the signing secret exists every webhook delivery is refused, so nothing forged can get in meanwhile.',
      ],
    }),
  },

  // ── B2 ───────────────────────────────────────────────────────────────────
  {
    id: 'B2',
    title: 'The zero-hours contract text',
    short: 'Zero-hours contract text (B2)',
    why: 'Stored as versioned text; the version each worker signed is recorded against them (§2.11)',
    format: 'Word or PDF, final, with a version label and date',
    who: 'HR lead or director, with THC’s employment solicitor',
    neededBy: 'UAT − 2 weeks',
    status: 'Received 26.09 — clause 28, quarter-hour pay and clause 8 to confirm',
    sections: std({
      need: [
        {
          ul: [
            'The full text of the zero-hours agreement a worker signs in the app — final, approved by THC and, if you use one, your employment solicitor — with a version label and date (for example “v1 — October 2026”).',
            'It must contain the **ongoing duty to disclose**: the worker undertakes to declare any unspent criminal conviction that arises during their employment, as soon as reasonably practicable, through the declaration route in the app (§2.11). The platform will not publish a version that does not contain the words “unspent criminal conviction”. That clause is what lets the app’s own “Declare a criminal conviction” screen point back to something the worker has already agreed to (§10.7).',
            'Written to read on a phone: headings and numbered clauses, no tables, no images, nothing to fill in by hand. Ticking “I agree” is the signature and its timestamp is the record (§2.11) — there is no name box or signature line.',
          ],
        },
      ],
      why: [
        'The agreement is stored as versioned text. Each worker’s record says which version they signed and when, and a published version can never be edited — a change is a new version, and the workers who signed the old one still point at the old one. That is what makes the electronic signature evidence of anything (§2.11). Every worker signs it at step 10 of the 11-step onboarding, and signing is the moment they become compliant and receive their Employee ID (§2.7).',
      ],
      format: [
        'Word or PDF. If the contract exists in Accelerate or on paper today, send that and mark any changes. The clause the platform insists on, as worded in today’s placeholder:',
        { quote: CONTRACT_DISCLOSE_CLAUSE },
      ],
      send: ['Email or shared drive — the text is not personal data.'],
      untilHeading: 'Received 26.09.2026 — what THC must still confirm',
      until: [
        'THC’s own **“Agency Worker Contract For Services”** (20 pages) is live as the contract at step 10, as version **thc-agency-worker-2026-09**, titled “Agency Worker Contract for Services — The Hospitality Company (London) Limited”. The text is THC’s, taken from the PDF without rewording: the cover page, the contents page, the page footers and the signature block are left out (in the app, ticking “I agree” is the signature), each clause heading is followed by a full stop so the app can print it in bold, and line breaks and two words split by the PDF (“f uture”, “self -certification”) are repaired. The draft placeholder-2026-09 stays in the database unchanged, because anyone who signed it during testing signed that text.',
        'The version is still marked as a placeholder, and the contract step tells the worker “Clause 28, the duty to disclose convictions, is awaiting THC’s approval”, until THC confirms:',
        {
          ul: [
            '**Clause 28 — the duty to disclose criminal convictions.** THC’s document has no such clause, and §2.11 requires one (the platform refuses a version without the words “unspent criminal conviction”). The build team added it after clause 27, in the contract’s own defined terms. Approve it, or send your solicitor’s wording:',
          ],
        },
        {
          quote:
            '28. DUTY TO DISCLOSE CRIMINAL CONVICTIONS. The Temporary Worker confirms that the criminal-conviction declaration made during onboarding is accurate, and undertakes to declare any unspent criminal conviction that arises during this Agreement, as soon as reasonably practicable, using the "Declare a criminal conviction" route in the Staff App. The Employment Business may pause Assignments while such a declaration is reviewed.',
        },
        {
          ul: [
            '**Pay to the nearest quarter hour, or to the minute?** The definitions of “Rate of Pay” and “Qualifying Period Rate of Pay” (clause 1, applied by clause 6) pay “for each hour worked during an Assignment (to the nearest quarter hour)”. The platform pays to the minute: payable time is check-in to check-out within the scheduled shift, with the 15-minute check-out grace, unpaid breaks deducted and the 4-hour minimum (RULE-01/02). Say which is right — the contract or the platform.',
            '**Time sheets (clause 8).** Clauses 6 and 8 make pay subject to a time sheet “signed by an authorised representative of the Client”. The platform’s record is digital: the worker’s check-in and check-out in the app, and the sign-out timesheet the platform generates and sends to the client after each event (§11.3). The clause should refer to those, so that the contract describes how hours are actually recorded.',
            '**Slips in the document**, left exactly as written because they are THC’s text — correct them in the next version if they are wrong: the Working Time Regulations are cited as “(SI 1988/1833)” (should be SI 1998/1833); clause 5.3 still has “[24] hours” and clause 18.1 “[admin@thehospitalitycompany.co.uk]” in square brackets; clause 24.1.2 reads “admin@thehospitalitycompany.co.uk s(in the case of …”; clause 9.3 says the holiday year “runs from 31 March to 1 April”; clause 2.2 says “Temporary Agency Worker”; clause 16.1 points to a “Privacy notice which is on the intranet” (workers have no intranet — the app’s /privacy page, item 13); the opening line “THIS AGREEMENT is dated this ______ day of ______ 2026” has nothing to fill it in the app (the signature timestamp is the date).',
          ],
        },
        'When THC approves, the approved text goes in as a new version; nothing already signed is rewritten.',
      ],
    }),
  },

  // ── B3 ───────────────────────────────────────────────────────────────────
  {
    id: 'B3',
    title: 'Sample University Term Dates Letters and Official University Completion Letters',
    short: 'Sample term dates and completion letters, 3–5 each (B3)',
    why: 'The document reader is tuned and tested against real layouts, not idealised ones (§2.6, §4.5)',
    format: 'PDF or JPG, 3–5 of each, personal data blacked out',
    who: 'Onboarding / compliance manager',
    neededBy: 'UAT − 3 weeks',
    sections: std({
      need: [
        {
          ul: [
            '3–5 **University Term Dates Letters** and 3–5 **Official University Completion Letters**, as students actually send them: a PDF from the university portal, a photo taken on a phone, an email printed to PDF. From different universities where possible.',
            'Personal data blacked out — the student’s name, student number, address and date of birth. Keep the university’s name and logo, every date and the layout untouched: those are what the reader learns from.',
            'If you have them, one or two examples of the wrong document a student sends instead (an offer letter, an enrolment certificate), so the reader learns to say “this is not a term dates letter”.',
            'For each letter, a line on what a manager would take from it: the term and holiday ranges, or the course completion date and the awarding institution.',
          ],
        },
      ],
      why: [
        'The platform reads every uploaded document to lift the expiry date onto the worker’s profile; from the term dates letter it lifts the term and holiday ranges, and from the completion letter the completion date and the institution (§2.6, §4.5). Those dates drive the weekly hours limit for student-visa workers — 20 hours in term, 48 in the holidays, 48 permanently once a completion letter is verified — which is calculated from the verified letter and never typed by anyone (§4.4, §4.5). A manager always checks the document; the reader only pre-fills. Built against real layouts it pre-fills correctly more often (Appendix B3).',
      ],
      format: [
        'PDF or JPG, one file per letter, named so they sort: term-letter-01-UCL.pdf, completion-letter-01-KCL.pdf. Redact with a solid black box, not a highlighter — a scan reads straight through a highlighter.',
      ],
      send: [
        'Email or a shared drive folder — once redacted they hold no personal data. If redacting is awkward, put the originals in a shared folder restricted to the build team and we will redact and return them. Do not email unredacted letters.',
      ],
      until: [
        'The reader is tested against made-up letters written by the build team. On a real one it may be less sure of itself, and a low-confidence reading is flagged “needs manual review” rather than written to the profile (§2.6) — the manager then types the dates. Nothing is verified without a manager, so the cost of waiting is extra manual work, never a wrong limit.',
      ],
    }),
  },

  // ── B4 ───────────────────────────────────────────────────────────────────
  {
    id: 'B4',
    title: 'Hi-res logo (SVG and PNG)',
    short: 'Hi-res logo (B4)',
    why: 'One name and one logo across all three applications (§1.6)',
    format: 'Received — nothing further unless the logo changes',
    who: 'Marketing / brand owner',
    neededBy: 'Received',
    done: true,
    sections: std({
      need: [
        '**Nothing further.** THC’s stacked logo (THC-Stacked-logo.svg) was received and is the source of record. From it the build team cut the mark (the two glasses and the cork) and the stacked lockup, and generated every size the applications need: the Staff App’s home-screen icons in all three sizes, its iOS icon, and a browser-tab icon for all three applications. The mark appears on every sign-in card, in the Back Office sidebar, in the Client Portal header and on the printed timesheet.',
        {
          ul: [
            'Optional: if a **mark-only original** exists — the glasses and cork drawn on their own rather than as part of the stacked logo — send it and we regenerate from that. The mark in use was cut out of the stacked file, which is sound, but a future change to the lockup would have to be traced through again.',
            'If the logo ever changes, send the new master file and every size is regenerated from it. Please do not send resized copies: several of the files have exact names and padding the code expects.',
          ],
        },
      ],
      why: [
        'The brand is fixed at one name and one logo across the whole system; colours and fonts are already specified (§1.6).',
      ],
      format: [
        'SVG preferred. Otherwise PNG at 1024 by 1024 pixels or larger on a transparent background.',
      ],
      send: ['Email or shared drive.'],
      until: ['Not applicable — done.'],
    }),
  },

  // ── B5 ───────────────────────────────────────────────────────────────────
  {
    id: 'B5',
    title: 'Old-system export: workers and clients',
    short: 'Old-system (Accelerate) export, workers and clients (B5)',
    why: 'Migration is a one-off import, run on staging first and then production (Appendix B5, §4.3)',
    format: 'CSV (UTF-8, header row), one file per table, columns as proposed',
    who: 'Whoever administers Accelerate, with the office manager',
    neededBy: 'Go-live − 4 weeks',
    sections: std({
      need: [
        'Two spreadsheets exported from Accelerate — **workers** and **clients** — one row per record, saved as CSV. Three optional extras make the migration complete: client rate cards, venues, and each worker’s documents with their expiry dates. The columns below are a proposal from the platform’s data model (§1.5). If Accelerate cannot produce a column, leave it out and say so — please do not invent values.',
        { h: 'Workers — one row per worker' },
        {
          table: {
            widths: [0.24, 0.12, 0.64],
            head: ['Column', 'Required', 'Notes'],
            rows: [
              [
                'old_id',
                'Yes',
                'Accelerate’s own reference. Kept as a cross-reference and used to name photo and document files.',
              ],
              ['first_name, last_name', 'Yes', ''],
              ['email', 'Yes', 'One per worker and unique: it becomes their login.'],
              ['phone', 'Yes', 'International format, e.g. +44 7700 900123.'],
              ['date_of_birth', 'Yes', 'YYYY-MM-DD. Under-18s cannot be migrated (§1.7).'],
              [
                'address_line_1, address_line_2, town, postcode',
                'Yes',
                'Turned into a map position for the proximity part of auto-assign.',
              ],
              [
                'roles',
                'Yes',
                'Separated by semicolons, spelt as in your role list, e.g. Waiting Staff; Bar Staff.',
              ],
              [
                'status',
                'Yes',
                'active / inactive / left. Decides who is migrated as a live worker.',
              ],
              ['start_date', 'No', 'First shift or onboarding date, YYYY-MM-DD.'],
              [
                'rtw_branch',
                'Yes',
                'One of the five right-to-work branches (§2.5): UK/Irish citizen · EU settled or pre-settled · Work visa · International student · Dependant/other visa.',
              ],
              [
                'rtw_expiry',
                'Visa branches',
                'YYYY-MM-DD. In date = arrives compliant; expired = arrives blocked and is asked to re-upload (§4.3).',
              ],
              ['share_code', 'No', 'If held: 9 characters starting with W.'],
              ['ni_number', 'No', ''],
              [
                'term_dates',
                'Students',
                'The holiday ranges from the verified term dates letter, e.g. 2026-12-12..2027-01-10; 2027-03-27..2027-04-25.',
              ],
              [
                'completion_date',
                'Students',
                'If a completion letter has been verified: the course completion date.',
              ],
              ['wtr_optout_signed', 'No', 'Yes/No and the date the 48-hour opt-out was signed.'],
              [
                'client_qualifications',
                'No',
                'Client: role pairs, e.g. Client A: Waiting Staff; Client A: Bar Staff (§9.6).',
              ],
              ['do_not_return', 'No', 'Clients this worker must not be sent to.'],
              ['rating, show_rate', 'No', 'If Accelerate holds them; otherwise they start fresh.'],
              ['photo_filename', 'No', 'With a folder of photos named by old_id.'],
              ['notes', 'No', 'Internal notes on the worker.'],
            ],
          },
        },
        {
          note: 'Not by spreadsheet: bank details and HMRC New Starter answers. Each worker confirms them once in the app, where they are stored encrypted. If you want them carried over, say so and we agree a separate encrypted transfer — never by email.',
        },
        { h: 'Clients — one row per client' },
        {
          table: {
            widths: [0.3, 0.12, 0.58],
            head: ['Column', 'Required', 'Notes'],
            rows: [
              ['old_id', 'Yes', 'Accelerate’s reference.'],
              ['name', 'Yes', 'As it should appear on timesheets and in the Client Portal.'],
              [
                'contact_name, contact_email, contact_phone',
                'Yes',
                'The main contact; the email becomes their Client Portal login.',
              ],
              [
                'default_onsite_contact_name, default_onsite_contact_phone',
                'No',
                'Pre-fills the on-site contact on every event for that client.',
              ],
              ['breaks_paid', 'No', 'Yes/No — whether this client pays for breaks (RULE-14).'],
              ['buffer_policy', 'No', 'strict / flexible (§3.2).'],
              ['notes', 'No', ''],
            ],
          },
        },
        { h: 'Optional extra tables' },
        {
          ul: [
            '**client_rate_cards** — client_old_id · role · charge_rate (£ per hour) · dress_code (§1.5).',
            '**venues** — name · address · postcode · venue_type · geofence_radius_m (§9.11). The platform places them on the map from the address.',
            '**worker_documents** — worker_old_id · doc_type (passport / visa / term_letter / completion_letter / share_code_report / ni_evidence) · expiry_date · filename, with the files in a folder.',
          ],
        },
      ],
      why: [
        'Migration is a one-off import, run against staging first and then production (Appendix B5). Migrated workers arrive as compliant where their documents are in date and blocked where they are not, and the blocked ones are notified to re-upload (§4.3) — so the expiry dates are the columns that matter most, and a worker with no documents at all arrives blocked rather than trusted.',
      ],
      format: [
        'CSV, UTF-8, one header row, dates as YYYY-MM-DD, one file per table. Excel is fine if CSV is awkward — we convert. A sample of five rows first lets us check the columns before you export everything.',
      ],
      send: [
        'This is the personal data of around a thousand people. Not by email. A shared drive folder restricted to the build team (Google Drive, OneDrive or SharePoint), or an encrypted archive with the password given separately by phone.',
      ],
      until: [
        'Staging holds sample data only. The import script is written against the columns above and adjusted to what Accelerate actually produces once the sample rows arrive.',
      ],
    }),
  },

  // ── B6 ───────────────────────────────────────────────────────────────────
  {
    id: 'B6',
    title: 'Sign-off on the migration dry run',
    short: 'Migration dry-run sign-off (B6)',
    why: 'THC checks a sample of migrated workers and clients on staging before the real import (Appendix B6)',
    format: 'Email: “signed off”, with corrections listed',
    who: 'Office manager, countersigned by a director',
    neededBy: 'Go-live − 2 weeks',
    sections: std({
      need: [
        'After the build team runs the import on staging, THC checks a sample and confirms in writing — an email is fine — that the migrated data is right, listing any corrections. A suggested sample: 20 workers across the statuses (compliant, blocked, inactive, students, visa holders) and 5 clients with their rate cards. For each, check:',
        {
          ul: [
            'Name, email, phone and address.',
            'Roles, and the client qualifications and do-not-return flags.',
            'Status — compliant or blocked — and the reason the profile gives for a block.',
            'Each document’s expiry date.',
            'For students: the term dates and the weekly limit the profile shows.',
            'Client contacts, rate cards, dress codes, and the venues on the map.',
          ],
        },
      ],
      why: [
        'The import is run against staging and THC checks a sample before it is run for real (Appendix B6). Once it runs on production, blocked workers are notified to re-upload (§4.3) and the platform is live for every migrated worker — so this is the last point at which a wrong column is cheap to fix.',
      ],
      format: [
        'An email: “Signed off”, plus a list of corrections as worker reference · field · expected value.',
      ],
      send: ['Email. The corrections should quote references, not personal data.'],
      until: ['Go-live cannot be scheduled. The production import runs only after the sign-off.'],
    }),
  },

  // ── B7 ───────────────────────────────────────────────────────────────────
  {
    id: 'B7',
    title: 'DNS records for admin@ and timesheets@',
    short: 'DNS records for the two sender addresses (B7)',
    why: 'Without them the platform’s email is filed as spam or rejected (§9.12)',
    format: 'Records added at THC’s DNS host; reply when done',
    who: 'Whoever manages the thehospitalitycompany.co.uk domain — IT provider, web agency or the registrar login',
    neededBy: 'UAT − 2 weeks',
    sections: std({
      need: [
        'Someone with access to where **thehospitalitycompany.co.uk** is managed (the domain registrar, your IT provider or your web agency) to add the records that Resend — the email service the platform sends through — issues for the domain. In plain terms, SPF, DKIM and DMARC are the three records that tell Gmail and Outlook the platform is allowed to send email on THC’s behalf. The records are:',
        {
          table: {
            widths: [0.26, 0.36, 0.38],
            head: ['Record', 'Where', 'What it does'],
            rows: [
              [
                'DKIM — a TXT record (sometimes two)',
                'resend._domainkey.thehospitalitycompany.co.uk',
                'Signs every email so the receiving server can prove it came from THC and was not altered.',
              ],
              [
                'SPF — an MX record and a TXT record',
                'send.thehospitalitycompany.co.uk — a sending subdomain, so your existing email is untouched',
                'Says Resend is allowed to send for that subdomain and handles bounces.',
              ],
              [
                'DMARC — a TXT record',
                '_dmarc.thehospitalitycompany.co.uk',
                'Tells receivers what to do with mail that fails the checks. Starts in monitor-only mode (p=none).',
              ],
            ],
          },
        },
        {
          ul: [
            'The exact names and values come from Resend and we send them to you — they are not secret. If THC already has a DMARC record, tell us before anything is added.',
            'Confirmation that **admin@thehospitalitycompany.co.uk** and **timesheets@thehospitalitycompany.co.uk** exist as real, monitored mailboxes. Replies to the platform’s emails go there; no-reply addresses are not used (§9.12).',
          ],
        },
      ],
      why: [
        'All outgoing mail is sent from two addresses and no others: timesheets@ for allocation sheets and timesheets, admin@ for everything else — activation, password resets, invitations, finance reports (§9.12). Without these records a receiving mail server cannot tell the platform’s email from a forgery, and files it as spam or rejects it outright (Appendix B7). The records live with whoever manages your domain, and changes take up to 48 hours to spread — which is why this is the first item on the lead-time list.',
      ],
      format: [
        'We email you the records; you add them at the DNS host and reply “done”; we press Verify in Resend and the two senders come alive. Alternatively, give your DNS person a login to Resend and they read the records there directly.',
      ],
      send: ['Email — none of this is secret.'],
      until: [
        'Every email the platform wants to send waits in its queue marked “not configured” — activation links, reminders, timesheets, finance reports. Nothing is lost; it all sends once the domain shows Verified. Push notifications to the app do not depend on this.',
      ],
    }),
  },

  // ── B8 ───────────────────────────────────────────────────────────────────
  {
    id: 'B8',
    title: 'Production hosting: the accounts THC owns',
    short: 'Production hosting decision and accounts (B8)',
    why: 'Production runs in THC’s own account and the code is transferred in full (§1.1)',
    format:
      'Email: the owning email address for each account and the administrator; then accept invitations',
    who: 'Director / finance — the account owner and card holder',
    neededBy: 'Before UAT',
    sections: std({
      need: [
        {
          ul: [
            'A decision on where production lives, and the accounts to put it in. The Scope said DigitalOcean or AWS at THC’s discretion (§1.1); under the agreed change (item 22) the platform runs on **Supabase** (the database, file storage and background jobs) and **Vercel** (the three web applications), so the decision is now: which Supabase organisation and which Vercel team THC owns.',
            'Our recommendation: THC creates both under a THC role address (admin@ rather than one person’s mailbox) with THC’s payment card, and invites the build team in as members. The production accounts are then THC’s from day one and nothing has to be transferred later.',
            'The Supabase project must be in the **London region (eu-west-2)**: the database holds UK payroll and right-to-work data.',
            'The same for the code: a **GitHub** organisation owned by THC, to receive the repository at hand-over (§1.1: “the code is transferred to THC in full”).',
            'Tell us the owning email address for each of the three, who at THC will be the administrator, and whether THC wants its own web addresses for the three applications (for example office., app. and clients. under thehospitalitycompany.co.uk) — that adds three more DNS records to item 7 and they should be in place before UAT if testers are to use the final addresses.',
          ],
        },
      ],
      why: [
        'Production runs in THC’s own account and the code is transferred in full (§1.1). The Staff App must be served over a secure connection on a real domain for it to be installable on a phone and to receive push notifications. Hosting on Supabase and Vercel is a monthly subscription rather than servers to look after; both have a paid tier suited to this size of business and we will confirm current prices on request.',
      ],
      format: [
        'An email with the three owning addresses and the administrator’s name. Access is then by invitation in each service — no passwords change hands.',
      ],
      send: ['Email.'],
      until: [
        'Everything runs on the build team’s staging accounts: a Supabase project in London and three Vercel projects. UAT can start on staging; go-live cannot happen without the production accounts.',
      ],
    }),
  },

  // ── Quiz ─────────────────────────────────────────────────────────────────
  {
    id: 'C1',
    title: 'Health & Safety quiz — the questions and answers',
    short: 'Health & Safety quiz: 10 questions with answers',
    why: 'Step 6 of onboarding; 80% pass mark, three attempts, automatic rejection on the third failure (§2.9)',
    format: 'Word or Excel: question, four options, the correct one',
    who: 'H&S trainer — the author of “Health and Safety Presentation Questions”',
    neededBy: 'UAT − 2 weeks',
    status: 'Received 26.09 — answer key, Q8 and deck coverage to confirm',
    sections: std({
      need: [
        'THC’s own **“Health and Safety Presentation Questions”**: ten questions, each with four answer options and exactly one correct answer, in the order they should appear. The number can differ from ten — the rules do not depend on it — but ten is what the design shows (“Question 4 of 10”).',
      ],
      why: [
        'The quiz is step 6 of the 11-step onboarding and opens only once every document is verified. Pass mark 80%, multiple choice, three attempts in total; failing the third rejects the candidate automatically and sends them email E4 (§2.9). The pass mark and the questions come from THC’s own document, which the build team does not hold. The answer key never leaves the server, so a candidate cannot pass by reading the page.',
      ],
      format: [
        'A table, one row per question:',
        {
          table: {
            widths: [0.06, 0.34, 0.5, 0.1],
            head: ['#', 'Question', 'Options A–D', 'Correct'],
            rows: [
              [
                '1',
                'You discover a small fire in the kitchen. What should you do first?',
                'A. Try to put it out with water · B. Raise the alarm and alert the people around you · C. Finish the service you’re on, then report it · D. Open the windows to let the smoke out',
                'B',
              ],
            ],
          },
        },
      ],
      send: ['Email or shared drive, together with the induction deck (item 10) so the two match.'],
      untilHeading: 'Received 26.09.2026 — what THC must still confirm',
      until: [
        'THC’s **“Health and Safety Presentation Questions”** is live as the step 6 quiz: THC’s ten questions in THC’s order and wording (one typo corrected: “Personnel Protective Equipment” → “Personal”), 80% to pass, three attempts. Q7’s COSHH symbol is shown above its options as a clean drawing of the same pictogram. The ten placeholder questions are switched off, not deleted. THC must still confirm:',
        {
          ul: [
            '**The answer key.** THC’s sheet marks no answers, so the build team inferred them. Where the induction deck covers a question, the key agrees with it (Q1 slide 4, Q2 slide 5, Q3 slide 8, Q6 slide 14, Q7 slide 9). Please confirm or correct each one:',
          ],
        },
        {
          table: {
            widths: [0.06, 0.62, 0.32],
            head: ['#', 'Question', 'Answer we mark correct'],
            rows: [
              [
                '1',
                'What fire extinguisher from these listed would be utilised on an electrical fire?',
                'C — Carbon Dioxide',
              ],
              [
                '2',
                'What percentage of Accidents within the workplace are caused by Natural Causes?',
                'B — 2%',
              ],
              [
                '3',
                'How long should you stay away from work after a bout of sickness or diarrhea?',
                'B — 48 Hours',
              ],
              [
                '4',
                'Anaphylaxis is a severe condition caused by?',
                'A — An Allergic Reaction to a certain food',
              ],
              ['5', 'What symptoms are associated with an Allergic Reaction?', 'D — All the above'],
              [
                '6',
                'When must you use Personal Protective Equipment (PPE)?',
                'A — When using Chemicals',
              ],
              ['7', 'COSHH – what does this symbol mean? (skull and crossbones)', 'C — Toxic'],
              ['8', 'Which of these foods can cause an allergic reaction?', 'D — All the above'],
              [
                '9',
                'What are the recommended weight limits for women when carrying a load at Elbow height?',
                'C — 16 Kgs (the closest option — see below)',
              ],
              [
                '10',
                'What are the recommended weight limits for men when carrying a load at Elbow height?',
                'A — 25 Kgs (the closest option — see below)',
              ],
            ],
          },
        },
        {
          ul: [
            '**Q8’s rewording.** THC’s Q8 is free text (“Name three (3) foods, which can cause an allergic reaction?”, with three blank lines), which a multiple-choice quiz cannot mark. It now reads “Which of these foods can cause an allergic reaction?” A. Peanuts · B. Milk · C. Shellfish · D. All the above. It is the one question still marked as a placeholder: approve it, or send a multiple-choice replacement.',
            '**Questions the induction deck does not cover.** THC’s sheet says “All questions below have been covered in the presentation you have just seen”, but the deck has nothing on allergies (**Q4, Q5, Q8**) and gives no weight limits (**Q9, Q10** — its manual-handling slides say “know your limits” and mention 25 kg cartons, but not the limits at elbow height for women and men). Either add slides that cover them, or change those questions.',
            '**Q9 and Q10 have no correct option as worded.** 16 kg (women) and 25 kg (men) are the Health and Safety Executive’s guideline figures for a load held close to the body between **knuckle** and elbow height. At elbow height and above, up to the shoulder, HSE gives **13 kg** for women and **20 kg** for men, and neither figure is among THC’s options. The quiz marks 16 kg and 25 kg correct because they are the closest of the options offered, not because they answer the question as written. Please either reword Q9 and Q10 to “at knuckle height” (the options can then stay) or change the options to 13 kg and 20 kg.',
          ],
        },
      ],
    }),
  },

  // ── Induction ────────────────────────────────────────────────────────────
  {
    id: 'C2',
    title: 'Health & Safety induction slides',
    short: 'Induction slides',
    why: 'Step 5 of onboarding; the deck is shown as supplied, slide by slide (§10.3)',
    format: 'PDF (or PowerPoint), one page per slide',
    who: 'H&S trainer',
    neededBy: 'UAT − 2 weeks',
    status: 'Received 26.09',
    sections: std({
      need: [
        'The Health & Safety induction deck the worker reads before the quiz — final, as a PDF (or PowerPoint, which we convert). Each page becomes one slide in the app’s built-in viewer, shown exactly as supplied. Large type and one idea per page read best on a phone.',
      ],
      why: [
        'Step 5 of 11: reaching the last slide is what unlocks the quiz (§10.3). The deck is used as-is; re-drawing its content as app screens is out of scope for v1 (decided 17.07.2026, after the supplied deck was checked on a phone and confirmed legible). The quiz questions must be answerable from the deck, so please send both together.',
      ],
      format: ['PDF, landscape 16:9 or portrait, under 10 MB. Page 1 is slide 1.'],
      send: ['Email or shared drive.'],
      until: [
        '**Received 26.09.2026** ("General Health & Safety Awareness", 21 slides) and live in the Staff App as supplied. Slides 1, 2, 3, 11 and 20 still have empty photo boxes; a finished file replaces them page for page.',
      ],
    }),
  },

  // ── E2b ──────────────────────────────────────────────────────────────────
  {
    id: 'W1',
    title: 'Wording sign-off: E2b, the rejection email after the interview stage',
    short: 'Wording: E2b rejection email',
    why: 'E2 thanks the candidate for completing an interview, which is untrue for a rejection at a later stage (§2.7, §8)',
    format: '“Approved”, or the replacement text',
    who: 'Office manager / recruitment lead',
    neededBy: 'Before UAT',
    sections: std({
      need: [
        'Approve, or replace, the wording of one email the Scope’s register did not foresee. §8 has one rejection email, E2, in THC’s own words:',
        {
          quote: E2_TEXT,
          label:
            'E2 — subject “Your application to The Hospitality Company” — sent by the platform on an interview-stage rejection, whichever route',
        },
        'It says “complete your interview”. The onboarding board also lets the office reject a candidate **after** the interview — at Documents, Quiz or Additional info — and decline a returning applicant who has not been interviewed this time round (§2.3, §2.12). For them that first sentence is untrue, and it is the only thing the candidate is told. So the platform sends them E2b instead:',
        {
          quote: E2B_TEXT,
          label:
            'E2b — same subject — sent on a rejection after the interview stage, or when a returning applicant is declined',
        },
        'Like E2, E2b never carries the office’s reason. If you would rather one email for every stage, we set E2b’s text to E2’s and nothing else changes.',
      ],
      why: [
        'One truthful email per rejection route (§2.7, §8). E2 is unchanged and still goes for every interview-stage rejection.',
      ],
      format: ['A reply: “E2b approved”, or the replacement wording.'],
      send: ['Email.'],
      until: ['E2b goes out as quoted, once email sending is switched on (item 7).'],
    }),
  },

  // ── CL1–CL6 ──────────────────────────────────────────────────────────────
  {
    id: 'W2',
    title: 'Wording sign-off: CL1–CL6, the completion-letter and hours-limit messages',
    short: 'Wording: CL1–CL6, and which are mandatory',
    why: 'THC’s University Completion Letter requirement §5 adds six sends the §8 register does not name',
    format: '“Approved” or replacement text, plus the list of mandatory ones',
    who: 'Office manager / compliance manager',
    neededBy: 'Before UAT',
    sections: std({
      need: [
        'Approve, or replace, six messages that come from THC’s later University Completion Letter requirement rather than from the Scope’s §8 register, and tell us **which of them are mandatory**. Mandatory means a message that always goes and that the worker cannot switch off in their notification preferences — in §8 only the activation email E3 is mandatory. Words in {braces} are filled in by the platform.',
        {
          quote:
            'We’ve received your completion letter. Your weekly hours stay the same until the office has checked it.',
          label: 'CL1 — push to the worker, title “Completion letter received” — on upload',
        },
        {
          quote: [
            'Approved with a date: Your completion letter is approved — your weekly limit is {limit} hours from {date}.',
            'Approved, opt-out in force: Your completion letter is approved — from {date} you have no weekly hours limit.',
            'Approved, but the visa ends first: Your completion letter is approved, but your right to work ends on {date}, before the new limit would start — your weekly hours do not change.',
          ],
          label:
            'CL2 — push to the worker, title “Completion letter approved” — on approval, one of three forms',
        },
        {
          quote: [
            'Name: {name}',
            'Employee ID: {employeeId}',
            'Uploaded: {uploadedAt}',
            'Document: {form}',
            'Course completion date entered by the worker: {completionDate}',
            'Review it in Compliance, Needs review. The worker’s weekly hours do not change until it is approved.',
          ],
          label:
            'CL3 — email to admin@, subject “Completion letter awaiting review — {name}, Employee ID {employeeId}” — on upload',
        },
        {
          quote: [
            'Name: {name}',
            'Employee ID: {employeeId}',
            'Right to work: {route}',
            'Expires: {visaExpiry} ({days} days)',
            'No shift after that date can be rostered, and they are blocked on the day unless a new right-to-work check is recorded.',
          ],
          label:
            'CL4 — email to admin@, subject “Right to work expires in {days} days — {name}, Employee ID {employeeId}” — 60, 30 and 14 days before',
        },
        {
          quote: [
            'Name: {name}',
            'Employee ID: {employeeId}',
            'Signed: {signedAt} ({signedCopy})',
            'Notice period to cancel: {noticeDays} days',
            'This lifts the 48-hour weekly limit. It does not lift a Student visa term-time limit.',
          ],
          label:
            'CL5 — email to admin@, subject “48-hour opt-out signed — {name}, Employee ID {employeeId}” — on signature',
        },
        {
          quote: [
            'Name: {name}',
            'Employee ID: {employeeId}',
            'Notice given: {cancelledAt}',
            'The 48-hour weekly limit applies again from: {effectiveFrom}',
            'Weeks already booked above 48 hours from then: {overCapWeeks}',
          ],
          label:
            'CL6 — email to admin@, subject “48-hour opt-out cancelled — {name}, Employee ID {employeeId}” — on notice',
        },
      ],
      why: [
        'The requirement lists these sends (§5 of the University Completion Letter requirement); the platform holds their copy in one register so any of it can be changed in one place. A rejected completion letter is not here — it uses the standard “document rejected” push N8 with the reason and a Re-upload button, as §4.5 asks.',
      ],
      format: [
        'A reply per message: approved, or the replacement text; and the list of the ones that are mandatory.',
      ],
      send: ['Email.'],
      until: [
        'They send as quoted once email and push are switched on, and none is treated as mandatory.',
      ],
    }),
  },

  // ── Privacy notice ───────────────────────────────────────────────────────
  {
    id: 'C3',
    title: 'Privacy notice: the legal text for /privacy',
    short: 'Privacy notice legal text',
    why: 'The application form asks for GDPR consent and links to it (§1.7, §2.1)',
    format: 'Word or PDF, final legal text',
    who: 'Data protection lead / solicitor',
    neededBy: 'Before go-live; ideally before UAT',
    status: '☐ (26.09: the data protection policy is not the notice)',
    sections: std({
      need: [
        'The legal privacy notice for applicants and workers, from THC or its solicitor, to replace the page at /privacy — the page the application form links to before the consent tick (§1.7, §2.1), and that the sign-in pages of all three applications link to.',
        'It should cover at least: who the controller is and how to contact them; the lawful basis for each use; what is collected at application, during onboarding and while working — including the worker’s location while checked in to a shift; who it is shared with and where it goes (Willo for interviews, Anthropic (Claude) for reading documents, Resend for email, Supabase and Vercel for hosting — all under contract); retention, including right-to-work evidence for the length of employment plus two years; the worker’s rights and how to complain to the ICO.',
      ],
      why: [
        'Consent on the application form is only meaningful against a notice that says what actually happens (§1.7). The current page describes what the platform does, but it is not a solicitor’s notice.',
      ],
      format: [
        'Word or PDF, final. The current page is a factual summary of what the platform actually does, written from the Scope with the source section noted against every point — it can go to the solicitor as the basis for the real notice.',
      ],
      send: ['Email.'],
      until: [
        'The placeholder is live. It is headed **“How we use your personal data”** with the sections **What we hold · Who can see it · How long we keep it · Having your data removed · Contact**, and carries the note: “This is a summary. THC’s full legal privacy notice will replace this page.” It names no lawful bases, no controller details and no ICO route.',
        '**26.09.2026:** THC sent a **“Data protection policy for Workers”**. That is THC’s internal policy on how the Company handles personal data — not the notice this item asks for; it itself tells workers to “refer to the Company’s privacy notice for workers”. /privacy stays as it is until that notice arrives.',
      ],
    }),
  },

  // ── Retention decision ───────────────────────────────────────────────────
  {
    id: 'D1',
    title: 'Decision: keep other right-to-work evidence for employment + 2 years after a removal?',
    short: 'Retention of right-to-work evidence after a GDPR removal',
    why: 'The completion letter is already held for employment + 2 years; whether the rest should be is a §1.7 decision',
    format: 'Yes / No, with a line on why',
    who: 'Data protection lead / HR',
    neededBy: 'Before go-live',
    sections: std({
      need: [
        'A yes or no: when a worker asks to be removed under GDPR, should the platform keep their **other** right-to-work evidence — passport copy, visa, share-code report, National Insurance evidence — for the length of their employment plus two years, the way it already keeps the University Completion Letter?',
        'Background. THC’s completion-letter requirement says that letter is retained for the duration of employment plus two years, in line with right-to-work evidence retention. The Scope’s removal rule says contacts, documents and photo are wiped (§1.7). Where the two met, the build took the legal-obligation reading for the completion letter only: on removal the worker is anonymised to “Deleted account #id” and everything else is deleted, but the completion letter is held until two years after employment ended and is then deleted automatically, with an audit entry. Whether the same argument should hold passports, visas and share-code reports is a wider decision about §1.7 that the build did not make.',
      ],
      why: [
        'An employer is expected to be able to produce right-to-work evidence for two years after employment ends; a removal that wipes it removes that protection. Against that, holding more of a removed person’s data than the law requires is exactly what GDPR guards against. This is THC’s call, or its solicitor’s.',
      ],
      format: [
        '“Yes — hold all right-to-work evidence the same way” or “No — completion letter only, as today”, with a line on why, so the privacy notice (item 13) can say the same thing.',
      ],
      send: ['Email.'],
      until: [
        'Completion letter held; everything else wiped at removal. The placeholder privacy notice says so.',
      ],
    }),
  },

  // ── Q1–Q6 ────────────────────────────────────────────────────────────────
  {
    id: 'Q1',
    title: 'Question: a replacement who arrives late to a full shift',
    short: 'Q1 · Replacement arriving late to a full shift',
    why: 'Two rules meet: the No-show exemption for late-confirmed replacements (§5.1) and turn-away pay measured from the scheduled start (RULE-15)',
    format: 'One-line answer',
    who: 'Operations manager, with payroll',
    neededBy: 'Before UAT',
    sections: question({
      ask: 'if we pull in a replacement after a shift has started and the shift is full by the time they arrive, should they be paid the four-hour turn-away — or nothing, because they arrived more than 30 minutes after the original start time?',
      today:
        'Implemented exactly as the scope reads: RULE-15 measures from the scheduled start for everyone, with no exemption — so the replacement is “late” and paid nothing.',
      alternative:
        'Measure a post-start confirmation’s promptness from the moment they were confirmed, not from the scheduled start — so the replacement above would be “on time” and paid the four hours. A small change, and safer to make now than after the first real turn-away.',
      where:
        '§5.1 (the No-show lock) against RULE-15 (buffer turn-away pay); §3.4 (the buffer-exhausted escalation).',
    }),
  },
  {
    id: 'Q2',
    title: 'Question: a break the worker forgets to end',
    short: 'Q2 · A break with no end',
    why: '§5.2b allows several breaks a shift and deducts the total, but does not say what a break with no end is worth',
    format: 'One of three options',
    who: 'Payroll',
    neededBy: 'Before UAT',
    sections: question({
      ask: 'if a worker starts a break and never presses "Finish break", should we deduct the time up to their check-out, ignore it, or deduct a fixed amount — say the 20 minutes UK law requires on a shift over six hours?',
      today:
        'The break runs to the recorded finish, so the whole of it is deducted; the four-hour minimum still protects the floor, the manager sees it in the Breaks column, and check-out closes the break so it stops reading as “still on break”.',
      alternative:
        'Ignore a break with no end and pay the time, or deduct a fixed amount. Neither is obviously right: deducting charges a worker for a button they did not press; ignoring pays for a break they did take. The current choice is the one that does not bill the client for time nobody worked.',
      where: '§5.2b (breaks); RULE-14 (the four-hour minimum).',
    }),
  },
  {
    id: 'Q3',
    title: 'Question: “Get back” long after the shift has ended',
    short: 'Q3 · Clearing a No-show after the shift',
    why: 'Resolving a No-show records the worker as arrived at the moment the manager presses it, with no time limit (§3.3, §9.5)',
    format: 'One-line answer',
    who: 'Operations manager',
    neededBy: 'Before UAT',
    sections: question({
      ask: 'when a manager clears a No-show after the shift has finished, should we ask them what time the worker actually turned up — or is it enough to record it as the moment they pressed the button?',
      today:
        'The press time is taken at face value, as written. Pressed the next morning it records an arrival after the shift ended, and in practice the four-hour minimum means such a worker is paid four hours.',
      alternative:
        'Once the shift has ended, refuse the one-press reclassification and ask the manager for the actual arrival time — the way “Actual finish (UK time)” is already asked for when a No check-out is resolved.',
      where: '§3.3 and §9.5 (Get back / Resolve); RULE-01 (the pay window).',
    }),
  },
  {
    id: 'Q4',
    title: 'Question: what “Resolve” does to the show-rate',
    short: 'Q4 · Resolved violations and the reliability score',
    why: '§9.5 says resolving “removes or reduces” the effect on the show-rate, which is 30% of the auto-assign score',
    format: 'Remove entirely, or count at a stated fraction',
    who: 'Operations manager',
    neededBy: 'Before UAT',
    sections: question({
      ask: 'once a manager resolves a violation with a note, should it stop counting against that worker’s reliability score completely, or still count — and if so, by how much?',
      today:
        'Nothing depends on it yet: the nightly job that computes the show-rate has not been written, so the answer is wanted before it is, not after.',
      alternative:
        'Removes and reduces are different numbers. A resolved No-show that still counts at half weight ranks a worker differently in auto-assign from one that does not count at all.',
      where: '§9.5 (violations and Resolve); §6 (the auto-assign score: show-rate 30%).',
    }),
  },
  {
    id: 'Q5',
    title: 'Question: a term dates letter that arrives for next year, in December',
    short: 'Q5 · Next year’s term letter uploaded in December',
    why: '§4.2 expires every term letter on 31 December, which would kill a letter uploaded in answer to the 1 December reminder',
    format: 'One-line answer',
    who: 'Compliance manager',
    neededBy: 'Before UAT',
    sections: question({
      ask: 'if a student uploads next year’s term dates letter in December, in answer to the reminder you just sent them, should it cover the year ahead (what we do), or expire on the 31st a few weeks later?',
      today:
        'A letter uploaded in November or December runs to the following 31 December; every other letter expires on the 31 December of the year it was uploaded. The letter’s own printed dates are never used to decide its expiry.',
      alternative:
        'The literal reading: every letter expires on the 31 December of the year it was uploaded — which blocks on 1 January the student who did exactly what the reminder asked, and releases every future shift they hold.',
      where: '§4.2 (term letter expiry and the reminder ladder); §4.3 (the automatic block).',
    }),
  },
  {
    id: 'Q6',
    title: 'Question: the wording of the “your weekly limit has changed” push (N14)',
    short: 'Q6 · N14 wording for workers with no end date',
    why: '§4.4 gives N14 as “… until [date]”, but a graduate or an opted-out worker has no date',
    format: 'Approve, or replacement wording',
    who: 'Compliance manager / whoever owns worker communications',
    neededBy: 'Before UAT',
    sections: question({
      ask: 'for a worker with no end date — graduated, or opted out — is dropping the "until …" clause right, or should it read something like "until further notice"? And is "You no longer have a weekly hours limit" the wording you want for the opt-out?',
      today:
        'N14 is sent in one of three forms — dated: “Your weekly limit is now {limit} hours — {band} until {date}.” · open: “Your weekly limit is now {limit} hours — {band}.” · uncapped: “You no longer have a weekly hours limit — {band}.” The band reaches the worker as words (“term time”, “university holiday”).',
      alternative:
        'One sentence with optional clauses, which would send “Your weekly limit is now no hours” to somebody who has just removed their ceiling — the opposite of what happened.',
      where: '§4.4 (N14); §8 (the push register).',
    }),
  },

  // ── Acknowledgements ─────────────────────────────────────────────────────
  {
    id: 'A1',
    title:
      'Acknowledge: the Staff App is a web app (PWA), not Flutter — and the background-tracking option',
    short: 'Acknowledge: PWA instead of Flutter; background tracking A or B',
    why: 'The Scope fixed Flutter for the background geofence (§1.3, §5.1); THC chose a PWA on 18.09.2026',
    format: 'A signed line: PWA acknowledged; tracking Option A or B',
    who: 'Director',
    neededBy: 'With this document',
    sections: std({
      need: [
        'Written confirmation of two decisions already taken:',
        {
          ul: [
            '**(a)** The Staff App is an installable web app (a PWA) on the same technology as the two web portals, not a native Flutter app (THC decision, 18.09.2026; the Scope’s §1.3 fixed Flutter). It installs from a link, updates instantly and needs no app store. On iPhone, push notifications require adding it to the Home Screen, and the activation flow walks the worker through that.',
            '**(b)** Background location tracking for the whole shift (the Scope’s BG-06 and BG-07). A web app records location at check-in, at check-out and while the app is open, but not with the phone in the pocket. Two options were set out. **Option A:** foreground-only tracking in v1; off-site departures are caught at check-out and through the “No check-out” flow, and BG-06/07 are recorded as partially met. **Option B:** the same app wrapped in a thin store-installed shell that adds background tracking, at additional cost and with app-store review. Please state whether B is required for v1 or A is accepted.',
          ],
        },
      ],
      why: [
        'One codebase for phone, tablet and browser, instant updates and no store review — against the one thing a web app cannot do, which is track a phone in a pocket (§1.3, §5.1, BG-06/07).',
      ],
      format: [
        'A line in the reply: “PWA acknowledged; background tracking: Option A / Option B.”',
      ],
      send: ['Email.'],
      until: [
        'The app ships as a PWA with Option A behaviour. The check-in data already accepts background pings, so choosing B later needs no change to the data.',
      ],
    }),
  },
  {
    id: 'A2',
    title: 'Acknowledge: Supabase and Vercel instead of Django on DigitalOcean or AWS',
    short: 'Acknowledge: Supabase + Vercel instead of Django',
    why: 'The Scope fixed Django/DRF (§1.3) and DigitalOcean or AWS (§1.1); the build runs on Supabase and Vercel',
    format: 'A signed line',
    who: 'Director',
    neededBy: 'With this document',
    sections: std({
      need: [
        'Written confirmation that the back end is **Supabase** — a managed PostgreSQL database with sign-in, file storage, background functions and scheduled jobs — with the three applications hosted on **Vercel**, rather than Django/DRF on DigitalOcean or AWS (§1.1, §1.3). Everything the Scope calls “Django Admin” is a Settings page in the Back Office: the sender addresses, the Willo stage mapping, venue types, the rota guard.',
      ],
      why: [
        'A managed database and hosting service instead of servers THC would have to run and patch; every rule in the Scope is unchanged. The practical consequence for THC is item 8: the production accounts are subscriptions in THC’s name.',
      ],
      format: ['A line in the reply: “Supabase and Vercel acknowledged.”'],
      send: ['Email.'],
      until: ['Not applicable — this is how the platform is built.'],
    }),
  },
  {
    id: 'A3',
    title: 'Acknowledge: the visual direction',
    short: 'Acknowledge: the visual direction (one rounded look, light and dark)',
    why: 'The design pack’s §1.6 rendering is marked STRICT; the shipped look follows the design boards supplied on 21.09.2026',
    format: 'A signed line',
    who: 'Director / whoever owns the brand',
    neededBy: 'With this document',
    sections: std({
      need: [
        'Written confirmation of the visual direction settled on 21.09.2026 from the design boards supplied: **one rounded look** — pill-shaped controls, the Plus Jakarta Sans typeface, gradient primary buttons, violet for Auto-Assign — in **two grounds**: light on warm cream with soft shadows, dark on navy with a soft glow. The switch in the app changes only the ground. The ten brand colours and the accessibility contrast work are unchanged. This departs from the design pack’s literal rendering (zero radii and frosted glass, §1.6, §10.1), which stays reproducible in the code if THC ever wants it back.',
      ],
      why: [
        'The boards THC supplied show the same four screens in a light and a dark version with identical geometry; only the ground changes. Every screen in all three applications now follows that.',
      ],
      format: ['A line in the reply: “Visual direction acknowledged.”'],
      send: ['Email.'],
      until: ['Not applicable — this is how every screen is built.'],
    }),
  },
];

ITEMS.forEach((it, i) => {
  it.n = i + 1;
});

const byId = (id) => ITEMS.find((i) => i.id === id).n;

/**
 * The items in five parts. Each part starts a new page in the PDF and is a
 * `###` heading in the Markdown, so a reader can hand Part 2 to the office
 * manager and Part 4 to whoever owns the product decisions.
 */
const PARTS = [
  { heading: 'Part 1 · Appendix B inputs: keys and content', ids: ['B1', 'B2', 'B3', 'B4'] },
  { heading: 'Part 2 · Appendix B inputs: data, DNS and hosting', ids: ['B5', 'B6', 'B7', 'B8'] },
  { heading: 'Part 3 · Content and wording sign-off', ids: ['C1', 'C2', 'W1', 'W2', 'C3'] },
  {
    heading: 'Part 4 · Decisions and product questions',
    ids: ['D1', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
  },
  { heading: 'Part 5 · Agreed changes to acknowledge', ids: ['A1', 'A2', 'A3'] },
].map((p) => ({ ...p, items: p.ids.map((id) => ITEMS.find((i) => i.id === id)) }));

const DOC = {
  title: 'Inputs required from The Hospitality Company',
  subtitle: 'Staffing platform — build hand-over checklist',
  date: '26 September 2026',
  version: '1.1',
  preparedFor: 'Prepared for THC by the build team',
  footer: 'The Hospitality Company · Inputs required · v1.1',
  coverNote:
    'This document lists everything the build still needs from The Hospitality Company: content, decisions, keys, DNS records and data. Each item says what is needed, why, in what format, how to send it, and what the platform shows until it arrives. The tracker on page 3 is the working list; the sections after it are the detail. Nothing here is a build task, and nothing here needs THC to have seen the code.',

  summary: {
    built: [
      `${PRODUCT} is feature-complete. Three applications run on one database: the **Back Office Portal** for THC’s office, the **Staff App** — an installable app on the worker’s phone — and the **Client Portal**, where a client sees their own events and line-up and never sees money. Every screen in the design pack is built, and every rule in the Scope of Work v1.6 — onboarding, the weekly hours limit, auto-assign, check-in and check-out, pay, notifications, GDPR removal — is implemented and held by automated tests: the rules themselves, the database’s row-level security, and the screens.`,
      'It runs today on a staging environment with sample data, ready for THC’s people to walk through.',
    ],
    cannotGoLive: [
      'None of the items below is a build task. Each is content, a decision, a key, a DNS record or data that only THC can supply. Until each one arrives the platform shows a clearly marked placeholder, holds the affected messages in a queue, or runs the cautious version of a rule. Nothing is lost and nothing has to be re-entered — but none of it should reach a real worker or client, so these gate UAT and go-live rather than the build.',
    ],
    leadTime: [
      {
        item: `${byId('B7')} · DNS records for admin@ and timesheets@`,
        whyLong:
          'They live with whoever manages THC’s domain, take up to 48 hours to spread, and every email the platform sends waits until they are verified.',
        appendix: 'Before UAT',
        target: 'Two weeks before UAT starts',
      },
      {
        item: `${byId('B1')} · Willo keys and stage mapping`,
        whyLong:
          'Needs the Willo account owner and probably Willo support; the first test delivery may show differences we then adjust.',
        appendix: 'Start of the onboarding build',
        target: 'Two weeks before UAT',
      },
      {
        item: `${byId('B2')} · The zero-hours contract text`,
        whyLong:
          'A legal document, usually with a solicitor’s review; testers should sign the real text.',
        appendix: 'Before the contract step is built',
        target: 'Two weeks before UAT',
      },
      {
        item: `${byId('B3')} · Sample term dates and completion letters`,
        whyLong:
          'Collecting three to five of each from real students and redacting them; tuning the reader takes about a week after that.',
        appendix: 'Start of the AI extraction work',
        target: 'Three weeks before UAT',
      },
      {
        item: `${byId('B5')} and ${byId('B6')} · Old-system export, then the dry-run sign-off`,
        whyLong:
          'Extracting from Accelerate, agreeing the columns, one import on staging, a checked sample.',
        appendix: 'Four weeks before go-live; sign-off two weeks before',
        target: 'As Appendix B',
      },
    ],
    leadTimeNote:
      'Appendix B’s “needed by” dates were set against the build; the build is done, so the dates above are re-stated against UAT and go-live. Everything else on the tracker is wanted before UAT, so that what is tested is what goes live.',
  },

  tools: [
    [
      'Willo',
      'Video-interview service. The application form creates each candidate there; Willo reports back when the interview is done and what was decided.',
      'THC’s own',
      'Yes — it is THC’s account already. We need three values from it (item 1).',
    ],
    [
      'Resend',
      'The email-sending service the platform sends admin@ and timesheets@ mail through.',
      'Build team',
      'No login needed. The domain verification is on THC’s DNS (item 7). The account transfers at hand-over.',
    ],
    [
      'Web Push',
      'The phone notifications. No account: a key pair is generated once by the build team.',
      '—',
      'No.',
    ],
    [
      'Supabase',
      'The database, file storage, sign-in and background jobs. London region.',
      'Build team (staging)',
      'A production organisation owned by THC (item 8), with the build team invited in.',
    ],
    [
      'Vercel',
      'Hosts the three web applications.',
      'Build team (staging)',
      'A production team owned by THC (item 8).',
    ],
    [
      'Anthropic (Claude API)',
      'Reads uploaded documents to pre-fill dates and confidence; a manager always checks (ADR-0033 — replaces the scope’s Gemini, awaiting THC’s confirmation). Off until a key is set.',
      'THC',
      'Yes — an Anthropic organisation and API key in THC’s name, set on the Staff App.',
    ],
    [
      'Mapbox',
      'The map of venues and their geofences in the Back Office.',
      'Build team',
      'No. Transfers at hand-over.',
    ],
    [
      'GitHub',
      'Where the code lives.',
      'Build team',
      'A THC organisation to receive the code at hand-over (item 8).',
    ],
  ],

  closing: {
    howToReturn: [
      `Reply to the covering email using the tracker numbers — for example “Item ${byId('B7')}: done, records added on 3 October”. Documents and spreadsheets: by email for anything that holds no personal data; by a shared drive folder restricted to the build team for anything that does. Keys and secrets — item ${byId('B1')}, and bank details if they are ever migrated under item ${byId('B5')} — by password-manager share or on a call, never by email or messaging app.`,
    ],
    contactLines: [
      'Build team contact: ______________________________________ (name · email · phone)',
      'THC contact for this checklist: __________________________________',
    ],
    next: [
      `**What happens next.** When items ${byId('B7')}, ${byId('B8')} and ${byId('B1')} and the content items (${byId('B2')}, ${byId('C1')}, ${byId('C2')}, ${byId('W1')}, ${byId('W2')}) are in, the build team switches email and push on, sets up THC’s production accounts, and opens **UAT** on staging: THC’s office team walks every screen with real content — a worker onboarded end to end, an event built, filled by auto-assign, checked in, checked out and timesheeted; a client signing in to see their line-up. In parallel the old-system export (${byId('B5')}) is imported on staging for the **migration dry run** and the sample check (${byId('B6')}). After sign-off, **go-live** is the production import, the switch to the final web addresses if THC wants its own, and the first live applicants. The accounts and the code then transfer to THC at hand-over.`,
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 2 · MARKDOWN TWIN
// ═══════════════════════════════════════════════════════════════════════════

function mdCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
function mdTable(head, rows) {
  const out = [`| ${head.map(mdCell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) out.push(`| ${r.map(mdCell).join(' | ')} |`);
  return out.join('\n');
}
function mdBlock(b) {
  if (typeof b === 'string') return b;
  if (b.ul) return b.ul.map((x) => `- ${x}`).join('\n');
  if (b.h) return `##### ${b.h}`;
  if (b.note) return `_${b.note}_`;
  if (b.quote) {
    const lines = Array.isArray(b.quote) ? b.quote : [b.quote];
    const body = lines.map((l) => `> ${l}`).join('\n>\n');
    return b.label ? `> **${b.label}**\n>\n${body}` : body;
  }
  if (b.table) return mdTable(b.table.head, b.table.rows);
  throw new Error(`unknown block ${JSON.stringify(b)}`);
}

function toMarkdown(doc) {
  const L = [];
  L.push(`# ${doc.title}`);
  L.push('');
  L.push(`**${doc.subtitle}** · ${doc.date} · Version ${doc.version} · ${doc.preparedFor}`);
  L.push('');
  L.push('> Generated by `node packages/pdf/scripts/thc-inputs.mjs` together with');
  L.push('> `docs/pdfs/THC-Inputs-Required.pdf` — the PDF is the copy sent to THC; this file is');
  L.push('> its twin for the repository. Edit the script, not this file.');
  L.push('');
  L.push(doc.coverNote);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('### What is built');
  L.push('');
  for (const p of doc.summary.built) L.push(p, '');
  L.push('### What cannot go live without THC');
  L.push('');
  for (const p of doc.summary.cannotGoLive) L.push(p, '');
  L.push('### Five things with lead time');
  L.push('');
  L.push(
    mdTable(
      ['Item', 'Why it takes time', 'Appendix B said', 'Suggested target'],
      doc.summary.leadTime.map((r) => [r.item, r.whyLong, r.appendix, r.target]),
    ),
  );
  L.push('');
  L.push(doc.summary.leadTimeNote);
  L.push('');
  L.push('## Tracker');
  L.push('');
  L.push(
    mdTable(
      [
        '#',
        'Item',
        'Why the system needs it',
        'Format wanted',
        'Who at THC',
        'Needed by',
        'Status',
      ],
      ITEMS.map((it) => [
        it.n,
        it.short,
        it.why,
        it.format,
        it.who,
        it.neededBy,
        it.status ?? (it.done ? 'Done' : '☐'),
      ]),
    ),
  );
  L.push('');
  L.push('## The items');
  L.push('');
  for (const part of PARTS) {
    L.push(`### ${part.heading}`);
    L.push('');
    for (const it of part.items) {
      L.push(`#### ${it.n} · ${it.title}`);
      L.push('');
      L.push(
        `**Needed by:** ${it.neededBy} · **Who at THC:** ${it.who} · **Format:** ${it.format}${it.done ? ' · **Status:** done' : ''}`,
      );
      L.push('');
      for (const s of it.sections) {
        L.push(`**${s.heading}**`);
        L.push('');
        for (const b of s.blocks) L.push(mdBlock(b), '');
      }
    }
  }
  L.push('## Tools and accounts involved');
  L.push('');
  L.push(
    mdTable(
      ['Tool', 'What it is', 'Who owns the account today', 'Does THC need its own login?'],
      doc.tools,
    ),
  );
  L.push('');
  L.push('## Returning the items');
  L.push('');
  for (const p of doc.closing.howToReturn) L.push(p, '');
  for (const p of doc.closing.contactLines) L.push(p, '');
  for (const p of doc.closing.next) L.push(p, '');
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
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

const OLD_UA = 'Mozilla/5.0 (Windows NT 6.1; rv:2.0) Gecko/20100101 Firefox/4.0';
const FONT_WEIGHTS = [400, 600, 700];

/**
 * Registers Plus Jakarta Sans from static WOFF files, fetching them once
 * from Google Fonts into a cache directory. Returns the family name to use,
 * which is 'Helvetica' when the files cannot be obtained.
 */
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
      `thc-inputs: Plus Jakarta Sans not available (${err.message}); falling back to Helvetica.`,
    );
    return 'Helvetica';
  }
}

Font.registerHyphenationCallback((word) => [word]);

let FAMILY = 'Helvetica';
let s; // stylesheet, built once the family is known

function buildStyles() {
  s = StyleSheet.create({
    // No lineHeight on the page: a fixed, absolutely positioned footer that
    // inherits a lineHeight from the Page is dropped from every page by
    // react-pdf 4.9, so the leading is set on the text styles below instead.
    page: {
      paddingTop: 54,
      paddingBottom: 66,
      paddingHorizontal: 52,
      fontFamily: FAMILY,
      fontSize: 9.5,
      color: NAVY,
    },
    // The rule is a filled View rather than a border: fewer bordered nodes
    // on the fixed footer, which is re-laid out on every page.
    footer: {
      position: 'absolute',
      bottom: 30,
      left: 52,
      right: 52,
      fontSize: 7.5,
      color: MUTED,
    },
    footerRule: { height: 0.6, backgroundColor: RULE, marginBottom: 6 },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    // cover
    coverBrand: { flexDirection: 'row', alignItems: 'center', marginBottom: 150 },
    coverMark: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: NAVY,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    coverBrandName: { fontWeight: 700, fontSize: 12 },
    coverBrandSub: { fontSize: 8.5, color: MUTED },
    coverTitle: { fontWeight: 700, fontSize: 30, lineHeight: 1.15, marginBottom: 10 },
    coverSubtitle: { fontWeight: 600, fontSize: 15, color: TEAL, marginBottom: 16 },
    coverRule: { width: 64, height: 3, backgroundColor: CYAN, marginBottom: 28 },
    coverMetaRow: { flexDirection: 'row', marginBottom: 4 },
    coverMetaKey: { width: 110, color: MUTED },
    coverMetaVal: { fontWeight: 600 },
    coverNote: { marginTop: 40, color: MUTED, fontSize: 9.5, lineHeight: LH },
    // headings
    h1: { fontWeight: 700, fontSize: 18, marginBottom: 12, color: NAVY },
    h2: { fontWeight: 700, fontSize: 11.5, color: TEAL, marginTop: 10, marginBottom: 5 },
    itemHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: 22,
      marginBottom: 8,
      paddingBottom: 6,
      borderBottomWidth: 1.2,
      borderBottomColor: CYAN,
    },
    itemNum: { width: 30, fontWeight: 700, fontSize: 16, color: TEAL },
    itemTitle: { flex: 1, fontWeight: 700, fontSize: 13, lineHeight: 1.25 },
    sub: {
      fontWeight: 700,
      fontSize: 8,
      color: TEAL,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 9,
      marginBottom: 3,
    },
    // Every style that sets the unitless lineHeight also sets fontSize:
    // react-pdf resolves the multiplier against the node's own fontSize and
    // falls back to its 18pt default, not the inherited size, when none is set.
    p: { fontSize: 9.5, marginBottom: 5, lineHeight: LH },
    note: { marginBottom: 5, color: MUTED, fontSize: 8.5, lineHeight: LH },
    bullet: { flexDirection: 'row', marginBottom: 3, paddingLeft: 4 },
    bulletDot: { width: 12, color: TEAL, fontSize: 9.5, lineHeight: LH },
    bulletText: { flex: 1, fontSize: 9.5, lineHeight: LH },
    quote: {
      backgroundColor: CREAM,
      borderLeftWidth: 2.5,
      borderLeftColor: TEAL,
      paddingVertical: 6,
      paddingHorizontal: 10,
      marginTop: 2,
      marginBottom: 7,
    },
    quoteLabel: { fontWeight: 600, fontSize: 8, color: TEAL, marginBottom: 3, lineHeight: LH },
    quoteLine: { fontSize: 9, marginBottom: 3, lineHeight: LH },
    // meta strip under each item heading
    meta: {
      flexDirection: 'row',
      backgroundColor: CREAM,
      borderRadius: 4,
      paddingVertical: 6,
      paddingHorizontal: 8,
      marginBottom: 4,
    },
    metaCell: { flex: 1, paddingRight: 8 },
    metaKey: {
      fontSize: 7,
      color: MUTED,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      lineHeight: LH,
    },
    metaVal: { fontSize: 8.5, fontWeight: 600, lineHeight: LH },
    // tables
    table: { borderWidth: 0.6, borderColor: RULE, marginTop: 3, marginBottom: 7 },
    tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: RULE },
    th: {
      backgroundColor: CREAM,
      fontWeight: 700,
      fontSize: 7.5,
      color: TEAL,
      paddingVertical: 4,
      paddingHorizontal: 5,
    },
    td: { fontSize: 8.2, lineHeight: 1.35, paddingVertical: 4, paddingHorizontal: 5 },
    statusBox: {
      width: 9,
      height: 9,
      borderWidth: 0.8,
      borderColor: NAVY,
      borderRadius: 1.5,
      marginTop: 2,
    },
    doneText: { fontSize: 7.5, fontWeight: 600, color: TEAL },
    statusNote: { fontSize: 6.6, lineHeight: 1.3, color: MUTED, marginTop: 2 },
    contactLine: { fontSize: 9.5, marginTop: 12, marginBottom: 4, fontWeight: 600, lineHeight: LH },
  });
}

/** Body leading. Set per text style, never on the Page (see `page`). */
const LH = 1.45;

/**
 * Characters the PDF faces cannot draw (neither the Google Fonts Plus
 * Jakarta Sans files nor the Helvetica fallback carry U+2192, which then
 * prints as a stray glyph), spelled out for the PDF only. The Markdown
 * twin keeps the original character.
 */
const PDF_GLYPHS = [[/\s*→\s*/g, ' to ']];

/** `**bold**` runs inside a string → an array of Text children. */
function inline(text) {
  const parts = PDF_GLYPHS.reduce((t, [re, to]) => t.replace(re, to), String(text)).split('**');
  if (parts.length === 1) return parts[0];
  return parts.map((part, i) =>
    i % 2 === 1 ? h(Text, { key: i, style: { fontWeight: 700 } }, part) : part,
  );
}

function P(text, style) {
  return h(Text, { style: [s.p, style || {}] }, inline(text));
}

function Bullets(items) {
  return h(
    View,
    null,
    items.map((it, i) =>
      h(
        View,
        { key: i, style: s.bullet, wrap: false },
        h(Text, { style: s.bulletDot }, '•'),
        h(Text, { style: s.bulletText }, inline(it)),
      ),
    ),
  );
}

function Quote(b) {
  const lines = Array.isArray(b.quote) ? b.quote : [b.quote];
  const long = lines.join(' ').length > 900;
  return h(
    View,
    { style: s.quote, wrap: long },
    b.label ? h(Text, { style: s.quoteLabel }, b.label) : null,
    lines.map((l, i) => h(Text, { key: i, style: s.quoteLine }, inline(l))),
  );
}

function Table({ head, rows, widths }, opts = {}) {
  const n = head.length;
  const w = widths || head.map(() => 1 / n);
  const cell = (content, i, style) =>
    h(
      View,
      {
        key: i,
        style: [
          { width: `${w[i] * 100}%` },
          i < n - 1 ? { borderRightWidth: 0.6, borderRightColor: RULE } : {},
        ],
      },
      typeof content === 'string' || typeof content === 'number'
        ? h(Text, { style: style }, inline(String(content)))
        : h(View, { style: style }, content),
    );
  return h(
    View,
    { style: s.table },
    h(
      View,
      { style: s.tr, wrap: false },
      head.map((c, i) => cell(c, i, s.th)),
    ),
    rows.map((r, ri) =>
      h(
        View,
        {
          key: ri,
          style: [s.tr, ri === rows.length - 1 ? { borderBottomWidth: 0 } : {}],
          wrap: false,
        },
        r.map((c, i) => cell(c, i, opts.tdStyle ? [s.td, opts.tdStyle] : s.td)),
      ),
    ),
  );
}

function Block(b, key) {
  if (typeof b === 'string') return h(Fragment, { key }, P(b));
  if (b.ul) return h(Fragment, { key }, Bullets(b.ul));
  if (b.h) return h(Text, { key, style: s.h2, minPresenceAhead: MPA }, b.h);
  if (b.note) return h(Text, { key, style: s.note }, inline(b.note));
  if (b.quote) return h(Fragment, { key }, Quote(b));
  if (b.table) return h(Fragment, { key }, Table(b.table));
  throw new Error(`unknown block ${JSON.stringify(b)}`);
}

function Footer(doc) {
  return h(
    View,
    { style: s.footer, fixed: true },
    h(View, { style: s.footerRule }),
    h(
      View,
      { style: s.footerRow },
      h(Text, null, doc.footer),
      h(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
    ),
  );
}

function Mark(logo) {
  if (!logo) return null;
  return h(
    View,
    { style: s.coverMark },
    h(
      Svg,
      { viewBox: logo.LOGO_VIEW_BOX, width: 15, height: 24 },
      h(Path, { d: logo.LOGO_GLASSES, fill: CYAN }),
      h(Path, { d: logo.LOGO_CORK, fill: CYAN }),
    ),
  );
}

function Cover(doc, logo) {
  return h(
    Page,
    { size: 'A4', style: s.page },
    h(
      View,
      { style: s.coverBrand },
      Mark(logo),
      h(
        View,
        null,
        h(Text, { style: s.coverBrandName }, 'The Hospitality Company'),
        h(Text, { style: s.coverBrandSub }, 'Staffing platform'),
      ),
    ),
    h(Text, { style: s.coverTitle }, doc.title),
    h(Text, { style: s.coverSubtitle }, doc.subtitle),
    h(View, { style: s.coverRule }),
    [
      ['Date', doc.date],
      ['Version', doc.version],
      ['Prepared', doc.preparedFor],
      ['Status', 'For action by THC'],
    ].map(([k, v]) =>
      h(
        View,
        { key: k, style: s.coverMetaRow },
        h(Text, { style: s.coverMetaKey }, k),
        h(Text, { style: s.coverMetaVal }, v),
      ),
    ),
    h(Text, { style: s.coverNote }, doc.coverNote),
    Footer(doc),
  );
}

function Summary(doc) {
  const sm = doc.summary;
  return h(
    Page,
    { size: 'A4', style: s.page },
    h(Text, { style: s.h1 }, 'Summary'),
    h(Text, { style: s.h2 }, 'What is built'),
    sm.built.map((p, i) => h(Fragment, { key: i }, P(p))),
    h(Text, { style: s.h2 }, 'What cannot go live without THC'),
    sm.cannotGoLive.map((p, i) => h(Fragment, { key: i }, P(p))),
    h(Text, { style: s.h2 }, 'Five things with lead time'),
    Table({
      widths: [0.28, 0.38, 0.17, 0.17],
      head: ['Item', 'Why it takes time', 'Appendix B said', 'Suggested target'],
      rows: sm.leadTime.map((r) => [r.item, r.whyLong, r.appendix, r.target]),
    }),
    h(Text, { style: s.note }, sm.leadTimeNote),
    Footer(doc),
  );
}

/**
 * The Status cell. `done` prints "Done"; `status` is the Markdown text,
 * where a leading ☐ means "still open" (drawn as the box, since the font
 * has no ☐ glyph) and anything after it is a note; otherwise the status is
 * printed as it stands (e.g. "Received 26.09 — … to confirm").
 */
function Status(it, boxStyle = s.statusBox) {
  if (it.done) return h(Text, { style: s.doneText }, 'Done');
  if (!it.status) return h(View, { style: boxStyle });
  if (it.status.startsWith('☐')) {
    const note = it.status
      .slice(1)
      .trim()
      .replace(/^\((.*)\)$/, '$1');
    return h(
      View,
      null,
      h(View, { style: boxStyle }),
      note ? h(Text, { style: s.statusNote }, note) : null,
    );
  }
  return h(Text, { style: [s.doneText, { lineHeight: 1.3 }] }, it.status);
}

function Tracker(doc) {
  const widths = [0.04, 0.19, 0.245, 0.165, 0.14, 0.1, 0.12];
  const rows = ITEMS.map((it) => [
    String(it.n),
    it.short,
    it.why,
    it.format,
    it.who,
    it.neededBy,
    Status(it),
  ]);
  return h(
    Page,
    { size: 'A4', style: s.page },
    h(Text, { style: s.h1 }, 'Tracker'),
    h(
      Text,
      { style: s.note },
      'One row per item, in the order of the sections that follow. Tick the box as each is sent; the section number is the item number.',
    ),
    Table(
      {
        widths,
        head: [
          '#',
          'Item',
          'Why the system needs it',
          'Format wanted',
          'Who at THC',
          'Needed by',
          'Status',
        ],
        rows,
      },
      { tdStyle: { fontSize: 7.4, lineHeight: 1.3 } },
    ),
    Footer(doc),
  );
}

/**
 * Look-ahead for a sub-heading, so it is never the last line on a page. It
 * is only ever put on plain text; the item heading and its meta strip are
 * kept together as one non-wrapping group instead.
 */
const MPA = 50;
/** Characters in an opening paragraph kept on the page with its heading. */
const SHORT_PARA = 700;

function Item(it) {
  return h(
    View,
    { key: it.id },
    h(
      View,
      { wrap: false },
      h(
        View,
        { style: s.itemHead },
        h(Text, { style: s.itemNum }, String(it.n)),
        h(Text, { style: s.itemTitle }, it.title),
      ),
      h(
        View,
        { style: s.meta },
        [
          ['Needed by', it.neededBy],
          ['Who at THC', it.who],
          ['Format wanted', it.format],
        ].map(([k, v]) =>
          h(
            View,
            { key: k, style: s.metaCell },
            h(Text, { style: s.metaKey }, k),
            h(Text, { style: s.metaVal }, v),
          ),
        ),
        h(
          View,
          { style: [s.metaCell, { flex: it.status ? 0.7 : 0.45 }] },
          h(Text, { style: s.metaKey }, 'Status'),
          Status(it, [s.statusBox, { marginTop: 3 }]),
        ),
      ),
    ),
    it.sections.map((sec, i) => {
      const head = h(Text, { style: s.sub, minPresenceAhead: MPA }, sec.heading);
      // A short opening paragraph (a few lines) cannot be split, and
      // minPresenceAhead alone has let such a heading end a page on its
      // own; keep the two together instead.
      const [first, ...rest] = sec.blocks;
      if (typeof first === 'string' && first.length <= SHORT_PARA) {
        return h(
          View,
          { key: i },
          h(View, { wrap: false }, head, Block(first, 0)),
          rest.map((b, j) => Block(b, j + 1)),
        );
      }
      return h(
        View,
        { key: i },
        head,
        sec.blocks.map((b, j) => Block(b, j)),
      );
    }),
  );
}

function Items(doc) {
  // THC_PDF_ITEMS=B1,Q2 limits the items while debugging a layout.
  const only = (process.env.THC_PDF_ITEMS || '').split(',').filter(Boolean);
  return PARTS.map((part) => {
    const items = only.length ? part.items.filter((it) => only.includes(it.id)) : part.items;
    if (items.length === 0) return null;
    return h(
      Page,
      { key: part.heading, size: 'A4', style: s.page },
      h(Text, { style: s.h1 }, part.heading),
      items.map((it) => Item(it)),
      Footer(doc),
    );
  });
}

function Closing(doc) {
  return h(
    Page,
    { size: 'A4', style: s.page },
    h(Text, { style: s.h1 }, 'Tools and accounts involved'),
    Table({
      widths: [0.16, 0.36, 0.18, 0.3],
      head: ['Tool', 'What it is', 'Who owns the account today', 'Does THC need its own login?'],
      rows: doc.tools,
    }),
    h(Text, { style: [s.h1, { marginTop: 18 }] }, 'Returning the items'),
    doc.closing.howToReturn.map((p, i) => h(Fragment, { key: i }, P(p))),
    doc.closing.contactLines.map((l, i) => h(Text, { key: i, style: s.contactLine }, l)),
    doc.closing.next.map((p, i) => h(Fragment, { key: i }, P(p, { marginTop: 12 }))),
    Footer(doc),
  );
}

function Doc(doc, logo) {
  // THC_PDF_PAGES=cover,summary limits the output while debugging a layout.
  const only = (process.env.THC_PDF_PAGES || '').split(',').filter(Boolean);
  const want = (name) => only.length === 0 || only.includes(name);
  return h(
    Document,
    { title: doc.title, author: 'The build team', subject: doc.subtitle, language: 'en-GB' },
    want('cover') ? Cover(doc, logo) : null,
    want('summary') ? Summary(doc) : null,
    want('tracker') ? Tracker(doc) : null,
    want('items') ? Items(doc) : null,
    want('closing') ? Closing(doc) : null,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · RUN
// ═══════════════════════════════════════════════════════════════════════════

async function loadLogo() {
  // The same two paths the printed timesheet uses (packages/pdf/src/logo.ts).
  // Node 22.18+ strips the types; older Nodes skip the mark rather than fail.
  try {
    return await import('../src/logo.ts');
  } catch {
    return null;
  }
}

async function main() {
  FAMILY = await registerFonts();
  buildStyles();
  const logo = await loadLogo();

  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  const pdf = await renderToBuffer(Doc(DOC, logo));
  fs.writeFileSync(OUT_PDF, pdf);

  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  process.stdout.write(
    `wrote ${path.relative(ROOT, OUT_PDF)} (${(pdf.length / 1024).toFixed(0)} KB, ${pages} pages, ${FAMILY})\n`,
  );

  if (!PARTIAL) {
    const md = toMarkdown(DOC);
    fs.writeFileSync(OUT_MD, md.endsWith('\n') ? md : `${md}\n`);
    process.stdout.write(
      `wrote ${path.relative(ROOT, OUT_MD)} (${(Buffer.byteLength(md) / 1024).toFixed(0)} KB)\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
