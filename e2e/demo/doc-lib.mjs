// Shows a rendered PDF page full-width in the recorder, with highlight boxes
// the script moves from one column to the next. Regions are fractions of the page
// (x0, y0, x1, y1), read off the rendered PNG.
import fs from 'node:fs';
import { sleep } from './lib.mjs';

export async function showDoc(s, png) {
  const b64 = fs.readFileSync(png).toString('base64');
  await s.page.goto('about:blank');
  await s.page.setContent(`<!doctype html><meta charset=utf-8><body style="margin:0;height:100vh;overflow:hidden;background:#c9ced6;display:flex;justify-content:center">
    <div id="dw" style="position:relative;width:min(880px,90vw);margin-top:12px;align-self:flex-start;background:#fff;box-shadow:0 10px 34px rgba(0,0,0,.4)">
      <img src="data:image/png;base64,${b64}" style="width:100%;display:block">
      <div id="hl" style="position:absolute;border:4px solid #7c3aed;background:rgba(124,58,237,.14);border-radius:8px;box-shadow:0 0 0 9999px rgba(15,23,42,.30);opacity:0;transition:all .45s ease"></div>
    </div></body>`);
  await sleep(700);
}

/** Moves the highlight to a region, or hides it with null. */
export async function box(s, region, after = 600) {
  await s.page.evaluate((r) => {
    const el = document.getElementById('hl');
    if (!r) {
      el.style.opacity = '0';
      return;
    }
    const [x0, y0, x1, y1] = r;
    el.style.left = `${x0 * 100}%`;
    el.style.top = `${y0 * 100}%`;
    el.style.width = `${(x1 - x0) * 100}%`;
    el.style.height = `${(y1 - y0) * 100}%`;
    el.style.opacity = '1';
  }, region);
  await sleep(after);
}

// The form's columns and bands, as fractions of the page (908 x 1284 at 110 dpi).
export const COL = {
  photo: [0.047, 0.107, 0.108, 0.143],
  name: [0.108, 0.107, 0.327, 0.143],
  start: [0.327, 0.107, 0.421, 0.143],
  finish: [0.421, 0.107, 0.495, 0.143],
  signature: [0.495, 0.107, 0.616, 0.143],
  comments: [0.616, 0.107, 0.753, 0.143],
  hours: [0.753, 0.107, 0.827, 0.143],
  alcohol: [0.827, 0.107, 0.954, 0.143],
};
export const HEADER = [0.047, 0.03, 0.955, 0.09];
export const TITLE_ROW = [0.047, 0.083, 0.955, 0.101];
export const PO = [0.8, 0.083, 0.955, 0.101];
export const FOOTER_LUNCH = [0.047, 0.402, 0.955, 0.456];
export const ROW_CHLOE = [0.047, 0.161, 0.955, 0.2];
export const ROW_ISLA = [0.047, 0.312, 0.955, 0.351];
export const FINISH_COL_ROWS = [0.421, 0.107, 0.495, 0.39];
export const HOURS_COL_ROWS = [0.753, 0.107, 0.827, 0.39];
export const GALA_BAND_WS = [0.047, 0.328, 0.955, 0.35];
export const GALA2_TITLE = [0.047, 0.083, 0.955, 0.101];
export const GALA2_FOOTER = [0.047, 0.212, 0.955, 0.265];
