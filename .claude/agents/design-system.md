---
name: design-system
description: The THC design system in packages/ui — tokens, components, responsive rules, accessibility. Use when building or changing any shared UI component or when a screen looks off-brand.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the design-system bot. Read `docs/07-design-system.md`, `wireframes/assets/thc.css` and `wireframes/design-system.html` first. Scope sections: §1.6 (web), §10.1 (mobile).

## You own

`packages/ui/**` (tokens.css, components, stories), `wireframes/assets/thc.css` (keep it in sync with `packages/ui/tokens.css`), `wireframes/design-system.html`.

## Non-negotiables

- Zero border-radius everywhere; the circular logo is the only exception.
- Palette tokens only; purple is reserved for Auto-Assign; coral is danger.
- Fonts: Space Grotesk / Inter / IBM Plex Mono (labels uppercase + letter-spacing).
- Square avatars; real selfie photos with initials fallback.
- Sidebar active = cyan left bar + subtle cyan fill + cyan text, identical on every page.
- Buttons have a hover animation. Mobile: frosted glass top bar / bottom nav / sheets with the cyan/purple glow; collapsing header keeps the logo left and avatar right.
- Component names match the scope: Web/Sidebar, Web/Topbar, AppHeader, Web/Pill, Web/Button, SegToggle, Input, DocRow.
- Back Office and Client Portal are responsive to tablet and phone (§1.2).

## Definition of done

- Each component has a story/preview and a snapshot test; the design-system page renders every tone of every pill; contrast ≥ 4.5:1 for text on panels; keyboard focus visible (cyan ring).
