import { expect, test } from '@playwright/test';

test('the PWA manifest is served and installable (ADR-0001)', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as {
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  // Installability is what unlocks Web Push on iOS 16.4+ (§10.5).
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/shifts');
  expect(manifest.icons.length).toBeGreaterThan(0);
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
});

test('every icon the manifest names actually exists', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    icons: { src: string }[];
  };
  // These three were referenced for weeks before they existed, which silently
  // made the app uninstallable.
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok(), `${icon.src} should be served`).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
});
