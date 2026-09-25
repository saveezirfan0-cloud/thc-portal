# ADR-0009 · /apply's dialling-code picker is a native `<select>`

**Status:** Accepted for v1 — revisit when `packages/ui` has a combobox. **Amended** to record what shipped: the code has the wireframe's literal option 1 below, not the option 2 this ADR first chose. The option-2 design is kept as the follow-up.

## Context

§2.1 asks for an "international picker" on the public application form, and `wireframes/public/apply.html` draws it as a 118px control reading **`🇬🇧 +44`**, with the list showing nine countries and then "… all countries". So the wireframe wants two different labels for the same option: a short one in the collapsed control, a fuller one in the open list.

A native `<select>` cannot do that. The collapsed control renders the selected `<option>`'s own text, and the `label` attribute overrides it in both places at once. The only ways out are a JavaScript combobox — which `packages/ui` does not have, and which this session was told not to add there — or a single label used in both places.

With one label there are two honest choices, and both lose something:

1. **`🇬🇧 +44`** — matches the wireframe's collapsed state exactly. But a list of ~210 entries that carry only a flag and a code is not usable: several flags are hard to tell apart at a glance, +1 and +44 each cover a handful of territories, and the browser's type-ahead matches option text, so typing "France" finds nothing.
2. **`+44 🇬🇧 United Kingdom`** — usable list (type-ahead by name, unambiguous rows), but too long for a 118px control.

## Decision

**What shipped is option 1** (`apps/staff/app/apply/ApplyForm.tsx`, `form.ts`): a native `<select>` labelled "Country code" in a 118px slot, one flat list from `DIAL_CODES` — the wireframe's nine countries first in its order, UK default, then the rest alphabetically by country name — each option reading `🇬🇧 +44`, and the option's **value is the dialling code** (`+44`), which is what the form stores and what `submit_application` normalises against the seeded records (§2.12). There are no `<optgroup>`s and no `.apply-dial` rule; the collapsed control is pixel-faithful to the wireframe.

The trade-off accepted with it is the one option 1 was criticised for: type-ahead by country name does not work, and territories sharing a code are indistinguishable in the list. For the London hospitality workforce the form is aimed at, the nine common codes at the top of the list carry almost every applicant, which is why option 1 was kept when the wireframe and the usable list could not both be had.

## Follow-up (the design this ADR first chose, not implemented)

Option 2 with the dialling code first — `+44 🇬🇧 United Kingdom` in a 168px control at 12px type (`.apply-dial`, `text-overflow: ellipsis`), two disjoint `<optgroup>`s ("Common" = the wireframe's nine, UK first; "All countries" = the rest alphabetically), and the option's value as the ISO 3166-1 alpha-2 code rather than the dialling code because +44 belongs to four territories and +1 to more than twenty. If it is adopted, `DIAL_CODES` and the submit path change together, because the stored mobile must still normalise to the same E.164 string. Better still is the `design-system` follow-up: a `CountrySelect` combobox in `packages/ui` — short trigger label, searchable list, keyboard navigation — after which /apply adopts it and this ADR is superseded; nothing outside `apps/staff/app/apply` has to change.

## Consequences

The picker matches the wireframe and the list is the weakest part of the form. The form's unit tests (`apps/staff/app/apply/__tests__/form.test.ts`) assert the shipped values — `+44` as the default `dialCode` and `toE164()` over dialling-code values — so adopting the follow-up means changing them with it.
