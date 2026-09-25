import { envText } from './checker';
import type { EnvReader } from './checker';
import type { GovukBrowser, GovukLauncher } from './govuk';

/**
 * The real browser for the gov.uk fallback (ADR-0025).
 *
 * On Vercel there is no Chrome, so @sparticuz/chromium unpacks a serverless
 * build into /tmp on first use and playwright-core drives it. Locally,
 * RTW_CHROMIUM_EXECUTABLE_PATH points at any installed Chrome or Chromium
 * instead. Both packages are imported only here, only when a check runs,
 * and are listed in next.config.ts `serverExternalPackages` so Next does
 * not try to bundle a browser.
 *
 * ASSUMED — confirm on the first deploy: that the playwright-core and
 * @sparticuz/chromium versions in package.json work together on Vercel's
 * Node runtime, and that `outputFileTracingIncludes` in next.config.ts
 * ships @sparticuz/chromium's `bin/` with the route.
 */
export function chromiumLauncher(env: EnvReader): GovukLauncher {
  return async () => {
    const { chromium } = await import('playwright-core');
    const local = envText(env, 'RTW_CHROMIUM_EXECUTABLE_PATH');
    let executablePath = local;
    let args: string[] = [];
    if (!executablePath) {
      const serverless = (await import('@sparticuz/chromium')).default;
      executablePath = await serverless.executablePath();
      args = serverless.args;
    }
    const browser = await chromium.launch({ executablePath, args, headless: true });
    const context = await browser.newContext({
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
    const wrapped: GovukBrowser = {
      newPage: async () =>
        (await context.newPage()) as unknown as Awaited<ReturnType<GovukBrowser['newPage']>>,
      close: async () => {
        await context.close().catch(() => undefined);
        await browser.close();
      },
    };
    return wrapped;
  };
}
