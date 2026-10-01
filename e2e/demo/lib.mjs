/* eslint-disable no-console -- command-line tool: printing is its output */
// Shared helpers for the scripted demo / training walkthroughs.
//
// These are not tests. Each script in this folder drives one of the three
// apps through a real journey with Playwright's video recorder on, adds
// on-screen captions and a visible cursor, and writes an MP4.
//
//   DEMO_OUT       where the finished MP4s go (default ./out next to this file)
//   DEMO_PASSWORD  the password of the demo logins (never committed)
//   DEMO_FFMPEG    an ffmpeg with libx264 (Playwright's own build only writes VP8)
//
// See README.md in this folder.
import { chromium, devices } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.DEMO_OUT || path.join(here, 'out');
const RAW = path.join(OUT, '.raw');
const FFMPEG = process.env.DEMO_FFMPEG || 'ffmpeg';
// DEMO_HD=1: record the real screen instead of Playwright's video. Playwright
// only ever records at the page's CSS size, so a bigger canvas is padded with
// grey. In HD mode the browser runs headful on a virtual display (Xvfb) with a
// device-pixel ratio above 1 and ffmpeg grabs the screen, so text is genuinely
// sharp: desktop 1920x1200, phone 824x1832. The page is laid out narrower than
// before (DEMO_HD_CSS_WIDTH, default 1152 CSS px), which also makes the text
// larger in the frame.
export const HD = process.env.DEMO_HD === '1';
const HD_CSS_W = Number(process.env.DEMO_HD_CSS_WIDTH || 1152);
const VIEWPORT = { desktop: { width: 1440, height: 900 }, mobile: { width: 412, height: 916 } };
const DPR = { desktop: 1, mobile: 2.625 };
/** Pixel size of the finished recordings. */
export const FRAME = HD
  ? { desktop: { width: 1920, height: 1200 }, mobile: { width: 824, height: 1832 } }
  : { desktop: { width: 1440, height: 900 }, mobile: { width: 824, height: 1832 } };
// Where the local speech server is (tts_server.py). Unset: captions only, no voice.
const TTS_URL = process.env.DEMO_TTS_URL;
// Seconds to shift the voice later (+) or earlier (-) against the picture.
const AUDIO_OFFSET = Number(process.env.DEMO_AUDIO_OFFSET || 0);
const CHROME =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const BASE = {
  office: process.env.DEMO_OFFICE_URL || 'http://localhost:3000',
  staff: process.env.DEMO_STAFF_URL || 'http://localhost:3001',
  client: process.env.DEMO_CLIENT_URL || 'http://localhost:3002',
};

