// Scheduling video, part 6 (worker's side): "I'm ready for tomorrow". Phone.
// Presses the real button for Amara on the Gala Dinner.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

const s = await start('sched-6b-worker-ready', { kind: 'mobile' });
const { page } = s;

await card(s, 'The worker’s side', 'Stage two: I’m ready', 2600);
await login(s, 'staff', process.env.DEMO_STAFF_EMAIL || 'amara.kalu@example.com');

await say(s, 'Here is the same shift on Amara’s phone. Tomorrow’s gala dinner carries a warning');
await go(s, 'staff', '/shifts', { wait: 1500 });
await soft('warning', async () => {
  await point(s, page.getByText(/or you.ll be removed/).first());
  await sleep(1400);
});
await say(s, 'Confirm by twelve noon, UK time, the day before, or you’ll be removed from this shift', 5000);
await soft('ready', async () => {
  await press(s, page.getByRole('button', { name: /ready for tomorrow/i }), { after: 2600 });
});
await say(s, 'One press on I’m ready for tomorrow. After twelve the button is disabled and says the deadline has passed', 5600);
await hush(s);
await card(s, 'Back to the office board', 'Scheduling · part 6 continued', 2200);
await finish(s);
