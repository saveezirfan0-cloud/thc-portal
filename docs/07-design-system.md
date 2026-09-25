# 07 · Design system (§1.6 web · §10.1 mobile)

> Two runtime axes exist since ADR-0003: **style** (`warm` proposed default · `scope` = §1.6 literal) and **theme** (`dark` · `light`). The rules below describe the Scope style; `docs/09-visual-direction.md` lists exactly what Warm and Light change. Everything is tokens; components never hard-code a colour or radius.

Implemented as CSS custom properties and component classes in `wireframes/assets/thc.css`; `packages/ui` ports the same names to React. `wireframes/design-system.html` is the living reference sheet.

## Tokens
| Token | Value | Use |
|---|---|---|
| `--bg` | `#04080F` | page background (deep navy) |
| `--panel` | `#0B1220` | cards, sidebar, topbar |
| `--line` | `#1C2839` | borders, dividers, table rules |
| `--cyan` | `#3EDCEC` | primary actions, active nav, links, logo box |
| `--purple` | `#A879FF` | **Auto-Assign only** (switch, score, invites from auto) |
| `--green` | `#3DDC97` | confirmed / on shift / verified / margin |
| `--amber` | `#F5B83D` | needs action, due, expiring, forecast |
| `--coral` | `#FF6E61` | danger, violations, blocked, rejected, alerts |
| `--text` | `#E9EEF5` | body text |
| `--muted` | `#8A97A3` | secondary text, labels |

Fonts: **Space Grotesk** headings · **Inter** body · **IBM Plex Mono** labels (uppercase, 0.1em letter-spacing) — `.label`, `.pill`, table headers, KPI captions, times.

## Non-negotiables
1. **Zero border-radius** on everything; the circular logo is the only exception (`.logo.round`).
2. **Square avatars**, real selfies; initials fallback.
3. Sidebar active: 3px cyan left bar + `--cyan-dim` fill + cyan text.
4. Buttons animate on hover (lift + sheen); primary = cyan on navy text.
5. Mobile chrome: frosted glass (`backdrop-filter: blur(18px)`) on top bar, bottom nav and sheets, cyan/purple radial glow under the glass, collapsing header (logo left, avatar right stay).
6. One name + one logo everywhere: "The Hospitality Company".

## Component inventory (name → class → React component)
Web/Sidebar `.sidebar` → `<Sidebar>` · Web/Topbar `.topbar` → `<Topbar>` · Web/Pill `.pill` → `<Pill tone>` · Web/Button `.btn` → `<Button variant>` · SegToggle `.seg` → `<SegToggle>` · Input `.input/.field` → `<Field>` · DocRow `.docrow` → `<DocRow status>` · AppHeader `.app-header` → `<AppHeader collapsed>` · BottomNav `.bottom-nav` → `<BottomNav locked>` · Sheet `.sheet` → `<Sheet>` · Stepper `.stepper` → `<Stepper>` · Kanban `.kanban/.kcol/.kcard` → `<Kanban>` · KPI `.kpi` → `<Kpi>` · Table `.tbl` → `<DataTable>` · Modal `.modal` → `<Modal>` · Toast `.toast` → `<Toast>` · Score `.score` → `<MatchScore>` · Calendar `.cal/.evchip` → `<MonthGrid>` · Map `.map` → Mapbox wrapper.

## Status pill vocabulary (use exactly these tones)
- Event: Upcoming `cyan` · Ongoing `green` · Completed neutral · Cancelled neutral (greyed row).
- Booking: Invited neutral · Confirmed `green` · Needs confirmation `amber` · Time changed `amber` + Awaiting neutral · No show `coral` · Applied `purple`.
- Monitor: On shift `green` · Off-site `amber` · Checked out neutral (or `coral` if > 15 min late) · No check-out `coral` · Due `amber` · Not confirmed today `amber` · Not checked in — 30 min alert `coral`.
- Documents: Missing neutral · In review `amber` · Verified `green` · Rejected/Re-upload `coral` · Expiring `amber` · Expired `coral` · Superseded neutral.
- Rating colour: < 3.0 `coral` · 3.0–3.9 `amber` · ≥ 4.0 `green`.

## Responsive
Back Office: below 760px the sidebar gives way to a bottom tab bar (Dashboard · Scheduling · Compliance · Check-in · More) whose More sheet holds the rest of the menu, sign-out and the appearance switch; grids stack; list tables marked `.card-rows` become cards and every other table scrolls inside its card (ADR-0030). From 1024px down the top bar wraps and tables in panels scroll. Client Portal swaps its table for cards under 820px. Staff app is designed at 390×844 and scales up to tablet as a centred column.
