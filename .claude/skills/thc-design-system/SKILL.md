---
name: thc-design-system
description: Apply The Hospitality Company design system (deep navy, cyan accent, zero radius, Space Grotesk/Inter/IBM Plex Mono, square avatars, glass mobile chrome) when building or reviewing any screen or component in this repo. Use whenever writing UI, CSS, or wireframes.
---

# THC design system

Source: Scope of Work §1.6 (web) and §10.1 (mobile). Reference implementation: `wireframes/assets/thc.css`; living sheet `wireframes/design-system.html`; React port `packages/ui`.

## Tokens
`--bg #04080F` · `--panel #0B1220` · `--line #1C2839` · `--cyan #3EDCEC` (primary) · `--purple #A879FF` (Auto-Assign ONLY) · `--green #3DDC97` · `--amber #F5B83D` · `--coral #FF6E61` (danger) · `--text #E9EEF5` · `--muted #8A97A3`.
Fonts: Space Grotesk (headings) · Inter (body) · IBM Plex Mono (labels: uppercase, 0.1em tracking, 10.5px).

## Rules
1. `border-radius: 0` on everything. Only `.logo.round` is circular.
2. Square avatars; selfie photo; initials fallback.
3. Sidebar active: 3px cyan left bar + `rgba(62,220,236,.10)` fill + cyan text.
4. Buttons: hover lift + sheen; primary = cyan bg, navy text; purple = auto-assign; danger = coral outline (solid for destructive confirm).
5. Pills are square, mono, uppercase; tone vocabulary in `docs/07-design-system.md`.
6. Mobile: glass (`backdrop-filter: blur(18px)`) on top bar / bottom nav / sheets; radial cyan (top-left) + purple (bottom-right) glow; collapsing header keeps the logo left and avatar right; bottom nav Documents · Shifts · Invites · Radar.
7. Dual-zone times: first line "17:00 – 23:30 UK time", second "19:00 – 01:30 your time" only when zones differ; the narrow "Due" pill shows local time only.
8. Money display: `£14.00/h` base; holiday `+12.07%` always a separate labelled figure; client-facing screens show no money.
9. Buffer: `12 (+2)`. Fill pill: `9 of 12` amber while short, green when full.

## Checklist before finishing a screen
- Compare against its wireframe in `docs/08-screen-inventory.md` state by state.
- Responsive at 390px (phone) and 1024px (tablet) for Back Office and Client Portal.
- Focus ring visible (cyan), contrast ≥ 4.5:1, touch targets ≥ 44px on mobile.
