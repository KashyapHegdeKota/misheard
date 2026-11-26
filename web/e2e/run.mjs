// End-to-end checks for the built site. Usage (after `npm run build`, with `npm run preview` running):
//   node e2e/run.mjs [load] [motion] [karaoke] [findings] [static] [map] [nav] [keyboard] [worst] [mobile] [nowebgl]
// With no arguments every suite runs. See README.md, "Checking the site".
import { BASE, OUT, site, points, models, primary, check, note, summarize, launch, scrollTo, audioState, sleep, pixelStats } from './lib.mjs';

const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);
const isSample = site.isSample;

const fmtPct = (w) => (Math.abs(w * 100) < 10 ? `${(w * 100).toFixed(1)}%` : `${Math.round(w * 100)}%`);
const fmtPct1 = (w) => `${(w * 100).toFixed(1)}%`;
const fmtInt = (n) => n.toLocaleString('en-US');

// ───────────────────────────── load, hero, network ─────────────────────────────
async function testLoad() {
  console.log('\n## load, hero, network');
  const { browser, page, errors } = await launch();
  const reqs = [];
  page.on('request', (r) => reqs.push({ url: r.url(), t: Date.now() }));
  const jsBodies = new Map();
  page.on('response', async (r) => { if (r.url().endsWith('.js')) { try { jsBodies.set(r.url(), (await r.text()).length); } catch {} } });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const h1 = await page.textContent('h1');
  check('hero headline text', h1.trim() === 'Speech models mishear real conversations.', h1);
  const sub = (await page.textContent('header p:nth-of-type(2)')).replace(/\s+/g, ' ').trim();
  const h = site.summary.headline;
  const verbExpected = h.to_wer >= h.from_wer ? 'jumps' : 'falls';
  check('hero subline built from summary.headline', sub.includes(fmtPct(h.from_wer)) && sub.includes(fmtPct(h.to_wer)) && sub.includes(verbExpected) && sub.endsWith('when two people talk at once.'), sub);
  const buttons = await page.$$eval('header a.btn, header button.btn', (els) => els.map((e) => e.textContent.trim()));
  check('hero has the two buttons', buttons.includes('Explore the map') && buttons.includes('Hear the worst 10'), JSON.stringify(buttons));
  const exploreHref = await page.getAttribute('header a.btn', 'href');
  check('"Explore the map" targets #map', exploreHref === '#map');

  // network: nothing heavy before interaction
  const urls = reqs.map((r) => r.url);
  check('no audio fetched on load', !urls.some((u) => /\/audio(-sample)?\//.test(u) || /\.(mp3|wav)(\?|$)/.test(u)));
  check('no per-clip json fetched on load', !urls.some((u) => u.includes('/data/clip/')));
  check('clips.json / sample json not fetched by the page', !urls.some((u) => /clips(\.sample)?\.json/.test(u)));
  check('points.json fetched', urls.some((u) => u.endsWith('/data/points.json')));
  const mapChunks = [...jsBodies.entries()].filter(([, len]) => len > 0);
  const total0 = mapChunks.reduce((a, [, l]) => a + l, 0);
  console.log(`   initial JS: ${mapChunks.length} files, ${(total0 / 1024).toFixed(0)} KB uncompressed`);

  // first paint ordering
  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
    const pts = performance.getEntriesByType('resource').find((e) => e.name.endsWith('/data/points.json'));
    return { fcp, pointsStart: pts?.startTime, pointsEnd: pts?.responseEnd, bytes: pts?.encodedBodySize, decoded: pts?.decodedBodySize };
  });
  check('points.json is requested after first paint', paint.fcp !== undefined && paint.pointsStart > paint.fcp, `FCP ${paint.fcp?.toFixed(0)} ms, points.json starts ${paint.pointsStart?.toFixed(0)} ms (${(paint.decoded / 1024).toFixed(0)} KB)`);

  // hero canvas: dots drawn, and drifting
  const hash = () => page.evaluate(() => {
    const c = document.querySelector('header canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let hsh = 0, lit = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 40) lit++; }
    for (let i = 0; i < d.length; i += 53) hsh = (hsh * 31 + d[i]) | 0;
    return { hsh, lit, w: c.width, h: c.height };
  });
  const a = await hash();
  await page.waitForTimeout(5000);
  const b = await hash();
  check('hero canvas has glowing dots drawn', a.lit > 20000, `${a.lit} lit pixels of ${a.w}x${a.h}`);
  check('hero dots drift (canvas changes over time)', a.hsh !== b.hsh);
  await page.screenshot({ path: `${OUT}/e2e-hero.png` });

  // deck.gl is not in the initial bundle: it loads when the map approaches
  await scrollTo(page, '#hear');
  await page.waitForTimeout(800);
  const before = new Set(jsBodies.keys());
  await scrollTo(page, '#map');
  await page.waitForTimeout(3500);
  const newJs = [...jsBodies.entries()].filter(([u]) => !before.has(u));
  const newBytes = newJs.reduce((s, [, l]) => s + l, 0);
  check('map code (deck.gl) loads only when the map nears', newBytes > 200000, `${newJs.length} new JS files, ${(newBytes / 1024).toFixed(0)} KB after scrolling to the map (vs ${(total0 / 1024).toFixed(0)} KB initially)`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await page.getByRole('link', { name: 'Explore the map' }).click();
  await page.waitForTimeout(2200); // smooth scroll
  const mapTop = await page.evaluate(() => Math.round(document.querySelector('#map').getBoundingClientRect().top));
  check('"Explore the map" scrolls the map into view', Math.abs(mapTop) < 140, `#map top is ${mapTop}px from the top of the window`);
  check('banner state matches data source', (await page.locator('text=Sample data').count() > 0) === isSample, isSample ? 'sample banner shown' : 'no banner');
  check('no page errors on load', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function testReducedMotion() {
  console.log('\n## reduced motion');
  const { browser, page, errors } = await launch({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const hash = () => page.evaluate(() => {
    const c = document.querySelector('header canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0, lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) lit++;
    for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0;
    return { h, lit };
  });
  const a = await hash();
  await page.waitForTimeout(4000);
  const b = await hash();
  check('reduced motion: hero dots are drawn but static', a.lit > 20000 && a.h === b.h, `lit=${a.lit}`);
  const anim = await page.evaluate(() => { const t = document.querySelector('h1'); const cs = getComputedStyle(t); return { name: cs.animationName, dur: cs.animationDuration }; });
  check('reduced motion: entrance animation neutralised', parseFloat(anim.dur) < 0.01, JSON.stringify(anim));
  await scrollTo(page, '#findings');
  await page.waitForTimeout(1500);
  const op = await page.evaluate(() => [...document.querySelectorAll('#findings [data-reveal]')].map((e) => getComputedStyle(e).opacity));
  check('reduced motion: revealed sections are visible', op.every((o) => o === '1'), op.join(','));
  check('reduced motion: no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ───────────────────────────── karaoke ─────────────────────────────
async function testKaraoke() {
  console.log('\n## karaoke');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await scrollTo(page, '#hear');
  await page.waitForTimeout(1500);
  const clip = site.karaoke;
  const modelId = clip.results[primary] ? primary : Object.keys(clip.results)[0];
  const ops = clip.results[modelId].ops;
  const toks = await page.$$eval('#hear [data-op]', (els) => els.map((e) => ({ op: e.dataset.op, start: +e.dataset.start, end: +e.dataset.end, state: e.dataset.state, fix: e.querySelector('[class*="fix"]')?.textContent ?? '', word: e.querySelector('[class*="word"]')?.textContent ?? '', hasGap: !!e.querySelector('[class*="gap"]') })));
  check('karaoke: one token per alignment op', toks.length === ops.length, `${toks.length} tokens / ${ops.length} ops`);
  check('karaoke: ops in order', toks.every((t, i) => t.op === ops[i].op));
  let r = 0, okText = true, okTime = true;
  toks.forEach((t, i) => {
    const o = ops[i];
    if (o.op === 'sub') okText &&= t.fix === o.ref && t.word === o.hyp;
    if (o.op === 'del') okText &&= t.fix === o.ref && t.hasGap;
    if (o.op === 'ins') okText &&= t.fix.toLowerCase() === 'extra' && t.word === o.hyp;
    if (o.op === 'equal') okText &&= t.word === o.ref;
    if (o.op !== 'ins') { const w = clip.words[r++]; okTime &&= Math.abs(t.start - w.start) < 0.002 && Math.abs(t.end - w.end) < 0.002; }
  });
  check('karaoke: marks (wrong word red, right word above; gap; extra) match the alignment', okText);
  check('karaoke: token timing equals words[]', okTime);
  const kinds = new Set(toks.map((t) => t.op));
  note('karaoke clip contains these kinds of operation', [...kinds].join(', '));
  check('karaoke: before play every word is dimmed ("ghost")', toks.every((t) => t.state === 'ghost'));
  const playBtn = page.locator('#hear button[aria-label="Play the clip"]');
  check('karaoke: obvious play control exists', await playBtn.isVisible());
  const bb = await playBtn.boundingBox();
  check('karaoke: play button is large (touch friendly)', bb.width >= 56 && bb.height >= 56, `${bb.width}x${bb.height}`);
  check('karaoke: no audio fetched before pressing play', (await audioState(page)).length === 0);
  await page.screenshot({ path: `${OUT}/e2e-karaoke-before.png` });

  await playBtn.click();
  // sample audio clock and token state on every animation frame
  const samples = await page.evaluate(async () => {
    const audio = window.__audios.find((a) => /audio/.test(a.src));
    const toks = [...document.querySelectorAll('#hear [data-op]')].map((e) => ({ e, s: +e.dataset.start, en: +e.dataset.end }));
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 9000) {
      await new Promise((r) => requestAnimationFrame(r));
      out.push({ t: audio.currentTime, paused: audio.paused, ended: audio.ended, st: toks.map((k) => k.e.dataset.state) });
      if (audio.ended) break;
    }
    return out;
  });
  const maxT = Math.max(...samples.map((s) => s.t));
  check('karaoke: audio actually plays and advances', maxT > clip.duration - 0.6, `reached ${maxT.toFixed(2)}s of ${clip.duration}s`);
  let mismatches = 0, sawActive = false, checked = 0;
  const tol = 0.12;
  for (const s of samples) {
    toks.forEach((k, i) => {
      const exp = s.t >= k.end ? 'done' : s.t >= k.start ? 'active' : 'ghost';
      if (s.st[i] === 'active') sawActive = true;
      if (Math.abs(s.t - k.start) < tol || Math.abs(s.t - k.end) < tol) return;
      checked++;
      if (s.st[i] !== exp) mismatches++;
    });
  }
  check('karaoke: words light up in sync with the audio clock (±120 ms)', mismatches === 0 && sawActive, `${checked} comparisons, ${mismatches} mismatches over ${samples.length} frames`);
  await page.waitForTimeout(600);
  const after = await page.$$eval('#hear [data-op]', (els) => els.map((e) => e.dataset.state));
  check('karaoke: after the clip ends every word is lit', after.every((s) => s === 'done'), after.join(','));
  await page.screenshot({ path: `${OUT}/e2e-karaoke-after.png` });

  // replay + scrub
  await playBtn.click().catch(() => {});
  await page.waitForTimeout(1200);
  const scrub = page.locator('#hear input[type=range]');
  await scrub.focus();
  const dur = clip.duration;
  await scrub.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, String(dur * 0.5));
  await page.waitForTimeout(400);
  const st2 = await page.$$eval('#hear [data-op]', (els) => els.map((e) => ({ s: +e.dataset.start, en: +e.dataset.end, st: e.dataset.state })));
  const half = dur * 0.5;
  const scrubOk = st2.every((k) => (Math.abs(half - k.s) < 0.6 ? true : (half >= k.en ? k.st === 'done' : half < k.s ? k.st === 'ghost' : true)));
  check('karaoke: scrubbing re-times the transcript', scrubOk);
  check('karaoke: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ───────────────────────────── findings ─────────────────────────────
async function testFindings() {
  console.log('\n## findings');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await scrollTo(page, '#findings');
  await page.waitForTimeout(2200);
  const cards = page.locator('[data-finding]');
  const n = await cards.count();
  check('findings: one card per finding in the data', n === site.summary.findings.length, `${n} cards`);
  if (n !== 3) note('the layout is designed for exactly 3 findings', `the data has ${n}`);
  for (let i = 0; i < n; i++) {
    const f = site.summary.findings[i];
    const card = cards.nth(i);
    check(`finding ${f.key}: title and stat come from the data`, (await card.locator('h3').textContent()) === f.title && (await card.locator('p[class*="stat"]').textContent()).trim() === f.stat.trim());
    const bars = await card.locator('svg rect').count();
    const main = f.chart.series.find((s) => s.model === primary) ?? f.chart.series[0];
    check(`finding ${f.key}: chart has one bar per data point`, bars === main.points.length, `${bars} bars / ${main.points.length} points`);
    const vals = await card.locator('svg text[class*="value"]').allTextContents();
    check(`finding ${f.key}: bar labels are the data's WERs`, JSON.stringify(vals) === JSON.stringify(main.points.map((p) => fmtPct(p.wer))), vals.join(' '));
  }
  // play each example, one at a time
  for (let i = 0; i < n; i++) {
    const f = site.summary.findings[i];
    const exp = site.briefs[f.example_clip];
    const btn = cards.nth(i).locator('button[aria-label^="Play an example clip"]');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(1400);
    const st = await audioState(page);
    const playing = st.filter((a) => !a.paused);
    check(`finding ${f.key}: example clip plays (${exp.audio})`, playing.length === 1 && playing[0].src.endsWith('/' + exp.audio) && playing[0].t > 0.4, JSON.stringify(playing.map((p) => [p.src.split('/').pop(), p.t.toFixed(2)])));
    const label = await cards.nth(i).locator('button[aria-label*="example clip"]').getAttribute('aria-label');
    check(`finding ${f.key}: play button relabels to Pause while playing`, label.startsWith('Pause'), label);
  }
  const stEnd = await audioState(page);
  check('findings: starting one example pauses the previous (one at a time)', stEnd.filter((a) => !a.paused).length === 1);
  check('findings: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ───────────────────────────── table, recommendations, footer ─────────────────────────────
async function testStatic() {
  console.log('\n## face-off, recommendations, footer');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await scrollTo(page, '#faceoff');
  await page.waitForTimeout(1500);
  const bc = site.summary.by_condition;
  const rows = await page.$$eval('#faceoff tbody tr', (trs) => trs.map((tr) => ({ model: tr.querySelector('th').textContent.trim(), cells: [...tr.querySelectorAll('td')].map((td) => ({ text: td.textContent.replace(/\s+/g, ' ').trim(), bg: getComputedStyle(td).backgroundColor })) })));
  check('table: one row per model', rows.length === models.length && rows.every((r, i) => r.model === models[i].label), rows.map((r) => r.model).join(' | '));
  const heads = await page.$$eval('#faceoff thead th', (ths) => ths.map((t) => t.textContent.trim()));
  check('table: conditions across the top', ['Clean', 'Noisy', 'Overlapping', 'Accented'].filter((c) => Object.values(bc).some((row) => row[c.toLowerCase()] && row[c.toLowerCase()].wer !== undefined)).every((c) => heads.includes(c)), heads.join(' | '));
  const cols = ['clean', 'noisy', 'overlapping', 'accented', 'all'].filter((k) => Object.values(bc).some((row) => row[k] && row[k].wer !== undefined));
  let okVals = true, okN = true;
  let emptyCells = 0;
  rows.forEach((r, ri) => r.cells.forEach((c, ci) => {
    const cell = bc[models[ri].id][cols[ci]];
    if (!cell || cell.wer === undefined) { emptyCells++; okVals &&= c.text === '–'; return; }
    okVals &&= c.text.startsWith(fmtPct1(cell.wer));
    okN &&= c.text.includes(`n=${fmtInt(cell.n)}`);
  }));
  check('table: every cell equals summary.by_condition (empty cells show a dash)', okVals, emptyCells ? `${emptyCells} empty cell(s) rendered as "–"` : '');
  check('table: n shown in each cell', okN);
  // shading monotonic: redder (higher R share, lower G) as WER rises
  const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const flat = [];
  rows.forEach((r, ri) => r.cells.forEach((c, ci) => { const w = bc[models[ri].id][cols[ci]]?.wer; if (w !== undefined) flat.push({ wer: w, rgb: parse(c.bg) }); }));
  flat.sort((a, b) => a.wer - b.wer);
  const gr = flat.map((f) => f.rgb[1] - f.rgb[0]); // green minus red: should fall as WER rises
  let inversions = 0; for (let i = 1; i < gr.length; i++) if (gr[i] > gr[i - 1] + 6) inversions++;
  check('table: cell shading follows the green→red scale', inversions <= 1 && gr[0] > gr[gr.length - 1], `g-r from ${gr[0].toFixed(0)} (lowest WER) to ${gr[gr.length - 1].toFixed(0)} (highest), ${inversions} inversions`);
  await page.screenshot({ path: `${OUT}/e2e-table.png` });

  await scrollTo(page, '#data');
  await page.waitForTimeout(1800);
  const items = await page.$$eval('#data ol > li', (lis) => lis.map((li) => ({ kind: li.querySelector('h3').textContent.trim(), evidence: li.querySelector('[role=group] p:nth-of-type(2)').textContent.trim(), hasLink: !!li.querySelector('aside a[href="#map"]') })));
  check('recommendations: one item per finding, evidence from the findings', items.length === site.summary.findings.length && items.every((it, i) => it.evidence === site.summary.findings[i].stat.trim()), items.map((i) => i.kind).join(' | '));

  await scrollTo(page, '#method');
  await page.waitForTimeout(800);
  const foot = await page.textContent('footer');
  check('footer: dataset line from meta (with license text)', foot.includes(site.meta.dataset));
  check('footer: metric line from meta', foot.includes(site.meta.metric));
  check('footer: every model label from meta', models.every((m) => foot.includes(m.label)));
  check('footer: author line verbatim', foot.includes('Built by Kashyap Hegde Kota, CVPR 2026 co-author who built offline speech tagging at ~120 ms.'));
  const gh = await page.$$eval('footer a', (as) => as.map((a) => a.href));
  check('footer: GitHub link', gh.includes('https://github.com/KashyapHegdeKota/misheard'), gh.join(' '));
  const visible = await page.evaluate(() => document.body.innerText);
  const imgs = await page.locator('img, picture, svg image').count();
  check('page is company-neutral: no logos or images, no email addresses in the text', imgs === 0 && !/[\w.+-]+@[\w-]+\.[\w.]+/.test(visible), `${imgs} images`);
  check('face-off/footer: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}


// ───────────────────────────── map ─────────────────────────────
function dotGeometry(rect) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1, PAD = 36;
  const scale = Math.min((rect.width - PAD * 2) / spanX, (rect.height - PAD * 2) / spanY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return points.map((p) => ({ id: p.id, x: rect.x + rect.width / 2 + (p.x - cx) * scale, y: rect.y + rect.height / 2 - (p.y - cy) * scale }));
}
function isolatedDot(geo, rect, avoid = () => false) {
  let best = null, bestD = 0;
  for (const g of geo) {
    if (g.x < rect.x + 120 || g.x > rect.x + rect.width - 120 || g.y < rect.y + 80 || g.y > rect.y + rect.height - 80 || avoid(g)) continue;
    let d = Infinity;
    for (const o of geo) if (o !== g) d = Math.min(d, Math.hypot(o.x - g.x, o.y - g.y));
    if (d > bestD) { bestD = d; best = g; }
  }
  return { ...best, gap: bestD };
}
const countText = (page) => page.textContent('[data-testid=map-count]').then((t) => t.replace(/\s+/g, ' ').trim());

async function testMap() {
  console.log('\n## map');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await scrollTo(page, '#map', 700);
  await page.waitForSelector('[data-testid=map-stage] canvas', { timeout: 20000 });
  await scrollTo(page, '[data-testid=map-stage]', -60);
  await page.waitForTimeout(3000);
  const stage = page.locator('[data-testid=map-stage]');
  const shot = async (name) => { const buf = await stage.screenshot({ path: `${OUT}/e2e-${name}.png` }); return pixelStats(page, buf); };
  const total = points.length;
  check('map: deck.gl canvas rendered', (await page.locator('[data-testid=map-stage] canvas').count()) === 1);
  const t0 = await countText(page);
  check('map: count shows all clips initially', t0.startsWith(`${fmtInt(total)} of ${fmtInt(total)} clips`), t0);
  const base = await shot('map-all');
  check('map: dots are drawn (vivid colored pixels)', base.vivid > 5000, JSON.stringify(base));

  // filters: counts must equal what the data says, and the dots on screen must change
  const chip = (label) => page.locator('[aria-pressed]').filter({ hasText: new RegExp('^' + label) }).first();
  const expect = (fn) => points.filter(fn).length;
  const filters = [
    ['High', (p) => p.noise === 'high', 'noise'],
    ['Overlapping speech', (p) => p.overlap === true, 'overlap'],
    ['Non-native', (p) => p.accent === 'non-native', 'accent'],
    ['Fast', (p) => p.speed === 'fast', 'speed'],
  ];
  for (const [label, fn, group] of filters) {
    if ((await chip(label).count()) === 0) { note(`map filter ${group}=${label}`, 'no such value in the data, skipped'); continue; }
    await chip(label).click();
    await page.waitForTimeout(1300);
    const txt = await countText(page);
    const exp = expect(fn);
    const st = await shot(`map-${group}`);
    check(`map filter ${group}=${label}: count equals the data (${exp})`, txt.startsWith(`${fmtInt(exp)} of ${fmtInt(total)}`), txt);
    const share = exp / total;
    check(`map filter ${group}=${label}: fewer dots lit`, share > 0.97 || st.vivid < base.vivid * Math.min(0.92, share + 0.25), `${(share * 100).toFixed(0)}% of clips match; vivid pixels ${base.vivid} → ${st.vivid}`);
    await chip(label).click();
    await page.waitForTimeout(900);
  }
  // combination (AND across groups, OR within)
  if ((await chip('High').count()) && (await chip('Mid').count()) && (await chip('Overlapping speech').count())) {
    await chip('High').click(); await chip('Overlapping speech').click(); await chip('Mid').click();
    await page.waitForTimeout(1200);
    const combo = await countText(page);
    const expCombo = expect((p) => (p.noise === 'high' || p.noise === 'mid') && p.overlap === true);
    check('map: filters combine (OR within a group, AND across groups)', combo.startsWith(`${fmtInt(expCombo)} of`), `${combo} (expected ${expCombo})`);
  }
  await page.getByRole('button', { name: /Clear filters/ }).click();
  await page.waitForTimeout(1200);
  const cleared = await countText(page);
  check('map: clear filters restores all clips', cleared.startsWith(`${fmtInt(total)} of`), cleared);
  const restored = await shot('map-restored');
  check('map: dots return after clearing', restored.vivid > base.vivid * 0.85, `${base.vivid} → ${restored.vivid}`);

  // model choice recolors the dots and changes the readout
  const wers = {};
  for (const m of models) {
    // the map shows chips for up to 4 models and a <select> beyond that
    if (models.length <= 4) await page.getByRole('radio', { name: m.label }).first().click();
    else await page.getByLabel('Model whose error rate colors the dots').selectOption(m.id);
    await page.waitForTimeout(1400);
    const txt = await countText(page);
    const st = await shot(`map-model-${m.id}`);
    let words = 0, errs = 0; for (const p of points) if (p.err[m.id] != null) { words += p.nw; errs += p.err[m.id]; }
    wers[m.id] = errs / words;
    check(`map model ${m.label}: pooled WER readout equals the data (${fmtPct(errs / words)})`, txt.includes(fmtPct(errs / words)), txt);
    wers[m.id] = { w: errs / words, red: st.red, green: st.green };
  }
  const order = [...models].sort((a, b) => wers[a.id].w - wers[b.id].w);
  if (models.length > 1) check('map: worse models paint more red dots', wers[order[order.length - 1].id].red >= wers[order[0].id].red, order.map((m) => `${m.id}: wer ${(wers[m.id].w * 100).toFixed(0)}% red ${wers[m.id].red}`).join(' | '));
  if (models.length <= 4) await page.getByRole('radio', { name: models.find((m) => m.id === primary).label }).first().click();
  else await page.getByLabel('Model whose error rate colors the dots').selectOption(primary);
  await page.waitForTimeout(1000);

  // hover + click a dot
  const rect = await stage.boundingBox();
  const geo = dotGeometry(rect);
  const pick = isolatedDot(geo, rect);
  await page.mouse.move(pick.x - 6, pick.y - 6);
  await page.mouse.move(pick.x, pick.y, { steps: 6 });
  await page.waitForTimeout(600);
  const tip = await page.locator('[class*="_tip"]').first().textContent({ timeout: 300 }).catch(() => '');
  check('map: hovering a dot shows its id and WER', tip.includes(pick.id), `${pick.id} (isolated by ${pick.gap.toFixed(0)}px) → "${tip.trim()}"`);
  await page.mouse.click(pick.x, pick.y);
  await page.waitForSelector('[data-testid=clip-panel]', { timeout: 8000 });
  const heading = (await page.textContent('[data-testid=clip-panel] [data-clip-heading]')).trim();
  check('map: clicking a dot opens the panel for that clip', heading === pick.id, heading);

  const clipJson = await (await page.request.get(`${BASE}/data/clip/${pick.id}.json`)).json();
  const res = clipJson.results[primary];
  const panelWer = (await page.textContent('[data-testid=clip-panel] [class*="_score"]')).trim();
  check('map panel: WER shown equals the clip data', panelWer.startsWith(fmtPct(res.wer)), panelWer);
  // waveform
  await page.waitForSelector(`[data-testid=clip-panel] button[aria-label="Play clip ${pick.id}"]:not([disabled])`, { timeout: 15000 });
  const wave = await page.evaluate(() => {
    const host = [...document.querySelectorAll('[data-testid=clip-panel] div')].find((d) => d.shadowRoot);
    const cv = host?.shadowRoot?.querySelectorAll('canvas') ?? [];
    let drawn = 0;
    cv.forEach((c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) drawn++; } catch {} });
    return { hasShadow: !!host, canvases: cv.length, drawn };
  });
  check('map panel: waveform is drawn (wavesurfer canvas with pixels)', wave.hasShadow && wave.canvases > 0 && wave.drawn > 500, JSON.stringify(wave));
  await page.click(`[data-testid=clip-panel] button[aria-label="Play clip ${pick.id}"]`);
  await page.waitForTimeout(1500);
  const st = await audioState(page);
  check('map panel: audio plays', st.some((a) => !a.paused && a.t > 0.4), JSON.stringify(st.map((a) => [a.src.slice(0, 24), a.paused, +a.t.toFixed(2)])));

  // transcripts side by side, differences marked
  const cols = await page.$$eval('[data-testid=clip-panel] [role=group][aria-label$="transcript"]', (secs) => secs.map((s) => ({ label: s.getAttribute('aria-label'), text: s.querySelector('p').textContent.replace(/\s+/g, ' ').trim(), said: s.querySelectorAll('mark').length, wrong: s.querySelectorAll('del').length, gaps: s.querySelectorAll('[role=img][aria-label^="missed"]').length })));
  const cnt = { sub: 0, del: 0, ins: 0 }; res.ops.forEach((o) => { if (o.op !== 'equal') cnt[o.op]++; });
  check('map panel: reference and model transcripts side by side', cols.length === 2 && cols[0].label === 'Reference transcript', cols.map((c) => c.label).join(' / '));
  check('map panel: reference text equals ref', cols[0].text === clipJson.ref, cols[0].text.slice(0, 60));
  check('map panel: differences marked on both sides (sub+del said; sub+ins wrong; del gaps)', cols[0].said === cnt.sub + cnt.del && cols[1].wrong === cnt.sub + cnt.ins && cols[1].gaps === cnt.del, `ops ${JSON.stringify(cnt)} → said ${cols[0].said}, wrong ${cols[1].wrong}, gaps ${cols[1].gaps}`);
  const hypShown = cols[1].text.replace(/\(added by the model\)/g, '').replace(/\s+/g, ' ').trim();
  check('map panel: model text equals the hypothesis (gaps omitted)', hypShown === res.hyp, hypShown.slice(0, 80));
  await page.screenshot({ path: `${OUT}/e2e-map-panel.png` });

  // switch model inside the panel
  if (models.length > 1) {
    const other = models.find((m) => m.id !== primary);
    await page.locator('[data-testid=clip-panel]').getByRole('radio', { name: other.label }).click();
    await page.waitForTimeout(900);
    const hyp2 = (await page.$$eval('[data-testid=clip-panel] [role=group][aria-label$="transcript"] p', (ps) => ps[1].textContent)).replace(/\(added by the model\)/g, '').replace(/\s+/g, ' ').trim();
    check('map panel: switching model shows that model\'s transcript', hyp2 === clipJson.results[other.id].hyp, other.label);
    await page.locator('[data-testid=clip-panel]').getByRole('radio', { name: models.find((m) => m.id === primary).label }).click();
  }
  // Escape closes, focus returns to the map
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check('map panel: Escape closes it', (await page.locator('[data-testid=clip-panel]').count()) === 0);
  check('map panel: closing pauses nothing unexpected / focus returns to the map', await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'map-stage'));
  check('map: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function testKeyboard() {
  console.log('\n## keyboard');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // tab order from the top reaches the hero buttons first
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check('keyboard: first Tab stop is a hero action', /Explore the map|Hear the worst 10/.test(first || ''), first);
  await scrollTo(page, '#map', 700);
  await page.waitForSelector('[data-testid=map-stage] canvas', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.locator('[data-testid=map-stage]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const live = await page.textContent('[data-testid=map-stage] [aria-live]');
  check('keyboard: arrow keys move a focus ring between dots and announce the clip', /Press Enter to open/.test(live), live);
  const idFromLive = live.split('.')[0];
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=clip-panel]', { timeout: 8000 });
  const head = (await page.textContent('[data-testid=clip-panel] [data-clip-heading]')).trim();
  check('keyboard: Enter opens the focused clip', head === idFromLive, `${head} vs ${idFromLive}`);
  const focusInPanel = await page.evaluate(() => !!document.activeElement?.closest('[data-testid=clip-panel]'));
  check('keyboard: focus moves into the panel', focusInPanel);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  check('keyboard: Escape closes the panel and returns focus to the map', (await page.locator('[data-testid=clip-panel]').count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'map-stage');
  // every control has an accessible name
  const unnamed = await page.$$eval('button, a[href], input, select, [role=slider]', (els) => els.filter((e) => { const n = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim(); return !n && !e.labels?.length; }).map((e) => e.outerHTML.slice(0, 80)));
  check('a11y: every button, link and input has an accessible name', unnamed.length === 0, unnamed.join(' | '));
  check('keyboard: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ───────────────────────────── worst 10 ─────────────────────────────
async function testWorst() {
  console.log('\n## worst 10');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const ids = site.summary.worst10;
  await page.getByRole('button', { name: 'Hear the worst 10' }).click();
  await page.waitForSelector('dialog[open]', { timeout: 8000 });
  const title = await page.textContent('dialog h2');
  check('worst 10: dialog opens', /The worst 10/.test(title), title);
  const list = await page.$$eval('dialog ol button', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  check('worst 10: lists the 10 clips from summary.worst10', list.length === ids.length && ids.every((id, i) => list[i].includes(id)), list.slice(0, 2).join(' | '));
  for (let i = 0; i < ids.length; i++) {
    const head = (await page.waitForSelector('dialog [data-clip-heading]', { timeout: 8000 })).textContent ? (await page.textContent('dialog [data-clip-heading]')).trim() : '';
    check(`worst 10 · clip ${i + 1}: shows ${ids[i]}`, head === ids[i], head);
    const clipJson = await (await page.request.get(`${BASE}/data/clip/${ids[i]}.json`)).json();
    await page.waitForSelector(`dialog button[aria-label="Play clip ${ids[i]}"], dialog button[aria-label="Pause clip ${ids[i]}"]`, { timeout: 15000 });
    await page.waitForTimeout(1800);
    const st = await audioState(page);
    const playing = st.filter((a) => !a.paused && a.t > 0.2);
    const counter = (await page.textContent('dialog p.eyebrow')).replace(/\s+/g, ' ').trim();
    check(`worst 10 · clip ${i + 1}: auto-plays and counter reads "Clip ${i + 1} of ${ids.length}"`, playing.length === 1 && counter === `Clip ${i + 1} of ${ids.length}`, `${counter}; playing ${playing.length}`);
    const wer = (await page.textContent('dialog [class*="_score"]')).trim();
    check(`worst 10 · clip ${i + 1}: WER equals the data`, wer.startsWith(fmtPct(clipJson.results[primary].wer)), wer);
    if (i === 0) await page.screenshot({ path: `${OUT}/e2e-worst.png` });
    if (i < ids.length - 1) await page.getByRole('button', { name: /^Next/ }).click();
  }
  check('worst 10: Next is disabled on the last clip', await page.getByRole('button', { name: /^Next/ }).isDisabled());
  await page.getByRole('button', { name: /^Previous/ }).click();
  await page.waitForTimeout(600);
  check('worst 10: Previous steps back', (await page.textContent('dialog [data-clip-heading]')).trim() === ids[ids.length - 2]);
  // keyboard stepping
  await page.locator('dialog ol button').first().focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  check('worst 10: ArrowLeft steps back', (await page.textContent('dialog [data-clip-heading]')).trim() === ids[ids.length - 3]);
  // jump from the list
  await page.locator('dialog ol button').nth(1).click();
  await page.waitForTimeout(600);
  check('worst 10: choosing from the list jumps there', (await page.textContent('dialog [data-clip-heading]')).trim() === ids[1]);
  // auto-advance when a clip ends
  await page.locator('dialog ol button').nth(2).click();
  const dur = site.briefs[ids[2]]?.duration ?? 6;
  await page.waitForSelector(`dialog button[aria-label="Pause clip ${ids[2]}"]`, { timeout: 15000 });
  await page.waitForTimeout((dur + 2.5) * 1000);
  const afterEnd = (await page.textContent('dialog [data-clip-heading]')).trim();
  check('worst 10: moves on to the next clip when one ends', afterEnd === ids[3], `${afterEnd} (expected ${ids[3]})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  check('worst 10: Escape closes the dialog', (await page.locator('dialog[open]').count()) === 0);
  const st = await audioState(page);
  check('worst 10: closing stops the audio', st.every((a) => a.paused));
  check('worst 10: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ───────────────────────────── phone width ─────────────────────────────
async function testMobile() {
  console.log('\n## phone width (390 x 844, touch)');
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const over = async (label) => {
    const r = await page.evaluate(() => {
      const iw = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || el.closest('dialog:not([open])')) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        // ignore anything inside a deliberate horizontal scroller or visually hidden
        let p = el.parentElement, inScroller = false;
        while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { inScroller = true; break; } p = p.parentElement; }
        if (!inScroller && b.right > iw + 1) bad.push(el.tagName + '.' + String(el.className).slice(0, 30) + ' right=' + Math.round(b.right));
      }
      return { iw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 5) };
    });
    check(`phone: ${label}: no horizontal page overflow`, r.sw <= r.iw && r.bad.length === 0, JSON.stringify(r));
  };
  await over('hero');
  const btns = await page.$$eval('header .btn', (els) => els.map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent.trim(), w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) }; }));
  check('phone: hero buttons are full width and tall enough to tap', btns.length === 2 && btns.every((b) => b.w > 300 && b.h >= 44), JSON.stringify(btns));
  const h1 = await page.$eval('h1', (e) => { const r = e.getBoundingClientRect(); return { right: r.right, fs: getComputedStyle(e).fontSize }; });
  check('phone: headline fits', h1.right <= 390, JSON.stringify(h1));

  for (const sel of ['#hear', '#findings']) { await scrollTo(page, sel); await page.waitForTimeout(1800); await over(sel); }
  // karaoke on a phone
  await scrollTo(page, '#hear', 300);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/e2e-m-karaoke.png` });
  const pb = await page.locator('#hear button[aria-label="Play the clip"]').boundingBox();
  check('phone: karaoke play button is tappable', pb.width >= 56 && pb.height >= 56, `${pb.width}x${pb.height}`);
  await page.locator('#hear button[aria-label="Play the clip"]').tap();
  await page.waitForTimeout(2000);
  check('phone: karaoke plays on tap', (await audioState(page)).some((a) => !a.paused && a.t > 0.5));
  await page.locator('#hear button[aria-label="Pause the clip"]').tap();

  // findings charts
  await scrollTo(page, '#findings');
  await page.waitForTimeout(1500);
  const svgW = await page.$$eval('#findings svg[role=img]', (s) => s.map((e) => Math.round(e.getBoundingClientRect().width)));
  check('phone: finding charts fit their cards', svgW.every((w) => w > 200 && w <= 360), svgW.join(','));
  await page.screenshot({ path: `${OUT}/e2e-m-findings.png` });

  // map
  await scrollTo(page, '#map');
  await page.waitForTimeout(1500);
  await over('#map');
  const toggle = page.getByRole('button', { name: /^Filters/ });
  check('phone: filters start collapsed behind a toggle', (await toggle.getAttribute('aria-expanded')) === 'false');
  await toggle.tap();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/e2e-m-filters.png` });
  const chipH = await page.$$eval('#map [aria-pressed], #map [role=radio]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check('phone: filter chips are at least 34px tall', chipH.length > 5 && chipH.every((h) => h >= 34), `min ${Math.min(...chipH)}`);
  await page.locator('[aria-pressed]').filter({ hasText: /^High/ }).first().tap();
  await page.waitForTimeout(800);
  const txt = await countText(page);
  check('phone: a filter applies by tap', txt.startsWith(`${fmtInt(points.filter((p) => p.noise === 'high').length)} of`), txt);
  await page.locator('[aria-pressed]').filter({ hasText: /^High/ }).first().tap();
  await toggle.tap();
  await page.waitForSelector('[data-testid=map-stage] canvas', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await scrollTo(page, '[data-testid=map-stage]', -60);
  await page.waitForTimeout(800);
  const stage = page.locator('[data-testid=map-stage]');
  const rect = await stage.boundingBox();
  const geo = dotGeometry(rect);
  const pick = isolatedDot(geo, rect, () => false);
  await page.screenshot({ path: `${OUT}/e2e-m-map.png` });
  // a one-finger vertical swipe that starts on the map scrolls the page (the map must not trap it)
  const cdp = await page.context().newCDPSession(page);
  const sy0 = await page.evaluate(() => window.scrollY);
  const fx = rect.x + rect.width / 2, fy = rect.y + rect.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: fy - (250 * i) / 12 }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(900);
  const sy1 = await page.evaluate(() => window.scrollY);
  check('phone: a one-finger swipe over the map scrolls the page instead of panning the map', sy1 > sy0 + 100, `scrollY ${sy0} → ${sy1}`);
  await scrollTo(page, '[data-testid=map-stage]', -60);
  await page.waitForTimeout(500);
  const rectB = await stage.boundingBox();
  const geoB = dotGeometry(rectB);
  const pickB = isolatedDot(geoB, rectB, () => false);
  Object.assign(pick, pickB);
  await page.touchscreen.tap(pick.x, pick.y);
  await page.waitForSelector('[data-testid=clip-panel]', { timeout: 8000 });
  await page.waitForTimeout(1800);
  const head = (await page.textContent('[data-testid=clip-panel] [data-clip-heading]')).trim();
  check('phone: tapping a dot opens the panel', head === pick.id, `${head} (isolated by ${pick.gap.toFixed(0)}px)`);
  const pr = await page.locator('[data-testid=clip-panel]').boundingBox();
  const vis = pr.y < 844 && pr.y + 60 > 0;
  check('phone: the panel opens below the map and is scrolled into view', vis && pr.width <= 390 && pr.x >= 0, JSON.stringify(pr));
  await over('map panel');
  await page.waitForSelector(`[data-testid=clip-panel] button[aria-label="Play clip ${pick.id}"]:not([disabled])`, { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/e2e-m-panel.png` });
  await page.locator(`[data-testid=clip-panel] button[aria-label="Play clip ${pick.id}"]`).tap();
  await page.waitForTimeout(1400);
  check('phone: panel audio plays on tap', (await audioState(page)).some((a) => !a.paused && a.t > 0.3));
  await page.locator('[data-testid=clip-panel] button[aria-label="Close the clip panel"]').tap();
  await page.waitForTimeout(700);
  check('phone: panel closes', (await page.locator('[data-testid=clip-panel]').count()) === 0);

  // table scrolls inside its own container
  await scrollTo(page, '#faceoff', 200);
  await page.waitForTimeout(1500);
  await over('#faceoff');
  const sc = await page.$eval('#faceoff [role=region]', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  check('phone: the table scrolls sideways inside its own card', sc.sw > sc.cw, JSON.stringify(sc));
  await page.screenshot({ path: `${OUT}/e2e-m-table.png` });
  for (const sel of ['#data', '#method']) { await scrollTo(page, sel); await page.waitForTimeout(1500); await over(sel); }
  await page.screenshot({ path: `${OUT}/e2e-m-footer.png` });

  // worst 10 on a phone
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Hear the worst 10' }).tap();
  await page.waitForSelector('dialog[open] [data-clip-heading]', { timeout: 10000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/e2e-m-worst.png` });
  const d = await page.$eval('dialog', (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), sw: e.scrollWidth }; });
  check('phone: worst-10 player fills the screen without overflow', d.w <= 393 && d.sw <= d.w + 1, JSON.stringify(d));
  await page.getByRole('button', { name: /^Next/ }).tap();
  await page.waitForTimeout(800);
  check('phone: Next steps to clip 2', (await page.textContent('dialog [data-clip-heading]')).trim() === site.summary.worst10[1]);
  await page.getByRole('button', { name: 'Close the worst-10 player' }).tap();
  await page.waitForTimeout(500);
  check('phone: worst-10 closes', (await page.locator('dialog[open]').count()) === 0);
  check('phone: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ───────────────────────────── map navigation + fallbacks ─────────────────────────────
async function testMapNav() {
  console.log('\n## map pan / zoom');
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await scrollTo(page, '#map', 700);
  await page.waitForSelector('[data-testid=map-stage] canvas', { timeout: 20000 });
  await scrollTo(page, '[data-testid=map-stage]', -60);
  await page.waitForTimeout(3000);
  const stage = page.locator('[data-testid=map-stage]');
  const rect = await stage.boundingBox();
  const geo = dotGeometry(rect);
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  // a dot well away from the centre, so zoom and pan move it a lot
  const pick = isolatedDot(geo, rect, (g) => Math.hypot(g.x - cx, g.y - cy) < 120);
  const tipAt = async (x, y) => {
    await page.mouse.move(x - 7, y - 3);
    await page.mouse.move(x, y, { steps: 5 });
    await page.waitForTimeout(450);
    return (await page.locator('[class*="_tip"]').first().textContent({ timeout: 300 }).catch(() => '')) || '';
  };
  check('map nav: starting position hits the chosen dot', (await tipAt(pick.x, pick.y)).includes(pick.id), pick.id);

  // plain wheel scrolls the page and leaves the map alone
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => window.scrollY);
  check('map nav: a plain scroll wheel scrolls the page (the map does not trap it)', y1 > y0, `scrollY ${y0} → ${y1}`);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(500);
  await scrollTo(page, '[data-testid=map-stage]', -60);
  await page.waitForTimeout(400);
  const rect2 = await stage.boundingBox();
  const geo2 = dotGeometry(rect2);
  const p2 = geo2.find((g) => g.id === pick.id);
  check('map nav: ...and the dot has not moved on the map', (await tipAt(p2.x, p2.y)).includes(pick.id));

  // Ctrl + wheel zooms about the cursor
  await page.mouse.move(rect2.x + rect2.width / 2, rect2.y + rect2.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100); // 100 * 0.01 = 1 zoom level = 2x
  await page.keyboard.up('Control');
  await page.waitForTimeout(700);
  const c2x = rect2.x + rect2.width / 2, c2y = rect2.y + rect2.height / 2;
  const zx = c2x + (p2.x - c2x) * 2, zy = c2y + (p2.y - c2y) * 2;
  const inside = zx > rect2.x + 20 && zx < rect2.x + rect2.width - 20 && zy > rect2.y + 20 && zy < rect2.y + rect2.height - 20;
  if (inside) check('map nav: Ctrl+wheel zooms in (the dot moves away from the centre 2x)', (await tipAt(zx, zy)).includes(pick.id), `expected at ${zx.toFixed(0)},${zy.toFixed(0)}`);
  else check('map nav: Ctrl+wheel zooms in (dot left the view as expected)', true, 'dot is off-screen after zoom');

  // buttons: zoom in then reset
  await page.getByRole('button', { name: 'Reset the view' }).click();
  await page.waitForTimeout(1000);
  check('map nav: Reset restores the original view', (await tipAt(p2.x, p2.y)).includes(pick.id));
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(500);
  const s = 2 ** 0.6;
  const bx = c2x + (p2.x - c2x) * s, by = c2y + (p2.y - c2y) * s;
  if (bx > rect2.x + 20 && bx < rect2.x + rect2.width - 20 && by > rect2.y + 20 && by < rect2.y + rect2.height - 20)
  {
    const live = await stage.evaluate((e) => ({ z: e.dataset.zoom, t: e.dataset.target }));
    const got = await tipAt(bx, by);
    check('map nav: the zoom-in button zooms about the centre', got.includes(pick.id), `expected ${pick.id} at ${bx.toFixed(0)},${by.toFixed(0)}; view ${JSON.stringify(live)}; tooltip "${got.slice(0, 20)}"`);
  }
  await page.getByRole('button', { name: 'Reset the view' }).click();
  await page.waitForTimeout(1000);

  // drag pans
  await page.mouse.move(rect2.x + 60, rect2.y + 120);
  await page.mouse.down();
  await page.mouse.move(rect2.x + 20, rect2.y + 150, { steps: 8 });
  await page.mouse.move(rect2.x + 20, rect2.y + 150); // stop before releasing, so no inertia carries it on
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(500);
  // the drag was 40 px left and 30 px down, so with inertia the dot ends up at least that far from its old spot
  const still = (await tipAt(p2.x, p2.y)).includes(pick.id);
  const nowThere = (await tipAt(p2.x - 40, p2.y + 30)).includes(pick.id) || (await tipAt(p2.x - 60, p2.y + 45)).includes(pick.id) || (await tipAt(p2.x - 50, p2.y + 38)).includes(pick.id);
  check('map nav: dragging pans the map (the dot follows the pointer)', !still && nowThere, `still at old spot: ${still}; found at the dragged spot: ${nowThere}`);
  await page.getByRole('button', { name: 'Reset the view' }).click();
  await page.waitForTimeout(1000);
  check('map nav: Reset after panning restores the view', (await tipAt(p2.x, p2.y)).includes(pick.id));

  // regression: zoom buttons after a drag (deck.gl's own view state carries zoomX/zoomY that must not override them)
  const live = () => stage.evaluate((e) => ({ z: +e.dataset.zoom, t: e.dataset.target.split(',').map(Number) }));
  const toScreen = (p, v) => { const sc = 2 ** v.z; return { x: rect2.x + rect2.width / 2 + (p.x - v.t[0]) * sc, y: rect2.y + rect2.height / 2 - (p.y - v.t[1]) * sc }; };
  const pt = points.find((q) => q.id === pick.id);
  await page.mouse.move(rect2.x + 300, rect2.y + 300);
  await page.mouse.down();
  await page.mouse.move(rect2.x + 340, rect2.y + 280, { steps: 6 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(400);
  for (const [label, action] of [['after a drag', null], ['after a drag and +', () => page.getByRole('button', { name: 'Zoom in' }).click()], ['after a drag, + and −', () => page.getByRole('button', { name: 'Zoom out' }).click()]]) {
    if (action) { await action(); await page.waitForTimeout(500); }
    const v = await live();
    const sp = toScreen(pt, v);
    if (sp.x > rect2.x + 30 && sp.x < rect2.x + rect2.width - 30 && sp.y > rect2.y + 30 && sp.y < rect2.y + rect2.height - 30) {
      check(`map nav: dots stay pickable ${label}`, (await tipAt(sp.x, sp.y)).includes(pick.id), `view ${JSON.stringify(v)}`);
    }
  }
  const v1 = await live();
  check('map nav: + then − returns to the same zoom', Math.abs(v1.z - (await (async () => { await page.getByRole('button', { name: 'Reset the view' }).click(); await page.waitForTimeout(900); return (await live()).z; })())) < 0.7 + 1e-6, `before reset z=${v1.z}`);
  check('map nav: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function testNoWebgl() {
  console.log('\n## no WebGL');
  const { browser, page, errors } = await launch({}, ['--disable-3d-apis']);
  const gl = await (async () => { await page.goto(BASE + '/', { waitUntil: 'load' }); return page.evaluate(() => !!document.createElement('canvas').getContext('webgl2')); })();
  check('no-webgl: WebGL is really off in this run', gl === false);
  await page.waitForTimeout(1500);
  check('no-webgl: hero still draws its dots (2D canvas)', await page.evaluate(() => { const c = document.querySelector('header canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n > 20000; }));
  await scrollTo(page, '#map', 700);
  await page.waitForTimeout(3000);
  const msg = await page.textContent('#map').catch(() => '');
  check('no-webgl: the map explains what is missing instead of failing', /needs WebGL/.test(msg), msg.slice(msg.indexOf('The interactive') , msg.indexOf('The interactive') + 70));
  check('no-webgl: the filter bar and legend are still there', (await page.locator('#map [aria-pressed]').count()) > 5);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: 'Hear the worst 10' }).click();
  await page.waitForSelector('dialog[open] [data-clip-heading]', { timeout: 10000 });
  await page.waitForTimeout(1800);
  check('no-webgl: the worst-10 player still works (waveform is 2D canvas)', (await audioState(page)).some((a) => !a.paused));
  check('no-webgl: no unhandled errors', errors.filter((e) => !/WebGL|webgl|GPU/i.test(e)).length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

const run = async () => {
  if (want('load')) await testLoad();
  if (want('motion')) await testReducedMotion();
  if (want('karaoke')) await testKaraoke();
  if (want('findings')) await testFindings();
  if (want('static')) await testStatic();
  if (want('map')) await testMap();
  if (want('keyboard')) await testKeyboard();
  if (want('worst')) await testWorst();
  if (want('mobile')) await testMobile();
  if (want('nav')) await testMapNav();
  if (want('nowebgl')) await testNoWebgl();
};
await run();
process.exit(summarize() ? 1 : 0);
