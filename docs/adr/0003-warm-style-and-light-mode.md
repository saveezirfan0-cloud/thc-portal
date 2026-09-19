# ADR-0003 · "Warm" visual style and light mode

**Status:** Proposed (product owner request, 19.09.2026) — needs THC sign-off because §1.6 is marked STRICT.

## Context
The scope fixes a deep-navy, cyan, zero-radius, mono-labelled system. Reviewing the wireframes, the product owner found it reads as "techy" for an 18–30 hospitality workforce and asked for dark and light modes and a current, friendlier feel.

## Decision (proposed)
- Keep the ten brand colour tokens and every layout, component and rule unchanged.
- Add a `style` axis: `scope` = §1.6 literal; `warm` = rounded corners, Plus Jakarta Sans, body-face labels, larger tap targets, rounded active nav. Default `warm`.
- Add a `theme` axis: `dark` (scope palette) and `light` (warm off-white ground, navy ink, deeper "ink" tones for text on white). Default follows the device setting; the user can override in the app.
- Both axes are CSS custom properties on the root element (`data-style`, `data-theme`); `packages/ui` implements exactly what `wireframes/assets/thc.css` does.

## Consequences
- §1.6 wording ("zero border-radius", "IBM Plex Mono labels", "deep navy background") is superseded for the default look if THC accepts; the scope rendering remains reproducible for the approved design pack.
- Contrast: light mode introduces ink variants (`--cyan-ink` etc.) because the brand cyan does not pass 4.5:1 on white.
- No functional change; no change to notification copy, rules or screens.
