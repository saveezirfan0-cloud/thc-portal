# ADR-0007 · Invert the ADR-0003 pairing, and grow the warm style into "Fluid"

**Status:** Accepted (product owner, 21.09.2026). Supersedes the *pairing* in ADR-0003. Everything else in ADR-0003 — the two axes, the ten brand colours, the contrast work — stands.

## Context

The product owner supplied seven new boards: three labelled "Warm Light Mode" and four labelled "Modern 2026 Fluid". They are drawn as restaurant-reservation screens (tables, covers, sommelier notes), which is not this product; the screens themselves are not adoptable. The *visual language* in them is, and reading it against our tokens turned out to be unusually clean:

- The **"Warm Light" boards** are zero radius, Space Grotesk headlines and IBM Plex Mono uppercase labels, on a cream ground. That is our `scope` geometry on `light`.
- The **"Fluid" boards** are round (1–2.5 rem, `rounded-full` on every control), Plus Jakarta Sans, frosted glass and accent glow, on navy. That is our `warm` geometry on `dark`, with a bigger radius scale and one new effect.

Their dark palette is our dark palette to the hex — `#3EDCEC`, `#DFE2F1`, `#0F131D` all appear verbatim — so nothing about the colour system is being asked to move.

In other words the request is not a new design system. It is **the existing two axes, paired the other way round**, plus a larger radius scale and a glow.

## Decision

1. **Flip the pairing.** `styleForMode` returns `scope` for light and `warm` for dark. ADR-0003 said the pairing could change "without touching a single screen"; this is that claim being spent. The diff is one function and one line of inline head script.

2. **Grow the warm radius scale to the boards' values.** Cards 28, tiles 22, frames 32, and `--r-control` becomes `999px` — on the boards every button, input, nav item and chip is `rounded-full`. Two things cannot take a pill, so they get their own tokens rather than an override buried in a component rule: `--r-field` (20px, textareas) and `--r-check` (8px, checkbox and radio boxes).

3. **Add an accent glow, and keep "no drop shadows".** The boards use `shadow-lg shadow-primary/20` and `shadow-[0_0_8px_…]`. Both are coloured glows, not neutral casts. Two tokens carry them — `--glow-soft` (active nav, primary button) and `--glow-dot` (status dots, in `currentColor` so an amber pill halos amber). Both are `none` in `scope`. The style test no longer bans `box-shadow` outright; it now bans a *neutral* one and requires every shadow to come from a glow token, which is the rule the handoff actually meant.

4. **Adopt `#0E7688` as the light accent**, the boards' `primary`, replacing `#0B7A88`. This is an accessibility improvement rather than a cost: `#0B7A88` sat exactly on 4.50:1 against the warm ground, which any antialiasing lost. `#0E7688` measures 4.96:1.

## What was not adopted, and why

- **Tailwind.** The boards are built on the Tailwind CDN build. This repo's design system is plain CSS tokens in `packages/ui` (CLAUDE.md, `docs/07-design-system.md`), and the whole reason this change is fifty lines rather than a rewrite is that the values live in tokens. Adopting Tailwind would have cost the property that made this cheap.
- **The screens themselves.** Reservations grids, floor plans, covers, dietary flags and sommelier notes belong to a restaurant booking product. This one schedules event staff: events, role sections, bookings, check-in, compliance, payroll. Nothing in `docs/08-screen-inventory.md` moves.
- **`#0891B2`**, which appears in the boards' inline classes alongside their declared `#0E7688`. It measures 3.45:1 on the warm ground and fails AA for text.
- **The boards' `#FAF7F4` / `#FAF7F5` / `#F5F1EB` grounds.** They disagree with each other by a percent or two and with our `#F6F1EA` by less than that. Not worth the churn.

## Consequences

- Light mode is now the denser, flatter look and dark is the softer one — the reverse of what shipped. Anyone who had set a preference keeps their *mode*; the geometry under it changes.
- `docs/09-visual-direction.md`'s audience table now reads backwards in places: it argued rounded corners for the 18–30 worker audience, who are mostly on light mode by default. That argument is not withdrawn, it is overruled by the product owner's preference for the boards. Worth revisiting if worker feedback disagrees.
- No functional change. No screen file changed. No notification copy, rule or migration is touched.
