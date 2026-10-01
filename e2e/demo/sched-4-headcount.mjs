// Scheduling video, part 4: more or fewer staff the night before.
// Awards Night · Host: 4 (+1) -> 5 (+1) -> 1 (+0). Reset with sched-reset.sql.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT, setValue } from './sched-lib.mjs';

const s = await start('sched-4-headcount');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});
const edit = async (headcount, buffer, { navigate = true } = {}) => {
  if (navigate) await go(s, 'office', `/events/${EVENT.awards}/edit`);
  await scroll(s, 640, { pause: 500 });
  await setValue(s, page.getByLabel('Headcount').nth(0), headcount);
  await setValue(s, page.getByLabel('Buffer', { exact: true }).nth(0), buffer);
};
const save = async () => {
  await press(s, page.getByRole('button', { name: 'Save event' }), { after: 3500 });
  await settle();
};

await card(s, 'Changing the number of staff', 'More people, or fewer, even the night before', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'The client rings the evening before. First case: they need more people. Open the event and press Edit');
await go(s, 'office', `/events/${EVENT.awards}`);
await soft('before', async () => {
  await point(s, page.getByText(/open of 4/).first());
  await sleep(1400);
});
await say(s, 'The host role needs four, plus one spare, and three have confirmed', 3600);
await go(s, 'office', `/events/${EVENT.awards}/edit`);
await say(s, 'Raise the headcount from four to five', 2800);
await edit(5, 1, { navigate: false });
await say(s, 'No one is asked to confirm again, and no one is told. Headcount and buffer change quietly', 4600);
await save();
await go(s, 'office', `/events/${EVENT.awards}`);
await soft('after up', async () => {
  await point(s, page.getByText(/open of 5/).first());
  await sleep(1400);
});
await say(s, 'The board now shows two open of five. Auto-assign tops it up on its next round, or you can invite people yourself', 6200);

await say(s, 'Second case: the client cuts the numbers instead. Edit again, and bring it right down');
await edit(1, 0);
await say(s, 'One host, and no spare', 2200);
await save();
await go(s, 'office', `/events/${EVENT.awards}`);
await soft('after down', async () => {
  await point(s, page.getByText(/confirmed ·/).first());
  await sleep(1400);
});
await say(s, 'Again, nothing is sent to anyone. But three people have confirmed for a role that now needs one. What happens to them is the last part of this video', 6600);
await hush(s);
await card(s, 'Next: how timesheets are sent', 'Scheduling · part 5', 2400);
await finish(s);
