/* eslint-disable no-console -- command-line tool: printing is its output */
// Joins the recorded segments into the training videos, in viewing order.
//   DEMO_OUT     folder holding the segment MP4s (and receiving the finished ones)
//   DEMO_FFMPEG  an ffmpeg with libx264
//
// Segments of one group share a resolution and encoder settings, so they are
// joined without re-encoding.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './lib.mjs';

const FFMPEG = process.env.DEMO_FFMPEG || 'ffmpeg';

export const VIDEOS = [
  {
    out: '01-Onboarding-the-candidates-journey',
    parts: [
      'onboarding-1-apply',
      'onboarding-4-candidate-activates',
      'onboarding-5-candidate-finishes',
    ],
  },
  {
    out: '02-Onboarding-the-offices-side',
    parts: ['onboarding-2-office-accepts', 'onboarding-3-office-verifies'],
  },
  { out: '03-Staff-App-a-working-day', parts: ['staff-1-working-day'] },
  {
    out: '04-Back-Office-1-dashboard-and-scheduling',
    parts: ['office-1-dashboard-and-scheduling'],
  },
  {
    out: '05-Back-Office-2-check-in-staff-and-compliance',
    parts: ['office-2-checkin-staff-compliance'],
  },
  {
    out: '06-Back-Office-3-clients-reports-and-admin',
    parts: ['office-3-directory-reports-admin'],
  },
];

const final = path.join(OUT, 'final');
fs.mkdirSync(final, { recursive: true });
for (const v of VIDEOS) {
  const files = v.parts.map((p) => path.join(OUT, `${p}.mp4`));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.warn(`skip ${v.out}: missing ${missing.map((m) => path.basename(m)).join(', ')}`);
    continue;
  }
  const list = path.join(final, `.${v.out}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  const dst = path.join(final, `${v.out}.mp4`);
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    dst,
  ]);
  fs.rmSync(list);
  console.log(`wrote ${dst} (${(fs.statSync(dst).size / 1048576).toFixed(1)} MB)`);
}
