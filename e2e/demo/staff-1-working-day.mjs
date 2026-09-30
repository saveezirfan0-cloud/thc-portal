// Staff App walkthrough on a phone: sign in, My shifts, Open shifts, the
// shift screen and GPS check-in, a break, check-out, Invites, Radar, Profile.
//
// Needs a confirmed booking for the signed-in worker whose check-in window is
// open (see README.md: the demo booking is moved to "20 minutes from now"
// just before recording).
import {
  card,
  finish,
  hush,
  login,
  point,
  press,
  say,
  scroll,
  sleep,
  soft,
  start,
} from './lib.mjs';

// A fix a few metres from Leonardo Royal Hotel, inside its 150 m geofence.
const s = await start('staff-1-working-day', {
  kind: 'mobile',
  geolocation: { latitude: 51.51345, longitude: -0.09895, accuracy: 12 },
  permissions: ['geolocation'],
});
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});
const nav = (name) => page.getByRole('link', { name: new RegExp(`^${name}`) }).first();

await card(s, 'Staff App', '1 · Your working day');

await say(s, 'Sign in with the email and password you chose when you activated your account');
await login(s, 'staff', process.env.DEMO_STAFF_EMAIL || 'amara.kalu@example.com');
await settle();

// ── My shifts ────────────────────────────────────────────────────────────
await say(s, 'My shifts: everything you are booked on, soonest first', 3400);
await soft('banner', async () => {
  await say(s, 'Notices like this can be hidden for a week with the cross');
  await press(s, page.getByRole('button', { name: /Hide this/ }), { after: 900 });
});
await say(s, 'This line keeps count of your hours for the week, against your limit');
await soft('hours', async () => {
  await point(s, page.getByText(/This week/).first());
  await sleep(3600);
});
await say(s, 'Times are UK time. If your phone is in another zone, your own time shows underneath');
await sleep(2800);

await say(s, 'Today’s shift sits at the top, with the venue, your pay rate and the dress code');
await scroll(s, 200, { pause: 3600 });

// ── Check in ─────────────────────────────────────────────────────────────
await say(s, 'Check-in opens 30 minutes before the start. Tap Check in');
const checkIn = page
  .getByRole('link', { name: /Check in — verify GPS/ })
  .or(page.getByRole('button', { name: /Check in — verify GPS/ }));
await press(s, checkIn, { after: 2500 });
await settle();
await say(s, 'The app finds you on the map. You must be inside the circle around the venue', 4600);
await say(
  s,
  'Once it has a fix inside the circle, you are checked in automatically. There is nothing more to tap',
  600,
);
await page
  .getByText(/You.re checked in/i)
  .first()
  .waitFor({ state: 'visible', timeout: 25000 });
await sleep(3800);
await say(s, 'Checked in. On time is on or before the start. Up to 30 minutes after is Late', 5000);
await say(s, 'After 30 minutes the button locks and you are marked as a no-show', 4400);
await scroll(s, 300, { pause: 600 });

// ── Breaks and check-out ─────────────────────────────────────────────────
await say(
  s,
  'If your client pays breaks there is nothing to log. Otherwise Start break and End break appear here',
  5600,
);
await soft('breaks text', async () => {
  await point(s, page.getByText(/Breaks are paid by this client/i).first());
  await sleep(1600);
});
await say(s, 'At the end of your shift, tap Check out', 3200);
await soft('check out', async () => {
  const out = page.getByRole('button', { name: /^Check out/ }).first();
  await scroll(s, 260, { pause: 600 });
  await point(s, out);
  await sleep(2200);
  await say(
    s,
    'Check-out stays open for 4 hours after the end. If you forget, the office is told',
    4800,
  );
});

// ── Open shifts, Invites, Radar ──────────────────────────────────────────
await say(s, 'Back on Shifts, Open shifts lists work you can apply for');
await press(s, nav('Shifts'), { after: 1500 });
await settle();
await soft('open shifts', async () => {
  await press(s, page.getByRole('tab', { name: 'Open shifts' }), { after: 2200 });
  await scroll(s, 240, { pause: 3200 });
});
await say(s, 'Invites: shifts the office has offered you. Accept to confirm, or Decline');
await press(s, nav('Invites'), { after: 1800 });
await settle();
await sleep(3600);
await say(
  s,
  'If accepting would take you over your weekly hours limit, it is switched off and says Limit reached',
  5200,
);
await say(
  s,
  'The first person to confirm gets the slot. Invitations never expire until the event ends',
  4200,
);
await say(s, 'Radar shows open work near you');
await press(s, nav('Radar'), { after: 1800 });
await settle();
await sleep(3600);

// ── Profile ──────────────────────────────────────────────────────────────
await say(s, 'Profile: your details, documents, security, and payment information');
await press(s, nav('Profile'), { after: 1800 });
await settle();
await say(s, 'You only ever see your own base rate. Holiday pay is shown separately', 4200);
await scroll(s, 340, { pause: 3200 });
await scroll(s, 340, { pause: 3200 });
await hush(s);

await card(s, 'That is the Staff App', 'Next: how a new worker gets started', 2600);
await finish(s);
