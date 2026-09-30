// Onboarding, candidate side, part 1: the public application form on a phone.
// Writes one real application (a fictional candidate on an alias of the
// owner's email) that the later onboarding scripts pick up.
import {
  CANDIDATE,
  card,
  finish,
  go,
  hush,
  point,
  press,
  say,
  scroll,
  sleep,
  soft,
  start,
  type,
} from './lib.mjs';

const s = await start('onboarding-1-apply', { kind: 'mobile' });
const { page } = s;

await card(s, 'Onboarding', '1 · Applying to work with us', 3000);

await say(
  s,
  'Anyone can apply from their phone. There is nothing to install and no account to make',
  4200,
);
await go(s, 'staff', '/apply', { wait: 1800 });
await say(
  s,
  'Two minutes. Straight after you submit, you get an email with a link to a short video interview',
  4600,
);

await say(s, 'Your name');
await type(s, page.getByLabel('First name'), CANDIDATE.first);
await type(s, page.getByLabel('Surname'), CANDIDATE.last);

await say(s, 'Your email. The interview link and everything after it lands here', 600);
await type(s, page.getByLabel('Email'), CANDIDATE.email);

await say(s, 'Your mobile number. Pick the country code, then type the number', 600);
await soft('dial code', async () => {
  await point(s, page.getByRole('button', { name: /\+44|UK|United Kingdom/i }).first());
  await sleep(1600);
});
await type(s, page.getByLabel('Mobile').last(), CANDIDATE.mobile);

await say(s, 'Date of birth. Type the digits, or tap the calendar. You must be 18 or over', 600);
await type(s, page.getByLabel('Date of birth').first(), CANDIDATE.dob, { delay: 120 });
await sleep(1500);

await say(s, 'Tick to agree to how we store your details. This is required');
await scroll(s, 380, { pause: 600 });
await press(s, page.getByText(/I agree to The Hospitality Company/i).first(), { after: 1600 });

await say(s, 'Submit application');
await press(s, page.getByRole('button', { name: 'Submit application' }), { after: 1200 });
await page.waitForURL(/\/apply\/submitted/, { timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(
  s,
  'Done. The office sees the application straight away, and the interview invitation is on its way',
  5200,
);
await hush(s);

await card(s, 'Next: the office reviews the candidate', 'Onboarding · the office’s side', 2600);
await finish(s);
