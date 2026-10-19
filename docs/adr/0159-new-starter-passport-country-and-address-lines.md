# ADR-0159 · Passport country and the address in separate fields on the New Starter (HMRC) report

**Status:** Accepted · Scope §9.9 Tab 3, §2.6, §1.7 · **Owner request:** 19.10.2026 ("For the New Starter HMRC report, can Passport Country be added in, and can the address be in separate fields, not just one field")

## Context

Payroll keys each new starter in from the New Starter (HMRC) CSV. Its form has one box per address line, but the report carried the home address as one line (`staff.home_address`, the shape `onboarding_save_address()` writes: `flat, house street, area, town POSTCODE`). It also asks which country issued the passport, and nothing on the platform recorded that: the AI read of a passport (§2.6, ADR-0033) only pre-filled its expiry.

Two choices were the product owner's, made 19.10.2026:

- **Where the passport country comes from:** read off the passport by the AI, with the office able to set or correct it on the worker's profile.
- **The full Home address column:** kept, with the separate fields beside it.

## Decision

- **`staff.passport_country`** — the issuing country by name ("Poland"), held by a CHECK to `known_countries()`, a fixed list of 199 countries whose twin is `PASSPORT_COUNTRIES` in `packages/domain/src/countries.ts` (`countries.test.ts` holds the two together, as ADR-0080 does for languages). A misread page — or a page written to talk the model into something — can only ever name a real country.
- **The AI read fills a blank.** The passport instruction now also asks for the issuing-state code printed in the machine-readable zone (`GBR`, `POL`, `D` for Germany). `passportCountryFromCode()` maps it to a name (with Germany's `D`, Kosovo's `XKX` and the UK's other nationality statuses `GBD/GBN/GBO/GBP/GBS`); only a page the model says is a legible passport yields one, and it never moves the confidence, which is about the dates. `apps/staff/lib/extract.ts` then calls **`record_passport_country(doc, country)`** (service role only), which writes only when the worker has none on file, never from a rejected passport and never for a removed worker. A re-read never overwrites what the office set.
- **The office sets or corrects it** on `/staff/:id` (Contacts & identity), through **`set_staff_passport_country(staff, country)`** — any office login that may write, refused for a viewer and a removed worker, audited without the value (as `set_staff_gender`, ADR-0079). This is the only way a worker onboarded before this change gets one.
- **§1.7:** `staff_wipe_report_fields()` nulls it on removal.
- **The address in fields:** `new_starter_address_parts(home_address)` reads the stored line back into **Address line 1 · 2 · 3 · Town / City** (the postcode was already its own column). The town is the part in front of a trailing UK postcode; parts beyond the third line join line 3, so nothing is dropped; a line with no UK postcode at its end has no town to find, and every part stays an address line.
- **The report:** `new_starter_rows()` (and so the `/reports` preview, the Export CSV and the Monday email) carries, in order: … Home address · Address line 1 · Address line 2 · Address line 3 · Town / City · Postcode · Country · **Passport country** · Date of birth …. The three functions are dropped and re-created (a changed result shape), grants restated as they were.

## Not done, on purpose

- **No backfill from earlier reads.** Passports read before this change were never asked for the code; re-reading every stored passport would be a separate, paid job. Their country is blank until the office records it (the preview says so in the cell).
- **The address is still stored as one line.** Splitting the storage would change both writers (the wizard and the Profile edit) and every reader for a report column; the split is computed where the report is built instead.
- **The worker is not asked.** The country is read off the document the worker already uploads; adding a question would duplicate it.