export function password() {
  const p =
    process.env.DEMO_PASSWORD ||
    (process.env.DEMO_PW_FILE && fs.readFileSync(process.env.DEMO_PW_FILE, 'utf8').trim());
  if (!p) throw new Error("Set DEMO_PASSWORD (or DEMO_PW_FILE) to the demo logins' password.");
  return p;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in every document before the app's own scripts. The caption and the
// cursor position live in sessionStorage so they survive a navigation.
function overlay({ mobile }) {
  const css = `
  #__dm_cap{position:fixed;left:50%;bottom:${mobile ? 92 : 34}px;transform:translateX(-50%);width:max-content;max-width:${mobile ? 90 : 70}vw;
    background:rgba(15,23,42,.92);color:#fff;font:600 ${mobile ? 15 : 21}px/1.4 "Plus Jakarta Sans",system-ui,sans-serif;
    padding:${mobile ? '10px 16px' : '13px 26px'};border-radius:${mobile ? 16 : 18}px;text-align:center;
    box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .25s}
  #__dm_cap.on{opacity:1}
  #__dm_cur{position:fixed;left:0;top:0;width:${mobile ? 30 : 26}px;height:${mobile ? 30 : 26}px;margin:-${mobile ? 15 : 13}px 0 0 -${mobile ? 15 : 13}px;
    border-radius:50%;background:rgba(124,58,237,.45);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);
    z-index:2147483646;pointer-events:none;opacity:0;transition:transform .5s cubic-bezier(.22,.8,.25,1),opacity .2s}
  .__dm_rip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #7c3aed;
    z-index:2147483645;pointer-events:none;animation:__dm_rip .55s ease-out forwards}
  @keyframes __dm_rip{to{transform:scale(4.2);opacity:0}}`;
  const ss = (k, v) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  };
  const rd = (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const install = () => {
    if (document.getElementById('__dm_cap')) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.documentElement.appendChild(st);
    const cap = document.createElement('div');
    cap.id = '__dm_cap';
    const cur = document.createElement('div');
    cur.id = '__dm_cur';
    document.documentElement.append(cap, cur);
    const text = rd('__dm_text');
    if (text) {
      cap.textContent = text;
      cap.classList.add('on');
    }
    const pos = rd('__dm_pos');
    if (pos) {
      const [x, y] = pos.split(',');
      cur.style.transition = 'none';
      cur.style.transform = `translate(${x}px,${y}px)`;
      cur.style.opacity = '1';
      requestAnimationFrame(() => (cur.style.transition = ''));
    }
  };
  // Real people's email addresses are masked in every recording. Only the
  // example domains the demo data uses are left readable.
  const MAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
  const mask = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = n.nodeValue;
      if (!v || v.indexOf('@') < 0) continue;
      const out = v.replace(MAIL, (m, d) =>
        /(^|\.)example(\.com)?$/i.test(d) ? m : '••••••@••••••',
      );
      if (out !== v) n.nodeValue = out;
    }
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      install();
      if (document.body) mask(document.body);
    });
  };
  document.addEventListener('DOMContentLoaded', () => {
    schedule();
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  window.__demo = {
    say(t) {
      ss('__dm_text', t || '');
      const c = document.getElementById('__dm_cap');
      if (!c) return;
      if (t) {
        c.textContent = t;
        c.classList.add('on');
      } else c.classList.remove('on');
    },
    cursor(x, y) {
      ss('__dm_pos', `${x},${y}`);
      const c = document.getElementById('__dm_cur');
      if (!c) return;
      c.style.opacity = '1';
      c.style.transform = `translate(${x}px,${y}px)`;
    },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = '__dm_rip';
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

/**
 * Opens a recording browser. `kind` is 'desktop' (1440x900) or 'mobile' (a
 * Pixel 7 at 412x916). Playwright never scales a recording UP, so the video is
 * recorded at exactly the viewport size (a bigger canvas is padded with grey)
 * and the phone video is enlarged afterwards, in finish().
 */
export async function start(name, { kind = 'desktop', geolocation, permissions } = {}) {
  fs.mkdirSync(RAW, { recursive: true });
  const mobile = kind === 'mobile';
  // Browser-side calls to Supabase Storage (uploads go straight from the page)
  // need the sandbox's egress proxy; the apps themselves are on localhost.
  const proxy = process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }
    : undefined;
  const args = ['--no-sandbox'];
  // Through that proxy TLS is re-terminated under the sandbox's own CA. Trust
  // exactly that CA by its public-key hash (verification stays on for every
  // other certificate).
  const caFile =
    process.env.DEMO_PROXY_CA ||
    (process.env.NODE_EXTRA_CA_CERTS &&
      path.join(path.dirname(process.env.NODE_EXTRA_CA_CERTS), 'agent-proxy-ca.crt'));
  if (proxy && caFile && fs.existsSync(caFile)) {
    const spki = new X509Certificate(fs.readFileSync(caFile)).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    args.push(
      `--ignore-certificate-errors-spki-list=${createHash('sha256').update(spki).digest('base64')}`,
    );
  }
  if (HD) return startHd(name, { mobile, geolocation, permissions, args, proxy });
  const browser = await chromium.launch({ executablePath: CHROME, args, proxy });
  const ctx = await browser.newContext({
    ...(mobile
      ? { ...devices['Pixel 7'], viewport: VIEWPORT.mobile }
      : { viewport: VIEWPORT.desktop }),
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    geolocation,
    permissions,
    recordVideo: {
      dir: path.join(RAW, name),
      size: mobile ? VIEWPORT.mobile : VIEWPORT.desktop,
    },
  });
  await ctx.addInitScript(overlay, { mobile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  // The recording starts with the page; narration cues are timed from here.
  return { browser, ctx, page, name, mobile, t0: Date.now(), cues: [], narrate: Boolean(TTS_URL) };
}

/** HD mode: Xvfb + headful Chromium + ffmpeg x11grab (see HD above). */
async function startHd(name, { mobile, geolocation, permissions, args, proxy }) {
  const frame = FRAME[mobile ? 'mobile' : 'desktop'];
  const dpr = mobile ? 2 : frame.width / HD_CSS_W;
  const cssW = Math.round(frame.width / dpr);
  const cssH = Math.round(frame.height / dpr);
  const display = `:${90 + Math.floor(Math.random() * 8)}`;
  // Tall enough for the browser's own toolbar above the page; the grab skips it.
  const xvfb = spawn(
    'Xvfb',
    [display, '-screen', '0', `${frame.width + 40}x${frame.height + 700}x24`, '-nolisten', 'tcp'],
    { stdio: 'ignore' },
  );
  await sleep(1200);
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: [
      ...args,
      '--window-position=0,0',
      `--force-device-scale-factor=${dpr}`,
      '--hide-scrollbars',
      '--disable-infobars',
      '--no-first-run',
      '--disable-features=Translate',
    ],
    proxy,
    env: { ...process.env, DISPLAY: display },
  });
  const ctx = await browser.newContext({
    viewport: null,
    ...(mobile
      ? { userAgent: devices['Pixel 7'].userAgent, hasTouch: true, isMobile: false }
      : {}),
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    geolocation,
    permissions,
  });
  await ctx.addInitScript(overlay, { mobile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  // Size the window so the page area is exactly cssW x cssH, and find where it
  // sits on the screen (below the browser's toolbar) so the grab can crop to it.
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  const setBounds = (width, height) =>
    cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 0, top: 0, width, height, windowState: 'normal' },
    });
  const measure = () =>
    page.evaluate(() => ({ ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight }));
  await setBounds(cssW, cssH + 300);
  await sleep(500);
  let m = await measure();
  await setBounds(cssW + (m.ow - m.iw), cssH + (m.oh - m.ih));
  await sleep(500);
  m = await measure();
  const real = m;
  if (mobile) {
    // A window cannot be made as narrow as a phone, so the phone is emulated
    // inside it: a 412x916 page at 2x, drawn from the top-left of the page area.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: cssW,
      height: cssH,
      deviceScaleFactor: dpr,
      mobile: true,
      screenWidth: cssW,
      screenHeight: cssH,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(300);
    m = { ...m, iw: cssW, ih: cssH };
  } else if (m.iw !== cssW || m.ih !== cssH) {
    console.warn(`[hd] page area is ${m.iw}x${m.ih}, wanted ${cssW}x${cssH}`);
  }
  const offX = Math.round(((real.ow - real.iw) / 2) * dpr);
  const offY = Math.round((real.oh - real.ih) * dpr);
  const raw = path.join(RAW, `${name}.x11.mkv`);
  fs.rmSync(raw, { force: true });
  const grab = spawn(
    FFMPEG,
    [
      '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-stats_period', '0.05',
      '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '25',
      '-video_size', `${frame.width}x${frame.height}`, '-i', `${display}.0+${offX},${offY}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', raw,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  // The clock for the narration starts when the first frame has been captured
  // (ffmpeg reports it on its progress stream), so voice and picture line up.
  let t0 = null;
  grab.stdout.on('data', (d) => {
    if (t0 === null && /frame=\s*[1-9]/.test(String(d))) t0 = Date.now();
  });
  for (let i = 0; i < 300 && t0 === null; i++) await sleep(50);
  if (t0 === null) {
    console.warn('[hd] no frame reported by the screen grab; timing may be off');
    t0 = Date.now();
  }
  return {
    browser, ctx, page, name, mobile, hd: true, xvfb, grab, raw,
    t0, cues: [], narrate: Boolean(TTS_URL),
  };
}

async function stopHd(s) {
  await sleep(300);
  await s.ctx.close().catch(() => {});
  await s.browser.close().catch(() => {});
  await new Promise((resolve) => {
    s.grab.once('exit', resolve);
    s.grab.stdin.write('q');
    setTimeout(() => s.grab.kill('SIGINT'), 6000);
  });
  s.xvfb.kill();
  return s.raw;
}

/** Closes the browser, converts the recording to MP4 and adds the voice-over. */
export async function finish(s) {
  let src;
  if (s.hd) {
    src = await stopHd(s);
  } else {
    const video = s.page.video();
    await s.ctx.close();
    src = await video.path();
    await s.browser.close();
  }
  const dst = path.join(OUT, `${s.name}.mp4`);
  const silent = s.cues.length ? path.join(RAW, `${s.name}.video.mp4`) : dst;
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    // The phone is recorded at its real size and enlarged 2x here.
    ...(s.mobile && !s.hd ? ['-vf', 'scale=iw*2:ih*2:flags=lanczos'] : []),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-movflags',
    '+faststart',
    '-an',
    silent,
  ]);
  if (s.cues.length) addNarration(s, silent, dst);
  const mb = (fs.statSync(dst).size / 1048576).toFixed(1);
  console.log(`wrote ${dst} (${mb} MB${s.cues.length ? `, ${s.cues.length} narrated lines` : ''})`);
  return dst;
}

/** Length of a video in seconds (ffmpeg prints it on stderr when given no output). */
function videoSeconds(file) {
  let text = '';
  try {
    execFileSync(FFMPEG, ['-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    text = String(e.stderr);
  }
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  if (!m) throw new Error(`cannot read the length of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Places every narrated line at the moment its caption appeared and muxes the result. */
function addNarration(s, videoFile, dst) {
  const track = path.join(RAW, `${s.name}.voice.wav`);
  const inputs = s.cues.flatMap((c) => ['-i', c.file]);
  const delayed = s.cues.map(
    (c, i) =>
      `[${i}:a]adelay=${Math.max(0, Math.round((c.at + AUDIO_OFFSET) * 1000))}:all=1[v${i}]`,
  );
  const mix = `${s.cues.map((_, i) => `[v${i}]`).join('')}amix=inputs=${s.cues.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    [...delayed, mix].join(';'),
    '-map',
    '[out]',
    '-ar',
    '44100',
    '-ac',
    '1',
    track,
  ]);
  execFileSync(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    videoFile,
    '-i',
    track,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '112k',
    '-af',
    'apad',
    '-t',
    String(videoSeconds(videoFile)),
    '-movflags',
    '+faststart',
    dst,
  ]);
}

async function speak(text) {
  const res = await fetch(`${TTS_URL}/say`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`tts: ${res.status}`);
  return res.json();
}

/** Generate (and cache) a line ahead of time, so nothing waits on speech while a recording runs. */
export const warmSpeech = (text) => (TTS_URL ? speak(text) : null);

/**
 * Show a caption and, when a speech server is configured, say it. The caption
 * stays up for as long as the line takes to speak, so the picture is paced by the
 * voice; `hold` is the reading time the silent version used, kept at half as a
 * floor. The line is fetched (cached) BEFORE the caption appears, so there is no
 * silence while it is made.
 */
export const say = async (s, text, hold = 0) => {
  const speech = text && s.narrate ? await speak(text) : null;
  await s.page.evaluate((t) => window.__demo?.say(t), text).catch(() => {});
  let wait = hold;
  if (speech) {
    s.cues.push({ at: (Date.now() - s.t0) / 1000, file: speech.file });
    wait = Math.max(Math.round(speech.seconds * 1000) + 450, Math.round(hold / 2));
  }
  if (wait) await sleep(wait);
};
export const hush = (s) => say(s, '');

/** What a title card says aloud: "1 · Applying" is read as "Part 1: Applying". */
export const cardSpeech = (title, sub = '') =>
  `${title}. ${String(sub).replace(/^(\d+)\s*·\s*/, 'Part $1: ')}`.trim();

/**
 * A full-screen title card; segments start and end on one.
 *   eyebrow   the small line above the title (default: the company name)
 *   speech    what is said aloud, when it should not be derived from the text
 *   progress  [n, total]: a row of dots with the n-th lit, for "Part n of total"
 * `sub` may hold <br> for several lines.
 */
export async function card(
  s,
  title,
  sub = '',
  hold = 3200,
  { eyebrow = 'The Hospitality Company', speech: spoken, progress } = {},
) {
  const speech = s.narrate ? await speak(spoken ?? cardSpeech(title, sub)) : null;
  const dots = progress
    ? `<div style="margin:1.1em 0 .2em;display:flex;gap:${s.mobile ? 8 : 12}px;justify-content:center">${Array.from(
        { length: progress[1] },
        (_, k) =>
          `<i style="width:${s.mobile ? 10 : 14}px;height:${s.mobile ? 10 : 14}px;border-radius:50%;background:#fff;opacity:${k + 1 === progress[0] ? 1 : k + 1 < progress[0] ? 0.55 : 0.22}"></i>`,
      ).join('')}</div>`
    : '';
  await s.page.goto('about:blank');
  await s.page
    .setContent(`<!doctype html><meta charset=utf-8><body style="margin:0;height:100vh;display:grid;place-items:center;
    background:linear-gradient(135deg,#0f172a,#312e81 60%,#7c3aed);color:#fff;font-family:'Plus Jakarta Sans',system-ui,sans-serif;text-align:center">
    <div style="padding:0 8vw"><div style="letter-spacing:.3em;font-size:${s.mobile ? 11 : 14}px;opacity:.7;text-transform:uppercase">${eyebrow}</div>${dots}
    <h1 style="font-size:${s.mobile ? 34 : 64}px;margin:.4em 0 .2em;line-height:1.1">${title}</h1>
    <p style="font-size:${s.mobile ? 16 : 26}px;opacity:.85;margin:0;line-height:1.5">${sub}</p></div>`);
  let wait = hold;
  if (speech) {
    s.cues.push({ at: (Date.now() - s.t0) / 1000, file: speech.file });
    wait = Math.max(hold, Math.round(speech.seconds * 1000) + 700);
  }
  await sleep(wait);
}

/** Go to a path on an app and let it settle. */
export async function go(s, app, p, { wait = 1200 } = {}) {
  await s.page.goto(BASE[app] + p, { waitUntil: 'domcontentloaded' });
  await s.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(wait);
}

async function center(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('target has no box');
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(b.height / 2, 24)) };
}

/** Move the visible cursor to a target. */
export async function point(s, target, settle = 350) {
  const { x, y } = await center(target.first());
  await s.page.evaluate(([a, b]) => window.__demo?.cursor(a, b), [x, y]);
  await sleep(550 + settle);
  return { x, y };
}

/** Move to, ripple on, and click (or tap) a target. */
export async function press(s, target, { after = 900 } = {}) {
  const loc = target.first();
  const { x, y } = await point(s, loc);
  await s.page.evaluate(([a, b]) => window.__demo?.ripple(a, b), [x, y]);
  if (s.mobile) await loc.tap();
  else await loc.click();
  await sleep(after);
}

/** Type into a field at a readable pace. */
export async function type(s, target, text, { delay = 55, secret = false } = {}) {
  const loc = target.first();
  await point(s, loc, 150);
  await loc.click();
  // Some fields arrive pre-filled (the bank form offers the worker's name), so
  // start from empty rather than typing on top of what is there.
  await loc.fill('');
  if (secret) await loc.fill(text);
  else await loc.pressSequentially(text, { delay });
  await sleep(350);
}

/** Smooth-scroll the page by some pixels. */
export async function scroll(s, px, { steps = 12, pause = 900 } = {}) {
  for (let i = 0; i < steps; i++) {
    await s.page.mouse.wheel(0, px / steps);
    await sleep(45);
  }
  await sleep(pause);
}

/** Signs in on /login as one of the demo accounts. */
export async function login(s, app, email) {
  await go(s, app, '/login');
  await type(s, s.page.getByLabel('Email'), email);
  await type(s, s.page.getByLabel('Password'), password(), { secret: true });
  await press(s, s.page.getByRole('button', { name: /^sign in$/i }), { after: 600 });
  await s.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await s.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(1000);
}

/** Run an optional step; a missing element logs a warning instead of ending the recording. */
export async function soft(label, fn, { retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (attempt < retries) {
        await sleep(1500);
        continue;
      }
      console.warn(`[skipped] ${label}: ${String(e.message).split('\n')[0]}`);
      return;
    }
  }
}

/** A tab or sub-navigation control, whatever element the screen made it. */
export const tab = (s, name) =>
  s.page
    .getByRole('tab', { name })
    .or(s.page.getByRole('link', { name }))
    .or(s.page.getByRole('button', { name }))
    .first();

/** Left-hand menu item in the Back Office. */
// Some items carry a count badge ("Compliance 3"), so the name is matched up to it.
export const menu = (s, name) =>
  s.page
    .getByRole('link', {
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s+\\d+)?$`),
    })
    .first();

/** The next Friday after today, as yyyy-mm-dd: the day the seeded upcoming events fall on. */
export function nextFriday(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 6) % 7) + 1);
  return d.toISOString().slice(0, 10);
}

