// Scheduling video, part 6: the three-stage confirmation, and how the office knows.
// Read-only. Record BEFORE 12:00 UK on the day before the Gala Dinner.
import { card, finish, go, hush, login, point, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT } from './sched-lib.mjs';

const s = await start('sched-6a-confirmation');
const { page } = s;

await card(s, 'Confirming shifts', 'Three stages, and how the office knows', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'A worker confirms a shift in three stages. The board shows the office exactly where each person is');
await go(s, 'office', `/events/${EVENT.gala}`);
await say(s, 'Stage one: the worker accepts an invitation in the app. At that moment they move from Invited to Confirmed', 5600);
await soft('confirmed', async () => {
  await scroll(s, 380, { pause: 400 });
  await point(s, page.getByText(/Confirmed\s*\d/).first());
  await sleep(1200);
});
await say(s, 'Each confirmed line says when they accepted. There is no Confirm button on this screen. Only the worker can confirm', 5600);

await say(s, 'Stage two is the important one: I’m ready. The day before the shift, the worker is asked to press I’m ready', 5400);
await soft('ready', async () => {
  await point(s, page.getByText(/I'm ready — not yet/).first());
  await sleep(1400);
});
await say(s, 'Until they do, the line reads I’m ready, not yet. When they press it, it turns to a tick with the time', 5400);
await say(s, 'This is the only hard deadline. If they have not pressed it by twelve noon the day before, the system removes them from the shift, tells them, and starts finding a replacement', 8400);
await say(s, 'Twelve noon, because any later leaves no time to replace someone for tomorrow morning', 4400);

await say(s, 'So the morning of the day before, scan the board for lines still saying not yet. Call them, or invite someone else', 6000);
await soft('message', async () => {
  await scroll(s, -2000, { pause: 400 });
  await point(s, page.getByRole('button', { name: /Message staff/ }));
  await sleep(1400);
});
await say(s, 'Message staff sends a push to everyone on the role, or to just the people you choose', 4600);

await say(s, 'Stage three: on the day itself, the worker gets a reminder to confirm today’s shift. This one is only a reminder, and nothing is ever released', 8000);
await go(s, 'office', '/checkin');
await say(s, 'On the Check-in monitor, anyone who has not confirmed today shows as Not confirmed today. They can still check in normally', 7000);
await say(s, 'It is an early warning. You still have time to phone them, or bring in someone from the buffer', 5000);
await hush(s);
await card(s, 'Next: the worker presses I’m ready', 'Scheduling · part 6 continued', 2400);
await finish(s);
