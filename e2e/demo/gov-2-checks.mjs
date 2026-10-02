// gov.uk right-to-work check, part 2: the monitor of automatic checks. Read-only.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, tab } from './lib.mjs';

const s = await start('gov-2-checks');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'The automatic gov.uk check', 'What the system does with a share code', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'When a worker files a share code, the system checks it with gov.uk by itself. The office never types a code, and never types the date');
await go(s, 'office', '/compliance', { wait: 1800 });
await say(s, 'The checks are on the gov.uk checks tab of Compliance. Open it', 4000);
await soft('tab', async () => {
  await press(s, tab(s, /gov\.uk checks/), { after: 1800 });
});
await settle();
await say(s, 'Four counters. In progress means queued, or with gov.uk right now', 5200);
await soft('progress', async () => {
  await point(s, page.getByText('In progress').first());
  await sleep(1200);
});
await say(s, 'Waiting for you means a result has come back. Compare the photo, then Verify or Reject', 6000);
await soft('waiting', async () => {
  await point(s, page.getByText('Waiting for you').first());
  await sleep(1200);
});
await say(s, 'Stopped means it gave up after every attempt, or the runner has not touched it', 5400);
await soft('stopped', async () => {
  await point(s, page.getByText(/Stopped · not running/).first());
  await sleep(1200);
});
await say(s, 'And Filed, no check yet is a share code that should have been checked and has not started. That is the one to chase', 7000);
await soft('filed', async () => {
  await point(s, page.getByText('Filed, no check yet').first());
  await sleep(1200);
});

await say(s, 'The runner box shows when it last ran. It runs every ten minutes, so a new share code can wait up to ten minutes for its first attempt', 9000);
await soft('runner', async () => {
  await point(s, page.getByText('The runner').first());
  await sleep(1600);
});
await say(s, 'If gov.uk cannot be reached, it tries again, up to five times, and says so on the row', 6400);

await scroll(s, 360, { pause: 600 });
await say(s, 'Each row is one check. Who, its status, the number of tries, when it was filed, and what happened', 6400);
await soft('tomas', async () => {
  await point(s, page.locator('tr').filter({ hasText: 'Tomas Silva' }).first());
  await sleep(1200);
});
await say(s, 'For Tomas, gov.uk confirms a right to work until a date, and recommends Verify', 5600);
await soft('dimitri', async () => {
  await point(s, page.locator('tr').filter({ hasText: 'Dimitri Popescu' }).first());
  await sleep(1200);
});
await say(s, 'For Dimitri, gov.uk found no record for the code and date of birth he entered, and recommends Reject', 7000);
await say(s, 'In every case a person decides. Nothing is verified or rejected automatically. That comes next', 6000);
await hush(s);
await card(s, 'Next: Verify or Reject', 'Right to work and expiry dates · part 3', 2400);
await finish(s);
