# ADR-0085 · 24-hour clock by default, 12-hour on request

**Status:** Accepted (owner request, 05.10.2026: "can the clock be updated to 24 hour clock and not 12 hour clock — make this default, and for users/staff give them an option in settings to change preference"). An addition to scope v1.6; §1.8's time-zone rules are unchanged.

## Context

Every time the platform *wrote* was already on a 24-hour clock (`hour12: false` / `hourCycle: 'h23'`, "17:00 – 23:30"). The 12-hour clock came from the time *fields*: the Shift Builder, the role sections and the worker's availability sheet used the browser's `<input type="time">`, which a browser draws on the **device's** clock. On a 12-hour phone or laptop a manager typed and read "5:00 PM" and a worker added an availability window in AM/PM. No attribute on the element changes that.

## Decision

**24-hour is the default for every login.** `DEFAULT_TIME_FORMAT = '24h'` in `packages/domain/src/time.ts`; `profiles.time_format` defaults to `'24h'`.

**Each person can switch their own view to 12-hour.** Staff App: Profile → Preferences → Time format. Back Office: My profile (`/account`) → Time format. Any signed-in role may set its own; it is a display preference, not operational data, so a viewer may too, and it is not audited.

**It changes how a time is written and how a typed time is read, and nothing else.** Stored values stay `timestamptz`; every rule still runs on Europe/London instants; §1.8 holds in both clocks ("6:00 pm (UK)" with a "7:00 pm your time" line). `formatTimeIn`, `formatDateTimeIn` and `displayTime` take an optional `format`; `clockLabel("17:00", '12h')` is "5:00 pm", built by hand, not by Intl, so the server and every browser print the same characters (ICU's narrow no-break space before "pm" would be a hydration mismatch).

**A platform time field replaces the browser's.** `TimeField` (`@thc/ui`) is a text field with a forgiving reader, `parseClock`: "17:00", "1700", "17.00", "5pm", "5:30 pm" and "12am" all land as `HH:MM`. Its value is always `HH:MM`, in both clocks, so `ukInstant`, `ukRoleWindow` and every server action are untouched. A number with no am/pm is read on the 24-hour clock in either mode ("17:00" is unambiguous; a 12-hour person who types "5" sees "5:00 am" on blur, before anything is saved). "24:00" is refused: a role that ends at midnight ends at "00:00" and rolls into the next day as before.

**Where the choice lives.** `profiles.time_format` is the record, read and written through `my_time_format()` / `set_my_time_format()` (any signed-in role, own row only; the client role holds no table policy, ADR-0026, so neither goes through the table). The cookie `thc-time-format` is a per-device cache of it that server components read for free, the same split as "keep me signed in" (ADR-0032). When the cookie is missing and there is a session (a new device), the server reads the profile and `TimeFormatProvider` writes the cookie once. Sign-out clears the cookie, so the next person on a shared phone reads their own profile. The Staff App reads it in `StaffShell`, not the root layout, so its static pages stay static for the PWA.

## What stays 24-hour

Everything that is a document or leaves the screen: CSV exports, the PDFs (allocation sheet, timesheet, badges), email and push copy (§8), the daily event-documents job, calendar (.ics) files. They are shared artefacts or sent before anyone has chosen a view of them. The Client Portal is not in this change: it keeps the 24-hour default and has no setting.

## Consequences

- Nobody sees AM/PM unless they asked for it, whatever their device's clock.
- A 12-hour person typing "5" gets 05:00; the field rewrites it as "5:00 am" on blur.
- `supabase/tests/772_time_format.sql` holds the default, own-row-only, the accepted values and the grants.
