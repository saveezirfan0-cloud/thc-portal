# ADR-0005 · /apply's dialling-code picker is a native `<select>`

**Status:** Accepted for v1 — revisit when `packages/ui` has a combobox

## Context

§2.1 asks for an "international picker" on the public application form, and `wireframes/public/apply.html` draws it as a 118px control reading **`🇬🇧 +44`**, with the list showing nine countries and then "… all countries". So the wireframe wants two different labels for the same option: a short one in the collapsed control, a fuller one in the open list.

A native `<select>` cannot do that. The collapsed control renders the selected `<option>`'s own text, and the `label` attribute overrides it in both places at once. The only ways out are a JavaScript combobox — which `packages/ui` does not have, and which this session was told not to add there — or a single label used in both places.

With one label there are two honest choices, and both lose something:

1. **`🇬🇧 +44`** — matches the wireframe's collapsed state exactly. But a list of ~210 entries that carry only a flag and a code is not usable: several flags are hard to tell apart at a glance, +1 and +44 each cover a handful of territories, and the browser's type-ahead matches option text, so typing "France" finds nothing.
2. **`+44 🇬🇧 United Kingdom`** — usable list (type-ahead by name, unambiguous rows), but too long for a 118px control.

## Decision

Option 2, with the **dialling code first**, and the picker widened to 168px at 12px type (`apply.css`, `.apply-dial`).

Putting `+44` before the flag and the name means the one piece of information the field exists to carry is the part that survives being clipped: the default reads `+44 🇬🇧 United…` rather than `🇬🇧 United Kingdo…`. `text-overflow: ellipsis` makes the clip look deliberate instead of broken.

Two smaller decisions ride along:

- The list is two `<optgroup>`s — "Common" (the nine the wireframe names, UK first) and "All countries" (everything else, alphabetical by country name). The groups are **disjoint**: a `<select>` with the same value twice renders the *last* match when collapsed, so a United Kingdom in both groups would silently display the wrong row.
- The option's value is the ISO 3166-1 alpha-2 code, not the dialling code, because +44 belongs to four territories and +1 to more than twenty. Flags are derived from the ISO code rather than typed.

## Consequences

The collapsed control is not pixel-identical to the wireframe, and the picker is 168px rather than 118px, which takes width from the number field beside it. At 390px the number field still comfortably fits a UK mobile.

**Follow-up for `design-system`:** a `CountrySelect` combobox in `packages/ui` — a short trigger label, a searchable list, keyboard navigation. When it lands, /apply adopts it and this ADR is superseded; nothing outside `apps/staff/app/apply` has to change.
