// Scheduling video, part 3 (worker's side): the "Time changed" card and
// Confirm new time. Run after sched-3-time-change.mjs. Phone.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

const s = await start('sched-3b-worker-time-change', { kind: 'mobile' });
const { page } = s;

await card(s, 'The worker’s side', 'A time change in the Staff App', 2600);
await login(s, 'staff', process.env.DEMO_STAFF_EMAIL || 'amara.kalu@example.com');

await say(s, 'Amara is booked on the awards night. A push told her the time changed, and her Shifts list shows it');
await go(s, 'staff', '/shifts', { wait: 1500 });
await soft('tag', async () => {
  await point(s, page.getByText(/Time changed/i).first());
  await sleep(1400);
});
await say(s, 'The card is tagged Time changed, and says what moved, with the old time', 4600);
await soft('confirm', async () => {
  await press(s, page.getByRole('button', { name: 'Confirm new time' }), { after: 2400 });
});
await say(s, 'One press on Confirm new time, and she is confirmed again. The office board clears her marker at once', 5400);
await hush(s);
await card(s, 'Next: changing the number of staff', 'Scheduling · part 4', 2400);
await finish(s);
