# ADR-0007 · One rounded look in two grounds; the switch is a theme switch

**Status:** Accepted (product owner, 21.09.2026). Settles the *pairing* left open by ADR-0003. Everything else in ADR-0003 — the two axes, the ten brand colours, the contrast work — stands.

## Context

The product owner supplied boards in three batches:

1. Seven boards: three labelled "Warm Light Mode" (zero radius, Space Grotesk, IBM Plex Mono caps, cream) and four "Modern 2026 Fluid" (round, Plus Jakarta Sans, glass and glow, navy).
2. Four boards, captioned **"this is warm design direction"**: cream ground, rounded cards, soft shadows, teal and violet gradient actions.
3. The same four screens again, captioned **"this is dark mode"**: navy ground, identical layout and geometry, glow in place of the shadow.

Batches 2 and 3 are decisive, because they are *the same four screens* rendered twice. They settle what one earlier reading of batch 1 got wrong — that the zero-radius "Warm Light" boards described the light mode. They did not. **Every board the owner has called a direction is the same rounded, gradient-accented language; only the ground changes.**

All of it is drawn as restaurant-reservation screens (tables, covers, sommelier notes). That is not this product, and no screen is adoptable. The visual language is.

## Decision

1. **The switch is a theme switch.** `styleForMode` returns `warm` for both modes. Light is cream, dark is navy; the geometry, type and radius scale are identical in both. This is one function, as ADR-0003 promised.

2. **`scope` stays reachable but unpaired.** The Scope of Work marks §1.6 STRICT, so the literal rendering has to stay reproducible for the approved design pack. It is now set by hand on `data-style`, not by the switch.

3. **Depth follows the ground.** A shadow is invisible on navy and a glow is invisible on cream, so each ground gets the one that works:
   - light → `--shadow-card`, two layers, and **warm** (`rgba(36,29,22,…)`) rather than black, because a neutral cast on cream reads as grey dirt;
   - dark → `--glow-soft` and `--glow-dot`, accent-tinted.
   Both tokens are `none` on the other ground, which is what keeps the rules in `warm.css` inert rather than needing a second selector. "No *drop* shadows" survives as the thing it always meant: no neutral cast.

4. **Auto-assign gets the violet gradient.** The boards give that one action its own colour next to the teal primary, and this design system already reserves purple for Auto-Assign. So the tone is the trigger — `<Button tone="purple">` already renders every Auto-Assign action, and no screen changes.

5. **The grounds come from the spec, the foreground tones do not.** The implementation guide's "Luminous Midnight" and "Editorial Linen" grounds are adopted verbatim — dark `#0A0E18` / `#0F131D` / `#171B26` / `#1E2333`, light `#FAF7F4` / `#FFFFFF` / `#F5F1EB` / `#EBE4DA`. Its *foreground* palette is not, because it fails AA against its own page: cyan 3.45:1, emerald 2.38:1, amber 2.01:1, coral 3.44:1, muted 4.46:1. Our ink tones measure 4.5:1 or better on all three grounds in both themes — 42 pairs, asserted by `contrast.test.ts` rather than trusted.

6. **The light accent is `#0E7688`**, the boards' `primary`. An improvement, not a cost: the old `#0B7A88` sat exactly on 4.50:1 against the warm ground, which any antialiasing lost; `#0E7688` measures 4.96:1.

## What was not adopted, and why

- **Tailwind.** The boards run the Tailwind CDN. This repo's design system is plain CSS tokens (CLAUDE.md, `docs/07-design-system.md`), and that is the entire reason each of these revisions costs tens of lines instead of a rewrite.
- **The screens themselves.** Reservations grids, floor plans, covers, dietary flags and sommelier notes belong to a restaurant booking product. This one schedules event staff. Nothing in `docs/08-screen-inventory.md` moves.
- **The three zero-radius "Warm Light" boards** from batch 1, superseded by batch 2.
- **`#0891B2`**, which appears in the boards' inline classes beside their own declared `#0E7688`. It measures 3.45:1 on the warm ground and fails AA for text.

## Consequences

- The appearance control is now just Light / Dark. It no longer names a style, because it no longer picks one.
- `docs/09-visual-direction.md`'s argument for rounded corners for an 18–30 workforce is back in force rather than overruled — it now describes both modes.
- One earlier revision of this ADR inverted the pairing instead. That reading is recorded here rather than erased, because the boards that supported it are still in the repository and someone will find them.
- No functional change. No screen file changed. No notification copy, rule or migration is touched.
