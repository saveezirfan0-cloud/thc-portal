# 09 · Visual direction — "Warm" style and light mode

**Status:** proposed to THC (ADR-0003, pairing inverted by [ADR-0007](adr/0007-fluid-pairing.md)). **Decision taken by the product owner (21.09.2026): one switch — Light mode is the Scope §1.6 look on the warm ground, Dark mode is the Fluid look.** The table below still describes what each *style* does; read "Warm style" as the style that now renders in dark mode, grown to the Fluid radius scale and given an accent glow. The switch follows the device setting by default and the worker/admin can override it. The Scope of Work §1.6 marks the visual system as STRICT, so this is a recorded change request, not a silent drift. Both looks ship from the same tokens; the switch in the wireframes' top bar shows either at any time (`Warm` / `Scope §1.6`, `Dark` / `Light`).

## Who this is for
| Audience | Situation | What the UI has to feel like |
|---|---|---|
| Workers, 18–30, zero-hours (§1.1) | On a phone, often on the way to a venue or between lectures; reading a push notification; deciding in seconds whether to accept a shift; checking in at a service entrance | Familiar, friendly, fast. Same visual grammar as the apps they already use daily (rounded cards, bold clear type, big single-tap actions, plain words). Money and time are the two things they look for first. |
| Office team (small, under time pressure, 10–15 events a day) | Desktop and tablet, many tabs, live monitor open all day, phone calls in between | Scannable, calm, information-dense without noise. Status must read at a glance by colour and word, not by decoding codes. |
| Client contacts (hotel, venue and events managers) | Occasional visits, phone or laptop, want to see who is coming and download a sheet | Polished, hospitality-grade, nothing technical. |

## What "techy" was doing, and what changes

| Element | Scope §1.6 (kept as "Scope" style) | Warm style (proposed default) | Why |
|---|---|---|---|
| Corners | Zero radius everywhere | 6–18 px radii; pills fully rounded; phone frame 40 px | Square corners read as terminal / dashboard software. Rounded surfaces are the visual norm for the 18–30 audience and for hospitality brands. |
| Labels, table headers, pills | IBM Plex Mono, uppercase, wide tracking | Plus Jakarta Sans bold, uppercase, tighter tracking | Mono everywhere is the single strongest "engineering tool" cue. Mono stays only for codes (share code, Employee ID). |
| Type family | Space Grotesk + Inter | Plus Jakarta Sans throughout (bold headings, regular body) | One warm geometric family with clear weight contrast; friendly counters, wide apertures, excellent at small sizes on phones. |
| Times and money | Mono | Body face with tabular numerals | Aligns in columns without the terminal look. |
| Sidebar active state | Cyan left bar + fill | Rounded cyan fill (bar removed) | Same signal, softer form. Scope style keeps the bar. |
| Avatars | Square | Square with 10 px radius | Still recognisably "square" (not circles), but not a passport photo. |
| Buttons | 36 px, mono-flavoured | 40–48 px, bold label, rounded | Thumb-sized targets for check-in, Accept, I'm ready. |
| Palette | Navy, cyan, purple, green, amber, coral | **Unchanged.** Same ten tokens. | The brand is fixed; the surface around it changes. |
| Dark only | Navy always | Dark and light, following the phone/OS setting by default | Workers use both; light mode is expected on iOS/Android and reads better outdoors at a venue entrance. |

## Light mode rules
- Ground is warm off-white (`#F6F4EF`), panels white, lines `#E3DED4`, ink is deep navy (`#141A2C`). This keeps the brand's navy present as ink rather than as a wall.
- Cyan `#3EDCEC` stays for fills (primary buttons, active fills, glows). For text and borders on white it fails contrast, so a deeper teal `#0B8A99` ("cyan-ink") is used. Every tone has a fill and an ink pair: green/amber/coral/purple likewise.
- Glass surfaces (mobile top bar, bottom nav, sheets) become translucent white; the cyan/purple glow under the glass stays, slightly stronger.
- Nothing is hard-coded in pages: every component reads tokens, so a screen looks right in all four combinations without per-screen work. `packages/ui` will carry the same tokens.

## Tone of voice (applies to both styles)
- Speak to the worker, not about the system: "I'm ready for tomorrow", "Check in — verify GPS", "You're booked!". The §8 push copy already does this and is kept verbatim.
- Lead with the two things a worker checks: time window and £/h (base rate only).
- One primary action per card; everything else secondary or ghost.
- Office screens keep the § annotations in the wireframes only; the product carries the rule in the label ("Confirm by 12:00 today").

## Decision needed from THC
1. Adopt Warm as the default (recommended) with Scope available as the literal §1.6 rendering, or keep Scope only.
2. Approve light mode (recommended, both apps) — it changes nothing in the rules, only the surface.
3. Confirm the logo asset (B4) works on both grounds; the cyan box does.
