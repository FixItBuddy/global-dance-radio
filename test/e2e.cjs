// Browser smoke test. Usage: node test/e2e.cjs [screenshotDir]   (needs playwright)
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const OUT = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const fix = p.startsWith('/data/') && fs.existsSync(path.join(FIX, path.basename(p))) ? path.join(FIX, path.basename(p)) : path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(fix, (err, buf) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(fix)] || 'text/plain' }).end(buf); });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.goto(base);
  await page.waitForSelector('.card');
  const shot = async (n) => OUT && page.screenshot({ path: path.join(OUT, n + '.png') });
  const titles = async () => page.$$eval('.card h3', (hs) => hs.map((h) => h.textContent));

  // default = No spoilers
  let t = await titles();
  assert.ok(t.some((x) => x.includes('safe money tip')), 'safe item visible');
  assert.ok(!t.some((x) => /mild secret|major walkthrough|unchecked/.test(x)), 'mild/major/unknown hidden by default');
  assert.match(await page.textContent('#list'), /hidden by No spoilers/);
  assert.equal(await page.getAttribute('[data-mode="none"]', 'aria-checked'), 'true');
  await shot('feed-no-spoilers');

  // XSS: nothing executed, hostile href/thumbnail not rendered as links
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'no script execution');
  assert.equal(await page.$$eval('a[href^="javascript:"]', (a) => a.length), 0);
  assert.equal(await page.$$eval('img[src^="javascript:"]', (a) => a.length), 0);

  // Light → mild appears, major still hidden
  await page.click('[data-mode="light"]');
  t = await titles();
  assert.ok(t.some((x) => x.includes('mild secret')));
  assert.ok(!t.some((x) => x.includes('major walkthrough')));
  // Everything
  await page.click('[data-mode="all"]');
  t = await titles();
  assert.ok(t.some((x) => x.includes('major walkthrough')) && t.some((x) => x.includes('unchecked')));
  assert.ok(t[0].includes('major walkthrough'), 'sorted by trend');
  await shot('feed-everything');
  await page.click('[data-mode="none"]');

  // search + kind chip
  await page.fill('#q', 'secret');
  assert.deepEqual((await titles()).length, 0, 'no-spoiler search for mild item shows nothing');
  await page.fill('#q', '');
  await page.click('[data-kind="special"]');
  assert.deepEqual((await titles()).map((x) => x.replace(/\s+/g, ' ')), ['FIXTURE live special']);
  await page.click('[data-kind="all"]');

  // Live tab
  await page.click('[data-tab="live"]');
  assert.match(await page.textContent('#view'), /FIXTURE live special/);
  assert.match(await page.textContent('#view'), /Fixture item two/, 'time-limited collectible listed');
  await shot('live');

  // Tracker: spoiler gate, check persists across reload
  await page.click('[data-tab="tracker"]');
  assert.match(await page.textContent('#view'), /0 \/ 2 collected/);
  assert.ok(!(await page.textContent('#view')).includes('Fixture spoiler item'));
  assert.match(await page.textContent('#view'), /1 hidden by spoiler mode/);
  await page.click('details.cat summary');
  await page.check('input[data-id="c1"]');
  assert.match(await page.textContent('#view'), /1 \/ 2 collected/);
  await shot('tracker');
  await page.reload();
  await page.click('[data-tab="tracker"]');
  assert.match(await page.textContent('#view'), /1 \/ 2 collected/, 'progress persisted');

  // Settings: mute words persist and filter, mode saved
  await page.click('[data-tab="settings"]');
  assert.match(await page.textContent('#view'), /youtube/);
  assert.match(await page.textContent('#view'), /APIFY_TOKEN not set/);
  await page.fill('#muted', 'money');
  await page.dispatchEvent('#muted', 'change');
  await shot('settings');
  await page.click('[data-tab="feed"]');
  assert.ok(!(await titles()).some((x) => x.includes('money tip')), 'muted word hides item');
  await page.click('[data-mode="all"]');
  await page.reload();
  await page.waitForSelector('.card');
  assert.equal(await page.getAttribute('[data-mode="all"]', 'aria-checked'), 'true', 'mode persisted');

  // corrupted storage falls back to safest mode
  await page.evaluate(() => localStorage.setItem('gta6.prefs', '{"mode":"hacked"}'));
  await page.reload();
  await page.waitForSelector('.card');
  assert.equal(await page.getAttribute('[data-mode="none"]', 'aria-checked'), 'true');

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  server.close();
  console.log('e2e OK');
})().catch((e) => { console.error(e); process.exit(1); });
