# ADR-0025 · home_location follows the postcode

Status: accepted · 26.09.2026 · closes the docs/14 §4 "not re-geocoded" item carried since 22.09

## Context

- `staff.home_location` is the pin a worker drops at onboarding 2/11 — "a pin on
  the map (needed to calculate the home ↔ venue distance)", §10.3. It is the
  only input to §6's proximity factor (25%, `100 − km × 9`) and to every
  distance the Staff App prints from it (`staff_open_shifts`, `staff_bookings`).
- §10.1 lets the worker edit their home address on the profile, and E7 tells the
  office. `staff_update_contact()` (20260922180000) deliberately left the pin
  alone: "re-deriving it from free text with no geocoder would move a worker's
  score on a typo. E7 tells the office, and the office moves the pin." Nothing
  made the office do it, there is no office screen to do it on, and docs/14 §4
  carried the result as a gap: a worker who moved was scored, and shown
  distances, from where they used to live.
- The repo has had a postcode → point source since the wizard (ADR-0014):
  postcodes.io, open data, no key, UK-only. It centred the onboarding map and
  was never a geocoder of record, because the pin the worker drops is more
  exact than a centroid.

## Decision

1. **A changed address re-derives the point from its UK postcode.** After
   `staff_update_contact()` has saved the address and queued E7 — exactly as
   before — the profile action pulls the postcode out of the new address
   (`extractPostcode`: last match wins, since a UK address ends with its
   postcode), asks postcodes.io for the centroid (`lookupPostcode`; both in
   `apps/staff/lib/postcodes.ts`, shared with the wizard) and calls
   `staff_set_home_location_from_postcode(p_postcode, p_lat, p_lng)`
   (20260926100100).
2. **A centroid is good enough here.** postcodes.io's point is within ~100 m of
   the postcode's addresses. At `100 − km × 9` that is under one proximity
   point; the check-in geofence is drawn around the venue's point, never the
   worker's; nothing else reads `home_location`. The typo the old header feared
   is bounded to the postcode the worker typed into their own address, and the
   old rule scored them from an address they had already left.
3. **The database holds the rule that makes a point from a phone safe.** The RPC
   is `security definer`, resolves the caller through `staff_caller()` and takes
   no id. It refuses unless the normalised postcode (upper case, no whitespace)
   appears in the caller's *current* `home_address` (`postcode_not_in_address`),
   the point is inside the UK box `onboarding_save_address()` already uses
   (`pin_outside_uk`), the shape is a postcode (`bad_postcode`) and the worker is
   not a leaver (`not_editable`, §10.6). Revoked from `public`, `anon` and
   `service_role`; granted to `authenticated` only. A colleague cannot move
   anyone: there is no argument to name them by, and the postcode is checked
   against the caller's own address.
4. **Where the point came from is recorded.** `staff.home_location_source` —
   `pin` (placed by the worker, and the label while there is no point),
   `postcode` (this ADR), `office` (a manager moved it) — with a check constraint
   and a by-name column grant (#44's rule, asserted by 445). A
   `before update of home_location` trigger labels any move that does not
   restate the source as `pin`, so the wizard's pin after a reset to candidate
   and GDPR removal's null stay honest without those functions knowing the
   column exists. A writer that means `postcode` or `office` says so in a second
   statement, which is why the RPC updates twice; the office's future "move the
   pin" writes `office` the same way.
5. **E7 is unchanged, and so is what happens when the lookup fails.**
   `staff_update_contact()` is not restated. If no postcode can be extracted,
   postcodes.io does not know it, or the service is unreachable (5 s timeout),
   the address is saved, E7 is queued, the old point stays, and the screen says
   the office will move the pin — which is what E7 asks of them anyway. The save
   never fails on the pin.
6. **Nothing changes for the office yet.** There is no office-side address edit
   (`/staff/:id` shows the address read-only), so there was nothing to apply the
   lookup to. When one is built it should call the same lookup and write
   `office`.

## Consequences

- The §6 proximity score follows a worker who moves, within ~100 m, the moment
  they save, and the distances on their Radar and My shifts cards with it.
- The wizard keeps its dropped pin. `lookupPostcode` moved to
  `apps/staff/lib/postcodes.ts` and `onboarding/actions.ts` delegates to it,
  with the same three sentences and a 5 s timeout the old call did not have.
- `staff_me()` does not return the source; the profile screen states the rule
  rather than the label. Add it if a screen ever needs to show which it is.
- The Supabase types placeholder does not know `home_location_source`;
  regenerate when `packages/db` is next regenerated.
- docs/14 §4 should drop the "not re-geocoded" bullet and point here.

## Files

- `supabase/migrations/20260926100100_home_location_from_postcode.sql` ·
  `supabase/tests/521_home_location_from_postcode.sql`
- `apps/staff/lib/postcodes.ts` (+ `__tests__/postcodes.test.ts`) ·
  `apps/staff/app/profile/actions.ts` · `apps/staff/app/profile/details/DetailsForm.tsx` ·
  `apps/staff/app/onboarding/actions.ts` (delegation only)
