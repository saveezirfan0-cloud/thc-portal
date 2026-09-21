import type { MetadataRoute } from 'next';

/**
 * PWA manifest (ADR-0001). Installability is what unlocks Web Push on iOS
 * 16.4+, so this has to stay valid and served over HTTPS (§10.5).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Hospitality Company — Staff',
    short_name: 'THC Staff',
    description: 'Shifts, invites and check-in for THC staff',
    start_url: '/shifts',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F6F4EF',
    theme_color: '#04080F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
