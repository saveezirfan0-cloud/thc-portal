/* eslint-disable no-console -- command-line tool: printing is its output */
// Planning aid: signs the candidate in (activating first if needed), runs the
// steps already written up to --to, then prints where the wizard is.
import { start, go, BASE, mintActivationLink, candidatePassword, CANDIDATE } from './lib.mjs';
import { runStep } from './wizard-steps.mjs';
const to = Number(process.argv[2] || 0); // run steps 1..to (those not yet done)
const tag = process.argv[3] || 'now';
const s = await start('wizard-peek', {
  kind: 'mobile',
  geolocation: { latitude: 51.5246, longitude: -0.0333 },
  permissions: ['geolocation'],
});
const { page } = s;
page.on('requestfailed', (r) =>
  console.log('REQFAILED', r.method(), r.url().slice(0, 140), r.failure()?.errorText),
);
page.on('response', (r) => {
  if (r.status() >= 400)
    console.log('HTTP', r.status(), r.request().method(), r.url().slice(0, 140));
});
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});
await page.goto(BASE.staff + '/login');
await page.getByLabel('Email').fill(CANDIDATE.email);
await page.getByLabel('Password').fill(candidatePassword());
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForTimeout(3500);
if (/\/login/.test(page.url())) {
  const link = await mintActivationLink(CANDIDATE.email);
  await page.goto(link);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Password', { exact: true }).first().fill(candidatePassword());
  await page.getByLabel('Confirm password').fill(candidatePassword());
  await page.getByRole('button', { name: /activate my account/i }).click();
  await page.waitForTimeout(4000);
}
await go(s, 'staff', '/onboarding', { wait: 1500 });
const current = () => Number((/\/onboarding\/(\d+)/.exec(page.url()) || [])[1] || 0);
while (current() && current() <= to) {
  const n = current();
  console.log('running step', n);
  try {
    await runStep(s, n);
  } catch (e) {
    console.log('STEP FAILED:', String(e.message).split('\n')[0]);
    break;
  }
  await page.waitForTimeout(1500);
  if (current() === n) {
    console.log('did not advance from', n);
    break;
  }
}
console.log('wizard at', page.url());
await page.screenshot({ path: `${process.env.DEMO_OUT}/../shots/peek-${tag}.png`, fullPage: true });
console.log((await page.locator('main, body').first().innerText()).slice(0, 1800));
const html = await page
  .locator('main')
  .first()
  .evaluate((m) =>
    [...m.querySelectorAll('button,input,select,textarea,[role=radio],[role=tab],a[href]')].map(
      (e) =>
        `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''} | ${(e.getAttribute('aria-label') || e.innerText || e.name || e.placeholder || '').toString().trim().slice(0, 60)}${e.disabled ? ' (disabled)' : ''}`,
    ),
  )
  .catch(() => []);
console.log('--- controls\n' + html.join('\n'));
await s.ctx.close();
await s.browser.close();
