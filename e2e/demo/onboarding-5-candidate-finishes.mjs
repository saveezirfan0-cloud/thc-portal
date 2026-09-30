// Onboarding, candidate side, part 3: signing back in once the documents are
// verified, then wizard steps 5 to 11 (induction, quiz, tax, references, bank,
// contract, how it works) and the first screen of the app.
import {
  CANDIDATE,
  candidatePassword,
  card,
  finish,
  go,
  hush,
  sleep,
  say,
  start,
  press,
  type,
} from './lib.mjs';
import { runStep } from './wizard-steps.mjs';

const s = await start('onboarding-5-candidate-finishes', { kind: 'mobile' });
const { page } = s;

await card(s, 'Onboarding', '3 · Finishing your onboarding', 3000);

await say(
  s,
  'Once the office has verified your documents, sign back in. Steps 5 to 11 are now open',
  5000,
);
await go(s, 'staff', '/login');
await type(s, page.getByLabel('Email'), CANDIDATE.email);
await type(s, page.getByLabel('Password'), candidatePassword(), { secret: true });
await press(s, page.getByRole('button', { name: /sign in/i }), { after: 600 });
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
await go(s, 'staff', '/onboarding', { wait: 1200 });

for (const n of [5, 6, 7, 8, 9, 10, 11]) {
  await runStep(s, n);
  await sleep(600);
}

await say(
  s,
  'You are in. Your first shifts will appear here as soon as the office books you',
  5600,
);
await hush(s);
await card(s, 'That is onboarding', 'Next: the Staff App', 2600);
await finish(s);
