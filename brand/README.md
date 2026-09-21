# Brand assets

Drop the source files here and tell Claude. It generates every size and wires them into
the three apps and `packages/ui`.

## What to put here

| File | Notes |
|---|---|
| `logo.svg` | Preferred. Vector scales to every size without going fuzzy. |
| `logo.png` | Only if there is no SVG. At least 1024 by 1024, transparent background. |
| `logo-square.svg` or `.png` | Only if the main logo is wide. App icons are square and end up around 20 pixels in a browser tab, so a wide logo becomes unreadable. |
| `colours.md` or a brand guide | Any colour references you want honoured against `docs/09-visual-direction.md`. |

## What gets generated from them

- `apps/staff/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — named in
  the web app manifest already. Until these exist the staff app cannot be installed to a
  home screen, which is also what gates push notifications on iOS.
- `favicon.ico` and `apple-icon.png` for all three apps.
- The brand mark in `packages/ui`, replacing the placeholder that currently renders the
  letters "THC" in a box on the sign-in card and the sidebar.

The maskable icon needs roughly 20% clear space around the mark, because Android crops it
to whatever shape the phone uses. That padding is added during generation, so supply the
logo without it.

## Why here rather than straight into `public/`

Several of the generated files have exact names the code already expects, and the
maskable one has padding rules. Keeping the sources in one place means the icons can be
regenerated when the brand changes, instead of being hand-replaced in five folders.
