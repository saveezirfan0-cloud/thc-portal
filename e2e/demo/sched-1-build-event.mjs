// Scheduling video, part 1: building an event in the Shift Builder.
// Saves a real event ("Summer Reception") unless DRY=1.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, type } from './lib.mjs';
import { pick, setValue } from './sched-lib.mjs';

const s = await start('sched-1-build-event');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Building an event', 'The Shift Builder, step by step', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Every booking starts here. Open Scheduling, then New event');
await go(s, 'office', '/events');
await press(s, page.getByRole('link', { name: /New event/ }), { after: 1600 });
await settle();

await say(s, 'Step one: the client and the venue. The client loads its rate card, dress codes and policies', 4200);
await soft('client', async () => {
  await pick(s, page.getByLabel(/^Client\b/), 'Mandarin Oriental');
  await sleep(900);
});
await soft('venue', async () => {
  const venue = page.getByLabel(/^Venue\b/).first();
  const options = await venue.locator('option').allTextContents();
  const first = options.find((o) => o.trim() && !o.startsWith('Choose'));
  await pick(s, venue, first);
});
await say(s, 'The venue brings its address and its check-in geofence with it', 3200);
await soft('title', async () => {
  await type(s, page.getByLabel(/Event title/), 'Summer Reception');
  await type(s, page.getByLabel(/PO Number/), 'PO-DEMO-2210');
});
await say(s, 'Give it a title. The client’s purchase order number is optional and can be added at any time', 4200);

await say(s, 'Step two: the date, and an overall window to start from', 3000);
await soft('date', async () => {
  await setValue(s, page.getByLabel(/^Date\b/), '2026-10-16');
  await setValue(s, page.getByLabel(/Overall start/), '17:00');
  await setValue(s, page.getByLabel(/Overall end/), '23:00');
});
await say(s, 'Every time typed here is UK time', 2400);

await scroll(s, 480, { pause: 700 });
await say(s, 'Step three: the roles. Each role is its own section with its own times and numbers', 4200);
await soft('add role', async () => {
  await press(s, page.getByRole('button', { name: '+ Add role' }), { after: 1200 });
});
await soft('role 1', async () => {
  await pick(s, page.getByLabel('Role', { exact: true }).first(), 'Waiting Staff');
  await setValue(s, page.getByLabel('Headcount').first(), 8);
  await setValue(s, page.getByLabel('Buffer').first(), 1);
});
await say(
  s,
  'Headcount is how many the client needs. Buffer is spare people on top. Eight plus one means nine are invited, but only eight are needed',
  6200,
);
await say(s, 'Rates and dress code come from the client’s rate card. Allocation per hour is how many invites each round sends', 5400);
await soft('allocation', async () => {
  await point(s, page.getByLabel('Allocation per hour').first());
  await sleep(1800);
});

await say(s, 'Add another role for a different team, with its own start, end and numbers');
await soft('add role 2', async () => {
  await press(s, page.getByRole('button', { name: '+ Add role' }), { after: 1200 });
  await pick(s, page.getByLabel('Role', { exact: true }).nth(1), 'Bar Staff');
  await setValue(s, page.getByLabel('Start (UK time)', { exact: true }).nth(1), '18:00');
  await setValue(s, page.getByLabel('Headcount').nth(1), 2);
  await setValue(s, page.getByLabel('Buffer').nth(1), 0);
});
await say(s, 'This one starts an hour later. Times are checked role by role, never against the event window', 4600);

await scroll(s, 700, { pause: 700 });
await say(s, 'The summary shows the event window, total headcount, forecast hours and the margin, before you save', 5000);
await soft('summary', async () => {
  await point(s, page.getByText('Derived event window').first());
  await sleep(2600);
});
await say(s, 'Auto-assign is on by default, for the event and for each role. Switch it off for an event you want to fill by hand', 5400);
await soft('auto', async () => {
  await point(s, page.getByText('Event level').first());
  await sleep(2600);
});

if (process.env.DRY) {
  await say(s, 'Dry run: not saving', 1000);
} else {
  await say(s, 'Save the event. It appears on the board, and auto-assign starts inviting straight away', 3200);
  await press(s, page.getByRole('button', { name: 'Save event' }), { after: 3500 });
  await settle();
  await say(s, 'The event is on the board. Auto-assign has already sent the first round of invitations. Nobody has confirmed yet, so every place is still open', 6200);
  await sleep(1200);
}
await hush(s);
await card(s, 'Next: how staff are booked on', 'Scheduling · part 2', 2400);
await finish(s);
