// Break and buffer policies, part 1: what they are and where they are set.
// Read-only: the Shift Builder is opened but nothing is saved.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { pick } from './sched-lib.mjs';

const s = await start('policy-1-office');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Break and buffer policies', 'What they are, and where they are set', 2800);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Every client has two policies. They decide how breaks and spare staff are paid, and what the client is charged');
await say(s, 'The break policy: does the client pay for breaks, or not. The buffer policy: does the client pay for the spare people booked on top of the headcount, or not', 9600);

await say(s, 'You set both on the client. Open Clients from the menu');
await press(s, page.getByRole('link', { name: 'Clients', exact: true }).first(), { after: 1800 });
await settle();
await say(s, 'The Policies column shows both at a glance. Paid or unpaid for breaks, paid or strict for the buffer', 6200);
await soft('policies', async () => {
  await point(s, page.getByText(/Breaks: unpaid · Buffer: strict/).first());
  await sleep(1600);
  await point(s, page.getByText(/Breaks: paid · Buffer: paid/).first());
  await sleep(1600);
});

await say(s, 'Open a client. This is Mandarin Oriental');
await go(s, 'office', '/clients/40000000-0000-4000-8000-000000000002', { wait: 1800 });
await say(s, 'In General info, both policies are written out in plain words', 4200);
await soft('break policy', async () => {
  await point(s, page.getByText('Break policy').first());
  await sleep(1800);
});
await soft('buffer policy', async () => {
  await point(s, page.getByText('Buffer policy').first());
  await sleep(1800);
});
await say(s, 'Edit changes them whenever the client agrees something new. Nothing is typed per worker, and nothing is calculated by hand', 6400);

await say(s, 'When you build an event, the client’s policies come with it. Choose The Dorchester in the Shift Builder');
await go(s, 'office', '/events/new', { wait: 1800 });
await soft('client', async () => {
  await pick(s, page.getByLabel(/^Client\b/), 'The Dorchester');
});
await soft('panel', async () => {
  await scroll(s, 700, { pause: 700 });
  await point(s, page.getByText('Client policies').first());
  await sleep(1400);
});
await say(s, 'Client policies appear read-only beside the form. The Dorchester does not pay for breaks, so workers get break buttons, and break time comes off pay and charge', 9200);
await say(s, 'The Dorchester does pay for the buffer, so everyone who accepted works and is paid normally', 6000);

await say(s, 'On the event board, both stay visible in the header. Here is a Mandarin Oriental event');
await go(s, 'office', '/events/80000000-0000-4000-8000-000000000002', { wait: 2000 });
await soft('header', async () => {
  await point(s, page.getByText(/Break policy — client pays/).first());
  await sleep(1400);
  await point(s, page.getByText(/Buffer policy — strict/).first());
  await sleep(1600);
});
await say(s, 'Break policy: client pays. Buffer policy: strict. You cannot change them here', 5400);
await soft('buffer', async () => {
  await scroll(s, 360, { pause: 500 });
  await point(s, page.getByText('1 (+1)').first());
  await sleep(1800);
});
await say(s, 'The buffer is an absolute number, shown as one plus one. One person needed, and one spare. Never shown as two', 7000);
await hush(s);
await card(s, 'Next: breaks on the phone', 'Break and buffer policies · part 2', 2400);
await finish(s);
