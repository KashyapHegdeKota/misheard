// Shared helpers for the end-to-end checks (see README.md, "Checking the site").
// Everything the checks expect comes from the files the build derived from clips.json
// (generated/site.json, public/data/points.json), never from numbers written in here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.BASE || 'http://localhost:3000'; // `npm run preview` serves here
export const ROOT = process.env.ROOT || path.resolve(HERE, '..');
export const OUT = process.env.OUT || path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
export const site = JSON.parse(fs.readFileSync(`${ROOT}/generated/site.json`, 'utf8'));
export const pointsFile = JSON.parse(fs.readFileSync(`${ROOT}/public/data/points.json`, 'utf8'));
export const points = pointsFile.points;
export const models = site.meta.models;
export const primary = site.meta.primary_model;

export const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
/** Informational: reports a fact about the data without failing the run. */
export function note(name, detail = '') {
  console.log(`NOTE  ${name}${detail ? '  — ' + detail : ''}`);
}
export const summarize = () => {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  return failed.length;
};

export const AUDIO_HOOK = () => {
  window.__audios = [];
  const track = (a) => { window.__audios.push(a); return a; };
  const NativeAudio = window.Audio;
  window.Audio = function (...args) { return track(new NativeAudio(...args)); };
  window.Audio.prototype = NativeAudio.prototype;
  const nativeCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) {
    const el = nativeCreate.call(this, tag, ...rest);
    if (String(tag).toLowerCase() === 'audio') track(el);
    return el;
  };
  window.__audioState = () => window.__audios.map((a) => ({ src: a.currentSrc || a.src, paused: a.paused, t: a.currentTime, d: a.duration, ended: a.ended }));
};

export async function launch(opts = {}, extraArgs = []) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', ...extraArgs] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(AUDIO_HOOK);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  return { browser, ctx, page, errors };
}

export const scrollTo = (page, sel, offset = -40) =>
  page.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + o, behavior: 'instant' }); }, [sel, offset]);

export const audioState = (page) => page.evaluate(() => window.__audioState());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Count vivid (colored) and red pixels in a PNG buffer, by drawing it on a canvas in the page. */
export async function pixelStats(page, buf) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let vivid = 0, red = 0, green = 0, grey = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mx > 170 && mx - mn > 70) {
        vivid++;
        if (r > 200 && gg < 120) red++;
        if (gg > 170 && r < 150) green++;
      } else if (mx > 90 && mx - mn < 30) grey++;
    }
    return { vivid, red, green, grey };
  }, buf.toString('base64'));
}
