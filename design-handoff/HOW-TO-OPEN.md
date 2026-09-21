# Opening the design boards

The four `.dc.html` files are React apps. They originally pulled React and Babel from a
CDN at runtime, which fails on any machine without open internet, and they cannot run
from `file://` because the browser refuses to load their scripts across that origin.

Both problems are fixed here: the bundles are vendored under `vendor/` and `support.js`
points at them. You still need to serve the folder over HTTP rather than double-clicking
the file.

```
pnpm design            # serves this folder at http://127.0.0.1:8099
```

Then open one of:

| File | Theme |
|---|---|
| `THC Platform Screens.dc.html` | v1 dark, the scope §1.6 system: square, mono labels |
| `THC Platform Screens Light.dc.html` | v1 light, warm ground, same square geometry |
| `THC Platform Screens v2.dc.html` | v2 dark, softened: rounded, sentence-case, gradient primaries |
| `THC Platform Screens v2 Light.dc.html` | v2 light, softened on the warm ground |

Eleven screens per board, each tagged with `data-screen-label`: five Back Office, five
Staff App, one Client Portal.

`README.md` in this folder is the designer's handoff note and carries the token tables.
Two things in it do not apply to this repo. It describes a Django, React and Flutter
stack, which ADR-0001 and ADR-0002 replaced with Supabase, Next.js and a PWA. The visual
specification stands; the stack notes do not.
