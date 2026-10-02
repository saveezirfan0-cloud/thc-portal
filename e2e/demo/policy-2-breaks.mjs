// Break policy on the phone: a client that does NOT pay for breaks (The Dorchester).
// Needs buffer-break-setup.sql run first. Amara checks in and takes a break.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

// A fix a few metres from The Dorchester, inside its 150 m geofence.
const s = await start('policy-2-breaks', {
  kind: 'mobile',
  geolocation: { latitude: 51.5072, longitude: -0.1522, accuracy: 10 },
  permissions: ['geolocation'],
});
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Break policy on the phone', 'When the client does not pay for breaks', 2600);
await login(s, 'staff', 'amara.kalu@example.com');
await settle();

await say(s, 'This shift is for The Dorchester, which does not pay for breaks. Open it');
await soft('open', async () => {
  await press(s, page.getByText('Private Dining').first(), { after: 1800 });
});
await settle();
await say(s, 'Scroll down to the Breaks block. It only appears when the client does not pay', 4800);
await scroll(s, 520, { pause: 600 });
await soft('unpaid', async () => {
  await point(s, page.getByText('Unpaid by client').first());
  await sleep(1400);
});
await say(s, 'Because this shift is longer than six hours, it carries a reminder. A break will be applied, so check with your manager on site', 6800);
await soft('banner', async () => {
  await point(s, page.getByText(/A break will be applied/).first());
  await sleep(1400);
});
await say(s, 'The reminder is information only. The system does not check how long a break lasts, or that one is taken', 5600);
await soft('locked', async () => {
  await point(s, page.getByRole('button', { name: 'Start break' }));
  await sleep(1200);
});
await say(s, 'Start break is locked until you have checked in. You cannot take a break from a shift you have not started', 6000);

await say(s, 'So first, check in. The app confirms you are at the venue');
await scroll(s, -260, { pause: 400 });
await soft('check in', async () => {
  await press(s, page.getByRole('button', { name: /Check in — verify GPS/ }).or(page.getByRole('link', { name: /Check in — verify GPS/ })), { after: 2500 });
});
await page.getByText(/You.re checked in/i).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
await sleep(1800);
await say(s, 'Checked in. Now the Breaks block is live', 3200);
await scroll(s, 520, { pause: 600 });

await say(s, 'When you stop for a break, tap Start break');
await soft('start break', async () => {
  await press(s, page.getByRole('button', { name: 'Start break' }), { after: 2400 });
});
await say(s, 'The button changes to Finish break, and the counter of paid time so far stops', 5200);
await soft('counter', async () => {
  await point(s, page.getByText(/paid so far|chargeable|on the clock/i).first());
  await sleep(1400);
});
await say(s, 'There is no limit on the number or length of breaks. The time is simply taken off', 5200);
await sleep(3500);
await say(s, 'Back to work. Tap Finish break');
await soft('finish break', async () => {
  await press(s, page.getByRole('button', { name: /Finish break/ }), { after: 2400 });
});
await say(s, 'The break is logged, and the counter carries on', 4000);

await say(s, 'This matters for pay and for the invoice. Break time comes off the hours, so it comes off both the worker’s pay and the client’s charge', 8200);
await say(s, 'If the client does pay for breaks, this whole block is hidden. There is nothing to press and nothing to log', 6400);
await hush(s);
await card(s, 'Next: the buffer policy', 'Spare staff, and who is turned away', 2400);
await finish(s);
