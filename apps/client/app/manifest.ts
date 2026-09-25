import type { MetadataRoute } from 'next';

/**
 * Web app manifest (ADR-0037): what lets a client add the portal to a
 * phone's home screen and open it without browser chrome.
 *
 * Deliberately no service worker beside it. The portal shows worker names
 * and photos, and nothing of that may outlive the session on a shared
 * device; Chrome's install criteria no longer ask for one (ADR-0037 §2).
 *
 * The middleware matcher already lets `/manifest.webmanifest` and every
 * `.png` through without a session, so the browser can read both before
 * sign-in. `start_url` is the event list; signed out, the middleware sends
 * it to /login like any other visit.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/client',
    name: 'THC Client Portal',
    short_name: 'THC Clients',
    description: 'Your events with The Hospitality Company',
    start_url: '/client',
    scope: '/',
    display: 'standalone',
    // The splash ground is the light ground the portal ships (`--bg` on the
    // light axis in packages/ui tokens.css), as the Staff App's is. A
    // manifest carries one literal, so it cannot follow the dark mode.
    background_color: '#FAF7F4',
    // The navy ground the portal actually renders in dark mode: `--bg` on
    // `[data-style='warm'][data-theme='dark']`, the style both modes use
    // (ADR-0007). Paired with the dark entry of `viewport.themeColor` in
    // app/layout.tsx; the manifest test holds all three together.
    theme_color: '#0A0E18',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
