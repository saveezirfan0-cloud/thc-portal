# SYNTHETIC fixtures — not captured from gov.uk or any provider

gov.uk and the right-to-work providers were unreachable when the automated
check was built (ADR-0025). Every file here is INVENTED to match the
assumptions in `../../govuk.config.ts` and `../../provider.config.ts`; none is
a copy of a real page or a real API response, and every name, code and
reference in them is made up.

When THC's provider is chosen and a consenting worker's check has been run
once by hand, replace these with redacted real captures (names and codes
changed) and adjust the two config files until the tests pass again.

`govuk-pass-visa-live-wording.txt` is the exception in part: its condition lines,
the lead-in and gov.uk's advice to the employer are copied word for word from the
first live check (28.09.2026). The name, date and reference are invented, and the
page layout around them is still assumed.
