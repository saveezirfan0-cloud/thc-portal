# ADR-0121 · Plus Jakarta Sans headings and circular avatars in the product; control edges at 3:1

**Status:** Accepted · Amends `docs/07-design-system.md` (non-negotiable 2) and `docs/09-visual-direction.md` (Type family, Avatars) · Builds on ADR-0003, ADR-0007 · **Instruction of the product owner, 12.10.2026**

## Context

Two things the written contract said had drifted from what the product renders, and the product owner was asked to settle both:

1. **Heading face.** `docs/09` says the warm style is "Plus Jakarta Sans throughout", but `packages/ui` tokens.css set the warm `--font-head` to **Outfit** — the handoff v2 heading face — so every heading in all three apps was Outfit over Plus Jakarta Sans body. The wireframes (`wireframes/assets/thc.css`) already used Plus Jakarta Sans for headings, so the wireframes and the product disagreed.
2. **Avatar shape.** `docs/07` non-negotiable 2 says "Square avatars" and `docs/09` proposed "Square with 10 px radius". The product has rendered circles (`--r-avatar: 50%`) since ADR-0007, because every ADR-0007 board draws a face in a circle.

A design review of the Client Portal in the same pass found control edges failing WCAG 1.4.11 (non-text contrast, 3:1): the `.input`, select and default `.btn` borders used `--line`, a divider at about 1.26:1 on white, and a removed worker's dashed avatar slot sat near 1.2:1 in both themes. Native widgets (a select's popup, scrollbars, date pickers) also ignored the theme, because no `color-scheme` was set.

## Decision

1. **Headings are Plus Jakarta Sans in all three apps.** The warm `--font-head` is `'Plus Jakarta Sans', system-ui, sans-serif` — one family for headings and body, bold for headings. Outfit is no longer shipped: its `@font-face` rules and woff2 subsets are removed from `packages/ui`, so nothing can start using it again by accident. All three apps already load the face through `@thc/ui/styles.css` (self-hosted, `fonts.css`), so no app layout changes. The **scope** style keeps Space Grotesk / Inter / IBM Plex Mono: §1.6's literal rendering is untouched.
2. **Worker avatars stay circles** in the product (`--r-avatar: 50%`, warm, both modes). Scope keeps `--r-avatar: 0`. The docs, the design-system skill and the wireframe stylesheet now say so; the "square with 10 px radius" proposal is withdrawn.
3. **`--control-line`**, a new token for the edge of something you type into or press: inputs, selects, textareas, the input-row addon, the default button, and the dashed slot of a removed worker. It clears 3:1 against `--bg`, `--panel` and `--panel-2` in every theme — scope dark `#5D6B7E`, light `#958676`, warm dark `#64708A` — and no more than that, so it stays quiet. `--line` remains the divider. `contrast.test.ts` holds the floor.
4. **`color-scheme`** is `dark` on `:root` and `light` on `[data-theme='light']`, in tokens.css and in the wireframe sheet.

## Consequences

- Every heading in the Back Office, Staff App and Client Portal changes face; sizes, weights and tracking are unchanged. Plus Jakarta Sans at 700 is slightly wider than Outfit, so a tight heading may wrap a few pixels earlier — no layout test moved.
- Inputs and default buttons have a visibly firmer edge on cream, still a warm grey rather than ink. Tone buttons, ghost buttons and links are unaffected (they set their own border).
- `docs/07` non-negotiable 2 reads "Circular avatars in the product; square only in scope". The scope style is still reproducible for the approved design pack.
- No rule, copy, migration or data change.
