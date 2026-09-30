// The candidate's 11-step wizard as reusable, captioned steps. Each step is
// `async (s) => void`, leaves the wizard on the next step, and is safe to call
// only when the wizard is on that step.
import {
  CANDIDATE,
  chooseFile,
  ensureAssets,
  patch,
  press,
  rest,
  say,
  sleep,
  soft,
  type,
  scroll,
} from './lib.mjs';

const settle = (s) => s.page.waitForLoadState('networkidle').catch(() => {});
const radio = (s, name) => s.page.getByRole('radio', { name });

export const steps = {
  // 1 · Right to work
  async 1(s) {
    await say(s, 'Step 1 of 11: right to work. Choose the option that describes you', 4200);
    await say(
      s,
      'This decides which documents we ask for. Everyone is checked against gov.uk',
      4200,
    );
    await press(s, radio(s, /UK or Irish citizen/), { after: 900 });
    await say(
      s,
      'A UK or Irish citizen shows a passport, or a birth certificate plus a document with their NI number',
      4600,
    );
    await press(s, s.page.getByRole('button', { name: /^Continue/ }), { after: 1600 });
    await settle(s);
  },
  // 2 · Home address
  async 2(s) {
    const f = (label) => s.page.getByLabel(label);
    await say(
      s,
      'Step 2 of 11: your home address. It is used to work out how far each venue is from you',
      4600,
    );
    await say(s, 'Closer shifts rank higher, and Radar shows distances from here');
    await soft('postcode search', async () => {
      await type(s, f('Postcode search'), 'E2 0RY');
    });
    await say(
      s,
      'Tap Use my location to drop the pin, then nudge the map so the pin is on your front door',
      600,
    );
    await press(s, s.page.getByRole('button', { name: /Use my location/ }), { after: 2600 });
    await say(s, 'Then type the address');
    await type(s, f(/Flat/), 'Flat 4');
    await type(s, f(/House no/), '22');
    await type(s, f(/Street name/), 'Roman Road');
    await type(s, f(/Area/), 'Bethnal Green');
    await type(s, f(/Town/), 'London');
    await type(s, f(/^Postcode \*/), 'E2 0RY');
    await say(
      s,
      'Only the flat number can be left blank. You can change this later in Profile; the office is told',
      3800,
    );
    await press(s, s.page.getByRole('button', { name: /^Continue/ }), { after: 1600 });
    await settle(s);
  },
  // 3 · Profile selfie
  async 3(s) {
    const a = await ensureAssets();
    await say(
      s,
      'Step 3 of 11: your profile photo. It appears on your profile, the timesheet, and to the client',
      4600,
    );
    await say(s, 'Plain background, face the camera, no hat or sunglasses');
    await sleep(2400);
    await say(s, 'On a phone, this opens the camera. Tap the shutter to take the photo');
    await chooseFile(s, s.page.getByRole('button', { name: 'Take photo' }), a.selfie, {
      after: 1800,
    });
    await say(
      s,
      'Check it. Retake if you need to, or use it. It is set once; changing it later goes through the office',
      5200,
    );
    await press(s, s.page.getByRole('button', { name: 'Use this photo' }), { after: 2200 });
    await settle(s);
  },
  // 4 · Documents
  async 4(s) {
    const a = await ensureAssets();
    await say(
      s,
      'Step 4 of 11: your documents. The list depends on the option you chose in step 1',
      4600,
    );
    await say(s, 'A UK or Irish citizen uploads their passport photo page');
    await press(s, s.page.getByRole('button', { name: 'Upload' }).first(), { after: 1600 });
    await say(
      s,
      'Take a photo, pick one from your photos, or browse your files. PDF, JPG, PNG or HEIC up to 10 MB',
      5200,
    );
    await chooseFile(s, s.page.getByRole('button', { name: /Browse files/ }), a.passport, {
      after: 3200,
    });
    await settle(s);
    await say(
      s,
      'Uploaded. The office checks every document, and the AI reads it first to save them time',
      4800,
    );
    await scroll(s, 380, { pause: 800 });
    await say(
      s,
      'You must also declare any unspent criminal convictions. \u201CNo\u201D is accepted straight away',
      4800,
    );
    await press(s, s.page.getByRole('radio', { name: /^No/ }), { after: 1200 });
    await say(s, 'A \u201CYes\u201D is not a rejection. It goes to the office to review', 3600);
    await press(s, s.page.getByRole('button', { name: /Submit documents/ }), { after: 2200 });
    await settle(s);
  },
  // 5 · Health & Safety induction
  async 5(s) {
    const next = s.page.getByRole('button', { name: /^Next/ });
    await say(
      s,
      'Step 5 of 11: the Health & Safety induction. THC\u2019s own slides, one at a time',
      4600,
    );
    await say(s, 'Read every slide. The quiz that follows is based on them', 3200);
    await press(s, next, { after: 2600 });
    await say(s, 'Pinch to zoom, and go back to any slide before you start the quiz', 3600);
    await press(s, next, { after: 2200 });
    await say(s, 'The Continue button unlocks on the last slide', 600);
    for (let i = 0; i < 40; i += 1) {
      if (await next.isDisabled()) break;
      await next.tap();
      await sleep(330);
    }
    await sleep(1500);
    await say(s, 'That was the last slide. Now Continue to the quiz');
    await press(s, s.page.getByRole('button', { name: /Continue to the quiz/ }), { after: 2200 });
    await settle(s);
  },
  // 6 · Safety quiz
  async 6(s) {
    // The answer key never reaches the page, so the demo reads it from the
    // database the same way the marking does.
    const questions = await rest(
      'quiz_questions?select=prompt,correct_index&active=eq.true&order=position',
    );
    const norm = (x) => x.replace(/\s+/g, ' ').trim();
    const key = new Map(questions.map((q) => [norm(q.prompt), q.correct_index]));
    await say(s, 'Step 6 of 11: the safety quiz. Ten questions, one at a time', 4200);
    await say(
      s,
      'The pass mark is 80%. You get three attempts, and your answers are checked at the end',
      5200,
    );
    for (let i = 0; i < questions.length; i += 1) {
      const group = s.page.getByRole('radiogroup').first();
      const prompt = norm((await group.getAttribute('aria-label')) || '');
      const idx = key.get(prompt);
      if (idx === undefined) throw new Error(`quiz question not in the answer key: ${prompt}`);
      if (i === 0) await say(s, 'Read the question, then choose an answer');
      await sleep(i < 2 ? 2600 : 1500);
      await press(s, s.page.getByRole('radio').nth(idx), { after: 700 });
      const submit = s.page.getByRole('button', { name: 'Submit answers' });
      if (await submit.count()) {
        await say(s, 'On the last question, submit to have all ten marked');
        await press(s, submit, { after: 2600 });
      } else {
        await press(s, s.page.getByRole('button', { name: /Next question/ }), { after: 500 });
      }
    }
    await settle(s);
    await say(
      s,
      'Passed. The result is saved on the candidate\u2019s profile. Fail three times and the application cannot continue',
      5200,
    );
    await press(s, s.page.getByRole('button', { name: /^Continue/ }), { after: 2000 });
    await settle(s);
  },
  // 7 · HMRC New Starter Checklist
  async 7(s) {
    const no = s.page.getByRole('radio', { name: 'No', exact: true });
    await say(s, 'Step 7 of 11: your tax position, the HMRC new starter checklist', 4600);
    await say(
      s,
      'It sets your tax code. Have a P45? Read the figures off it. We never take the document',
      4800,
    );
    await say(s, 'Question 1: do you have another job?');
    await press(s, no.nth(0), { after: 900 });
    await say(s, 'Question 2: do you receive a State, workplace or private pension?');
    await press(s, no.nth(1), { after: 900 });
    await scroll(s, 260, { pause: 400 });
    await say(
      s,
      'Question 3: payments from a job that has ended, or taxable benefits since 6 April?',
    );
    await press(s, no.nth(2), { after: 900 });
    await scroll(s, 300, { pause: 400 });
    await say(s, 'Student loan: choose your plan, or No if you do not have one');
    await press(s, no.nth(3), { after: 900 });
    await scroll(s, 300, { pause: 400 });
    await say(s, 'Gender, as HMRC records it. Payroll can only send male or female', 4200);
    await press(s, s.page.getByRole('radio', { name: 'Male', exact: true }), { after: 900 });
    await scroll(s, 300, { pause: 400 });
    await say(
      s,
      'Your National Insurance number is optional. Leave it blank if you do not have one yet and add it later in Profile',
      5200,
    );
    await say(s, 'Confirm the information is correct, then submit');
    await press(s, s.page.getByRole('checkbox', { name: /I confirm/ }), { after: 900 });
    await press(s, s.page.getByRole('button', { name: /Submit checklist/ }), { after: 2200 });
    await settle(s);
  },
  // 8 · Two references
  async 8(s) {
    const f = (label, n) => s.page.getByLabel(label).nth(n);
    await say(s, 'Step 8 of 11: two references. They must not be relatives', 4200);
    await say(
      s,
      'Employers, tutors, lecturers, teachers, course leaders and volunteering supervisors all count',
      5000,
    );
    await say(s, 'Referee 1. Name, how they know you, phone and email are all required');
    await type(s, f(/Full name/, 0), 'Helen Marsh');
    await type(s, f(/Relationship/, 0), 'Personal tutor, City University');
    await type(s, f(/^Phone/, 0), '07700 900431');
    await type(s, f(/^Email/, 0), 'helen.marsh@example.com');
    await scroll(s, 340, { pause: 500 });
    await say(s, 'Referee 2');
    await type(s, f(/Full name/, 1), 'Paul Okoye');
    await type(s, f(/Relationship/, 1), 'Former manager, The Corner Cafe');
    await type(s, f(/^Phone/, 1), '07700 900432');
    await type(s, f(/^Email/, 1), 'paul.okoye@example.com');
    await say(s, 'The office may contact them. There is no separate reference-check stage', 4200);
    await press(s, s.page.getByRole('button', { name: /^Continue/ }), { after: 2000 });
    await settle(s);
  },
  // 9 · Bank & payroll
  //
  // Saving the bank details emails payroll (E5) at a real third-party address,
  // so the recording fills the form in but does not press Continue; the step is
  // then marked done in the database and the wizard moves on.
  async 9(s) {
    await say(s, 'Step 9 of 11: bank and payroll. A UK account in your own name', 4200);
    await say(s, 'You are paid by bank transfer on the Friday after the week you worked');
    await type(s, s.page.getByLabel(/Account holder/), 'Jordan Ellis');
    await say(s, 'The name exactly as it is on your bank card or statement');
    await type(s, s.page.getByLabel(/Sort code/), '12-34-56');
    await type(s, s.page.getByLabel(/Account number/), '12345678');
    await say(
      s,
      'Continue saves the details. Payroll is emailed automatically whenever they change',
      4600,
    );
    await say(s, 'In this recording Continue is not pressed, so no email goes to payroll', 4200);
    const [st] = await rest(`staff?select=id&email=eq.${encodeURIComponent(CANDIDATE.email)}`);
    await patch(`onboarding_progress?staff_id=eq.${st.id}`, { bank_at: new Date().toISOString() });
    await s.page.goto(new URL('/onboarding', s.page.url()).toString(), {
      waitUntil: 'domcontentloaded',
    });
    await settle(s);
    await sleep(1000);
  },
  // 10 · Contract
  async 10(s) {
    await say(s, 'Step 10 of 11: your agreement. Please read it all', 4200);
    const contract = s.page.locator('.contract').first();
    for (let i = 0; i < 4; i += 1) {
      await contract.evaluate((el) => el.scrollBy({ top: 520, behavior: 'smooth' }));
      await sleep(i === 0 ? 2600 : 1400);
    }
    await say(s, 'Ticking \u201CI agree\u201D is your electronic signature', 4200);
    await press(s, s.page.locator('label.check').filter({ hasText: 'I agree' }), { after: 2600 });
    await say(
      s,
      'The timestamp is your signature. It is always shown in UK time, wherever you are',
      5000,
    );
    await say(s, 'A copy of the signed agreement is kept on your profile');
    await sleep(2000);
    await press(s, s.page.getByRole('button', { name: /^Continue/ }), { after: 2000 });
    await settle(s);
  },

  // 11 · How it works
  async 11(s) {
    await say(s, 'Step 11 of 11: how it works. Four things to know', 3600);
    await scroll(s, 0, { pause: 600 });
    await say(s, 'Invitations arrive as notifications. Open Invites to Accept or Decline', 4400);
    await scroll(s, 240, { pause: 600 });
    await say(
      s,
      'The day before, press \u201CI\u2019m ready\u201D by 12:00. It is the only hard deadline',
      4800,
    );
    await scroll(s, 240, { pause: 600 });
    await say(s, 'On the day, confirm you are coming. A reminder, not a deadline', 4200);
    await scroll(s, 240, { pause: 600 });
    await say(
      s,
      'Check in on site with GPS, and check out when you finish. You are paid the Friday after the week you worked',
      5600,
    );
    await press(s, s.page.getByRole('button', { name: 'Open app' }), { after: 2600 });
    await settle(s);
  },
};

export async function runStep(s, n) {
  if (!steps[n]) throw new Error(`step ${n} not written yet`);
  await steps[n](s);
}
