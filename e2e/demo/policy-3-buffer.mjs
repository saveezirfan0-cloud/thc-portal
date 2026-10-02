// Buffer policy on the phone: a client with a STRICT buffer (Mandarin Oriental).
// Needs buffer-break-setup.sql run first. Priya has taken the one place; Tom is turned away.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

// A fix a few metres from Mandarin Oriental Hyde Park, inside its 150 m geofence.
const s = await start('policy-3-buffer', {
  kind: 'mobile',
  geolocation: { latitude: 51.5023, longitude: -0.1600, accuracy: 10 },
  permissions: ['geolocation'],
});
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Buffer policy on the phone', 'When the client does not pay for spare staff', 2600);
await login(s, 'staff', 'tom.reid@example.com');
await settle();

await say(s, 'Tom has confirmed a shift at Mandarin Oriental. They need one person, plus one spare. Mandarin does not pay for the buffer', 6600);
await say(s, 'Under a strict buffer, the place goes to whoever checks in first, not to whoever accepted first', 5400);
await soft('open', async () => {
  await press(s, page.getByText('Rooftop Reception').first(), { after: 1800 });
});
await settle();
await say(s, 'Tom arrives on time and taps Check in. But Priya got there five minutes earlier, and took the one place', 6400);
await scroll(s, 200, { pause: 500 });
await soft('check in', async () => {
  await press(s, page.getByRole('button', { name: /Check in — verify GPS/ }).or(page.getByRole('link', { name: /Check in — verify GPS/ })), { after: 3000 });
});
await page.getByText(/Thanks for coming/).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
await sleep(1500);
await say(s, 'The button works, but the attempt is turned away. He is told the shift is already fully staffed', 6000);
await soft('message', async () => {
  await point(s, page.getByText(/already fully staffed/).first());
  await sleep(1200);
});
await say(s, 'Because Tom arrived on time, the app tells him he will be paid for four hours', 5200);
await soft('four hours', async () => {
  await point(s, page.getByText(/paid for 4 hours/).first());
  await sleep(1600);
});
await say(s, 'That is a flat four hours, whatever the length of the shift. THC pays it, and the client is not charged', 7000);
await say(s, 'Had Tom arrived late, the message would not mention pay, because a late worker who is turned away is paid nothing', 7600);
await say(s, 'And the app points him to other shifts on Radar', 3600);
await soft('radar', async () => {
  await point(s, page.getByRole('link', { name: /Open Radar/ }).or(page.getByRole('button', { name: /Open Radar/ })));
  await sleep(1400);
});
await say(s, 'If the client does pay for the buffer, none of this happens. Everyone who accepted works and is paid normally', 6600);
await hush(s);
await card(s, 'Next: what the office sees', 'Policies and results in the Back Office', 2400);
await finish(s);