// ── Talking to the demo database ─────────────────────────────────────────
// Used only where the real trigger is an outside system that is not part of
// the recording (for example Willo's webhook). The service key is read from
// the office app's git-ignored .env.local, so it never appears in a script.
function serviceEnv() {
  const file = path.resolve(here, '../../apps/office/.env.local');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function api(method, route, body) {
  const { url, key } = serviceEnv();
  const res = await fetch(`${url}/rest/v1/${route}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
export const rpc = (name, args) => api('POST', `rpc/${name}`, args);
export const rest = (route) => api('GET', route);

/** The fictional candidate the onboarding series follows, on an alias of the owner's email. */
export const CANDIDATE = {
  first: 'Jordan',
  last: 'Ellis',
  email: process.env.DEMO_CANDIDATE_EMAIL || 'saveezirfan+jordan@gmail.com',
  mobile: '7700 900321',
  dob: '14032000',
};

/**
 * A fresh one-time activation link for a candidate's login, minted the way the
 * office's Accept / Resend does (GoTrue admin generateLink). The emailed link
 * is single-use and its copy in the outbox is redacted once sent, so a
 * recording cannot read it back; minting replaces the earlier token.
 */
export async function mintActivationLink(email, origin = BASE.staff) {
  const { url, key } = serviceEnv();
  const gen = async (type) => {
    const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, email }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, token: body?.hashed_token ?? body?.properties?.hashed_token, body };
  };
  // `invite` for a login that was never confirmed; `magiclink` (what a returning
  // applicant gets) once it has been. The activation page takes either.
  let r = await gen('invite');
  if (r.ok && r.token) return `${origin}/activate/${r.token}`;
  r = await gen('magiclink');
  if (r.ok && r.token) return `${origin}/activate/${r.token}?type=magiclink`;
  throw new Error(`generate_link: ${JSON.stringify(r.body).slice(0, 200)}`);
}

export const patch = (route, body) => api('PATCH', route, body);
export const del = (route) => api('DELETE', route);

export function candidatePassword() {
  const f = process.env.DEMO_CANDIDATE_PW_FILE;
  if (process.env.DEMO_CANDIDATE_PASSWORD) return process.env.DEMO_CANDIDATE_PASSWORD;
  if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  throw new Error('Set DEMO_CANDIDATE_PASSWORD (or DEMO_CANDIDATE_PW_FILE).');
}

// ── Sample files for uploads and the selfie ──────────────────────────────
// Generated here so nothing binary is committed and no real document or face
// is ever used. Every document is plainly marked as a sample.
const sampleDoc = (
  title,
  rows,
) => `<!doctype html><meta charset=utf-8><body style="margin:0;width:1000px;height:680px;position:relative;overflow:hidden;
  background:linear-gradient(135deg,#eef2f7,#dfe7f1);font-family:'DejaVu Sans',sans-serif;color:#1f2937">
  <div style="position:absolute;inset:26px;border:3px solid #94a3b8;border-radius:22px;padding:36px 44px">
    <div style="font-size:22px;letter-spacing:.3em;color:#64748b">SAMPLE DOCUMENT · DEMO ONLY</div>
    <div style="font-size:54px;font-weight:700;margin:14px 0 26px">${title}</div>
    ${rows.map(([k, v]) => `<div style="display:flex;font-size:30px;margin:10px 0"><div style="width:300px;color:#64748b">${k}</div><div style="font-weight:600">${v}</div></div>`).join('')}
  </div>
  <div style="position:absolute;left:-60px;top:290px;width:1120px;text-align:center;transform:rotate(-14deg);font-size:120px;font-weight:800;color:rgba(220,38,38,.16);letter-spacing:.1em">SAMPLE</div>`;

const avatar = `<!doctype html><meta charset=utf-8><body style="margin:0;width:640px;height:480px;background:linear-gradient(160deg,#cbd5e1,#e2e8f0);position:relative;overflow:hidden">
  <div style="position:absolute;left:230px;top:70px;width:180px;height:210px;border-radius:50%;background:#64748b"></div>
  <div style="position:absolute;left:110px;top:300px;width:420px;height:340px;border-radius:50% 50% 0 0;background:#64748b"></div>
  <div style="position:absolute;bottom:14px;width:100%;text-align:center;font:600 18px 'DejaVu Sans';color:#475569;letter-spacing:.2em">SAMPLE PHOTO</div>`;

export async function ensureAssets() {
  const dir = path.join(OUT, '.assets');
  const out = {
    dir,
    selfie: path.join(dir, 'selfie.png'),
    passport: path.join(dir, 'sample-passport.png'),
    nationalId: path.join(dir, 'sample-id.png'),
    niProof: path.join(dir, 'sample-ni-letter.png'),
  };
  if (Object.values(out).every((p) => p === dir || fs.existsSync(p))) return out;
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
  const shot = async (html, file, w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(html);
    await page.screenshot({ path: file });
  };
  await shot(
    sampleDoc('Passport', [
      ['Surname', 'ELLIS'],
      ['Given names', 'JORDAN'],
      ['Date of birth', '14 MAR 2000'],
      ['Document no.', '000000000'],
      ['Expiry', '12 JAN 2031'],
    ]),
    out.passport,
    1000,
    680,
  );
  await shot(
    sampleDoc('National ID', [
      ['Surname', 'ELLIS'],
      ['Given names', 'JORDAN'],
      ['Date of birth', '14 MAR 2000'],
      ['Document no.', '000000000'],
      ['Expiry', '12 JAN 2031'],
    ]),
    out.nationalId,
    1000,
    680,
  );
  await shot(
    sampleDoc('Letter showing NI number', [
      ['Name', 'JORDAN ELLIS'],
      ['NI number', 'QQ 12 34 56 C'],
      ['Issued', '02 FEB 2026'],
    ]),
    out.niProof,
    1000,
    680,
  );
  await shot(avatar, out.selfie, 640, 480);
  await browser.close();
  return out;
}

/** Press something that opens the phone's file / camera picker, and answer it with a file. */
export async function chooseFile(s, target, file, { after = 1800 } = {}) {
  const [chooser] = await Promise.all([
    s.page.waitForEvent('filechooser'),
    press(s, target, { after: 300 }),
  ]);
  await chooser.setFiles(file);
  await sleep(after);
}

/** Supabase Storage with the service key (used only to tidy up after a recording). */
export async function storageApi(method, route, body) {
  const { url, key } = serviceEnv();
  const res = await fetch(`${url}/storage/v1/${route}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} storage/${route}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
