# ADR-0071 · Branded HTML email: every email in THC Light, with the text kept

**Status:** Accepted (THC, 29.09.2026) · **Amends:** §11.3/§11.4's names for the two event documents in client emails (see *Deviation*), [ADR-0015](0015-reports-money-and-document-emails.md) (D1/D2 copy), [ADR-0039](0039-gdpr-scrub-worker-write-paths-and-cross-browser-reset.md) (the recovery template's look; its link is unchanged) · **Code:** `packages/notifications/src/email-html.ts`, `email-layouts.ts`, `email-logo.ts`, `documents.ts`, `outbox.ts`, `resend.ts`, `drain.ts`, `src/assets/thc-mark-email.{png,ts}`, `scripts/gen-email-logo.mjs`; tests `email-html.test.ts`, `drain.test.ts`, `documents.test.ts`; `supabase/templates/recovery.html`

## Context

Every email the drain sent went through Resend as plain `text` only: the 18 register emails THC sends (E1 is Willo's), and the three file emails in `documents.ts` (BG08 payroll, D1 and D2 to the client). Clients receive the D1/D2 emails. Candidates and new logins receive E2–E4 and E11. THC asked for these emails to look like the rest of the product.

THC also asked for two copy changes. The D1 email went out *before* the event, but it spoke of signing people out and of a "sign-out timesheet" to follow. THC does not want the term "sign-out timesheet" used with clients at all.

## Decision

**1. Every email is HTML and text.** `EmailMessage` gains `html`. `messageFor()` and `documentMessageFor()` render both. `buildResendRequest()` sends `text` and `html` together, and the drain passes both through. The plain text is the register's copy, unchanged. `templates.test.ts` still holds it to §8, because the wording is contract.

For a **register email** the HTML shows the same words and adds only layout. The only new words are the eyebrow, the button labels and the printed URL:

- **Title.** The subject.
- **Eyebrow.** A short label per template (`EMAIL_PRESENTATION`).
- **Paragraphs.** The template is split on its blank lines, and single line breaks are kept.
- **Facts box.** A template paragraph made only of "Label: {value}" lines becomes a facts box. Every row is kept, and an empty value is drawn as "—", because the text keeps "Note: " too.
- **Buttons.** A placeholder named as a link in `EMAIL_PRESENTATION` (E3's `link` and `installLink`, E11's `link`) becomes a pill button when its value is an http(s) URL. The URL is printed under the button.

**The layout comes from the template, never from a value.** `templateToBlocks()` reads the paragraphs, the facts rows and the button lines from the register template with its placeholders still in place. It fills in the values afterwards, HTML-escaped, with their line breaks drawn as `<br>`. A value is never split and never linked. So a worker who types a URL, blank lines or "Label: value" lines into a note cannot add a link, a paragraph or a facts row to an office email. A table test holds this for every placeholder of every register email. An http(s) URL written into the template's own words would be linked, but no template has one today. Buttons are chosen by placeholder name, not by what a value looks like.

The **file emails** (D1, D2, BG08) add more than layout, by design:

- D1 and D2 add a facts box built from the payload, the file cards, a `mailto:` reply button and HTML-only sentences. Those sentences sit in `DOCUMENT_EMAILS[…].html`, and each one is also in the text.
- BG08 is its text template laid out, plus a facts box and the CSV cards.
- Their facts rows are optional: an empty value drops its row.

**2. THC Light only.** The page ground, card, gradient bar, text, muted, eyebrow and facts colours are the `warm` + `light` tokens (`packages/ui/src/styles/tokens.css`), written out as literal values. There is no dark variant. `<meta name="color-scheme" content="light only">`, `supported-color-schemes` and `:root{color-scheme:light only}` ask mail apps not to invert the email.

The HTML is email-safe:

- table layout, 600px wide at most and fluid below that;
- all CSS inline, except resets and one phone media query;
- no external CSS, no script and no `data:` images;
- a solid `#0a6d79` behind every gradient, because Outlook for Windows draws no gradients;
- a table-based ("bulletproof") pill button.

**3. The logo is an inline CID image.** Gmail blocks `data:` URIs, and remote images stay hidden until the reader allows them. So the header's round mark (a 96×96 PNG of `brand/thc-mark.svg`, 2.6 KB) is sent with every email as a Resend attachment with `content_id: "thc-mark"` and `content_type: "image/png"`. The header shows it with `<img src="cid:thc-mark">`. The renderer accepts only a `cid:` or an http(s) source for the logo; any other source draws no image.

The bytes live in `email-logo.ts`, which only the drain imports. The package index (`@thc/notifications`) no longer re-exports the drain or the renderer, so an app that imports the register never bundles the logo or the renderer. They are reached by subpath instead: `@thc/notifications/drain` and `@thc/notifications/email-html`. The package is also marked `"sideEffects": false`.

The Deno drain reads no files, so the bytes are checked in twice:

- `src/assets/thc-mark-email.png`;
- a generated base64 module, `thc-mark-email.ts`.

`pnpm --filter @thc/notifications gen:logo` writes both files. A test checks that the two match byte for byte.

**4. The footer names the monitored address.** The footer shows `<address> · www.thehospitalitycompany.co.uk` and "Registered Company in England and Wales 12411407". The address is the sender's resolved reply-to (`resolveSender`, `timesheets@` or `admin@`), not the sending mailbox, because a reader who writes back should reach an inbox someone reads.

The drain renders each row twice:

- once to learn its sender;
- once with that sender's reply-to.

The document emails' text signature and their `mailto:` reply button use the same reply-to. `signedBy()` moved to `senders.ts`, so `documents.ts` can apply it.

**5. D1 and D2 renamed.** D1 is now the **Allocation Timesheet**. It is sent before the event, so it never mentions check-in, check-out or hours taken from them. It asks the manager on site to:

1. fill in the sheet;
2. print and sign it;
3. reply with it.

D2 is now the **Completed Allocation Timesheet**. Its figures are taken from check-in and check-out, so that wording stays. Tests hold both rules:

- D1 contains no `check-in`, `check-out` or `sign-out`;
- D2 contains no `sign-out`.

The D1/D2 payload may carry `schedule`, and D2 may carry `totalHours` (added by the event-documents side). Every facts row is optional, so a row written before those keys existed still renders, and an empty value drops its row.

**6. The Supabase Auth recovery email** (`supabase/templates/recovery.html`) uses the same layout. It is written by hand, because GoTrue renders it, not the drain. Its token_hash link is unchanged, and `packages/db`'s auth-config test still holds it. GoTrue sends no inline attachment, so it has no image: the header uses a text "THC" roundel instead.

## Deviation

§11.3/§11.4 call the two documents the "allocation sheet" and the "sign-out timesheet". THC agreed on 29.09.2026 that client emails call them **Allocation Timesheet** and **Completed Allocation Timesheet**. This ADR changes only the email copy (`documents.ts`). The Back Office button labels, the PDF titles and the client portal's document names are unchanged. Renaming those would be a separate change for their owners.

## Owner step

- **Re-paste `supabase/templates/recovery.html`** into Supabase → Authentication → Email Templates → **Reset Password**. The hosted project reads its templates from the dashboard, not from this file. Until it is re-pasted, password reset emails keep the old plain look. The link works either way.

## Consequences

- Every email is larger by the logo (about 3.5 KB as base64) and the HTML (about 5–12 KB). This is well inside Resend's limits.
- Rows already queued before this ships are rendered with the new copy and layout when they send. A row whose first attempt reached Resend without an answer, and which is retried after the deploy, sends a different body under the same `Idempotency-Key`. Resend answers 409, and the drain fails the row as permanent, with the 409 in its error. It is not sent twice. This can only happen to a row that was mid-retry at the deploy.
- `pnpm --filter @thc/notifications preview:emails`, with `THC_EMAIL_PREVIEW_DIR` set, writes every email as `.html` and `.txt` for screenshots. The previews are not committed.

## Not done

- **No webfont.** Plus Jakarta Sans is named first in the font stack, and mail apps without it use Arial. No Google Fonts `<link>` is loaded.
- **No VML button for Outlook for Windows.** Outlook shows a solid teal rectangle with a link, not a pill.
- **The other Supabase Auth templates are not restyled.** Only recovery has a checked-in template (`supabase/templates/`). The dashboard's own templates (for example Change email address, `docs/16-owner-guide.md` §1.3c) keep Supabase's look.
