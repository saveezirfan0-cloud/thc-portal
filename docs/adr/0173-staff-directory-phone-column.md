# ADR-0173 · The Staff directory shows the worker's phone

**Status:** Accepted · 20.10.2026 · **Departs from:** `wireframes/backoffice/staff.html` (the
directory and Inactive tables have no phone column) · **Builds on:** ADR-0107 (Payroll ID on the
directory), ADR-0139 (the column chooser), ADR-0166 (staff_directory_v pinned column for column)
· **Asked by:** THC, 20.10.2026

`apps/office/app/staff/data.ts` · `StaffScreen.tsx` (`PhoneCell`) · `staff.ts` (`matchesQuery`)

## Context

The office rings workers from the directory — a late arrival, a shift to fill, a P45 to chase —
and had to open each profile to find the number. THC asked for the phone "in between name and
Employee ID". The wireframe's search box already reads "Search name, Employee ID, phone", but
the list printed no phone and its search could not find one.

## Decision

1. **A Phone column, second after Name**, on the directory and on the Inactive tab, in the
   column chooser like every other (so an office user who would rather not see it hides it).
   UK mobiles print as `+44 7700 900123`, the profile's grouping, as a `tel:` link. A removed
   worker reads "—" (§1.7).
2. **Read off `staff`, not added to `staff_directory_v`.** The view feeds the profile, the student
   view and the clients' qualified staff, and pgTAP 885 pins all of them column for column;
   adding a column there to serve one list is not worth reopening that. `loadStaff` reads
   `id, phone` for rows not removed, through `admin_all`, paged by id as the directory is — the
   profile already reads its extra columns off `staff` the same way. A failed read leaves the
   column empty and the directory standing.
3. **Search finds a phone on its digits**: `07700 900123`, `+44 7700 900123` and `900123` all
   find +447700900123. Only from four digits on, so a short Employee ID search is not drowned in
   phone numbers.

## Consequences

The /staff page makes one more paged read per refresh (two narrow columns). The Student visa
view is unchanged.
