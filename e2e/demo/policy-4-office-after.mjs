// Break and buffer policies, part 4: what the office sees afterwards and the
// four combinations. Read-only.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

const s = await start('policy-4-office-after');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'What the office sees', 'Check-ins, breaks and the four combinations', 2800);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Back in the office. Open Check In and Out, the live monitor for today');
await go(s, 'office', '/checkin', { wait: 2000 });
await settle();
await say(s, 'Every worker who checked in is listed with the time they arrived', 4400);
await soft('priya', async () => {
  await point(s, page.locator('tr').filter({ hasText: 'Priya Sharma' }).filter({ hasText: 'On shift' }));
  await sleep(1400);
});
await say(s, 'Amara took a break at the Dorchester. The Breaks column counts them and shows when the last one started', 6200);
await soft('breaks', async () => {
  await point(s, page.getByText(/1 · last/).first());
  await sleep(1800);
});
await say(s, 'Those break minutes are taken off her paid hours, and off the Dorchester’s charge, automatically', 6000);
await say(s, 'At Mandarin Oriental, Priya is on shift in the one place. Tom was turned away because that place was already taken, so he does not appear here as working', 8400);

await say(s, 'To sum up. There are four combinations, and the Clients list shows each client’s', 5600);
await press(s, page.getByRole('link', { name: 'Clients', exact: true }).first(), { after: 1800 });
await settle();
await soft('combos', async () => {
  await scroll(s, 150, { pause: 400 });
  await point(s, page.getByText(/Breaks: paid · Buffer: paid/).first());
  await sleep(1400);
});
await say(s, 'Breaks paid and buffer paid. No break buttons, and everyone who accepted works and is paid', 6200);
await soft('c2', async () => {
  await point(s, page.getByText(/Breaks: paid · Buffer: strict/).first());
  await sleep(1400);
});
await say(s, 'Breaks paid and buffer strict. No break buttons, but only the first headcount to check in are accepted', 6400);
await soft('c3', async () => {
  await point(s, page.getByText(/Breaks: unpaid · Buffer: paid/).first());
  await sleep(1400);
});
await say(s, 'Breaks unpaid and buffer paid. Workers log their breaks, and everyone who accepted works', 6000);
await soft('c4', async () => {
  await point(s, page.getByText(/Breaks: unpaid · Buffer: strict/).first());
  await sleep(1400);
});
await say(s, 'Breaks unpaid and buffer strict. Workers log breaks, and the first to check in take the places', 6400);
await say(s, 'Remember: the four hours paid to a worker who is turned away is a cost to THC. It is never charged to the client', 7000);
await hush(s);
await card(s, 'That is the buffer and break policies', 'Set once on the client, applied on every event', 2800);
await finish(s);
