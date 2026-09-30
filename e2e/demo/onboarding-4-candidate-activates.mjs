// Onboarding, candidate side, part 2: the personal link, choosing a password,
// and wizard steps 1 to 4 (right to work, address, selfie, documents).
// Starts from a candidate the office has just accepted (status: documents).
import {
  CANDIDATE,
  candidatePassword,
  card,
  finish,
  hush,
  mintActivationLink,
  press,
  say,
  sleep,
  soft,
  start,
  type,
} from './lib.mjs';
import { runStep } from './wizard-steps.mjs';

const s = await start('onboarding-4-candidate-activates', {
  kind: 'mobile',
  geolocation: { latitude: 51.5277, longitude: -0.0553, accuracy: 15 },
  permissions: ['geolocation'],
});
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Onboarding', '2 · Activating your account', 3000);

await say(
  s,
  'When the office accepts you, an email arrives with your personal activation link',
  4600,
);
const link = await mintActivationLink(CANDIDATE.email);
await page.goto(link, { waitUntil: 'domcontentloaded' });
await settle();
await sleep(800);
await say(s, 'Tap it. The link is personal to you and works once', 4200);

await say(s, 'Choose a password. The rules tick off as you meet them', 600);
await type(s, page.getByLabel('Password', { exact: true }).first(), candidatePassword(), {
  secret: true,
});
await sleep(1600);
await say(s, 'Type it again to confirm');
await type(s, page.getByLabel('Confirm password'), candidatePassword(), { secret: true });
await sleep(900);
await press(s, page.getByRole('button', { name: /Activate my account/ }), { after: 600 });
await page.waitForURL(/\/activate\/done/, { timeout: 30000 });
await settle();
await say(
  s,
  'Your account is active. Next, add the app to your home screen so it behaves like any other app',
  5200,
);
await soft('done screen', async () => {
  const cta = page
    .getByRole('link', { name: /Continue|Open|Start|onboarding/i })
    .or(page.getByRole('button', { name: /Continue|Open|Start|onboarding/i }));
  await press(s, cta, { after: 1800 });
});
await page.waitForURL(/\/onboarding/, { timeout: 15000 }).catch(() => {});
await settle();
await say(
  s,
  'Eleven short steps, and you can stop and come back at any point. It picks up where you left off',
  5400,
);

for (const n of [1, 2, 3, 4]) {
  await runStep(s, n);
  await sleep(600);
}

await say(
  s,
  'Your documents are now with the office. Steps 5 to 11 unlock once every document is verified',
  6000,
);
await hush(s);
await card(
  s,
  'Next: the office verifies the documents',
  'Then you finish the last seven steps',
  2600,
);
await finish(s);
