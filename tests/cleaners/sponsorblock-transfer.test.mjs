import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const fixture = new URL('./fixture.html', import.meta.url).href;
const key = 'wblock.tubeCleaner.sponsorBlock';
const imported = {
  enabled: true, showNotice: false, minimumDuration: 3.5,
  modes: { sponsor: 'auto', selfpromo: 'off', interaction: 'off', intro: 'ask', outro: 'off', preview: 'off', filler: 'off', music_offtopic: 'off' },
  excludedChannels: ['UC-example']
};
const initialSnapshot = process.env.WBLOCK_SPONSOR_SNAPSHOT
  ? JSON.parse(readFileSync(process.env.WBLOCK_SPONSOR_SNAPSHOT, 'utf8'))
  : { [key]: JSON.stringify(imported) };
const browser = await webkit.launch();
try {
  async function open(snapshot, local) {
    const context = await browser.newContext(devices['iPhone 13']);
    const page = await context.newPage();
    const writes = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeBinding('__persistSponsorSettings', (_, key, rawValue) => {
      writes.push({ key, rawValue });
      snapshot[key] = rawValue;
    });
    await page.addInitScript(({ snapshot, local, key }) => {
      if (local) localStorage.setItem(key, JSON.stringify(local));
      window.GM_getValue = (key, fallback) => key in snapshot ? JSON.parse(snapshot[key]) : fallback;
      window.GM_setValue = (key, value) => {
        snapshot[key] = JSON.stringify(value);
        window.__persistSponsorSettings(key, snapshot[key]);
      };
    }, { snapshot, local, key });
    await page.addInitScript(script);
    await page.goto(fixture);
    await page.waitForSelector('.wblock-tc-native');
    await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-button').click());
    return { context, page, writes, errors };
  }
  const first = await open(initialSnapshot, { ...imported, enabled: false, privateUserID: 'LOCAL-SECRET' });
  assert.equal(await first.page.locator('.wblock-tc-sponsor-menu input[type=checkbox]').first().isChecked(), true);
  assert.equal(await first.page.locator('[data-sponsor-category=intro]').inputValue(), 'ask');
  assert.equal(await first.page.locator('.wblock-tc-sponsor-menu select:not([data-sponsor-category])').inputValue(), '3.5');
  assert.equal(first.writes.length, 0, 'loading an imported snapshot must not overwrite it with stale local state');
  await first.page.locator('[data-sponsor-category=intro]').selectOption('auto');
  await first.page.waitForFunction(() => JSON.parse(localStorage.getItem('wblock.tubeCleaner.sponsorBlock')).modes.intro === 'auto');
  await first.page.waitForTimeout(100);
  assert.equal(first.writes.length, 1);
  const changed = JSON.parse(first.writes[0].rawValue);
  assert.equal(changed.modes.intro, 'auto');
  assert.equal(changed.minimumDuration, 3.5);
  assert.deepEqual(changed.excludedChannels, ['UC-example']);
  assert.equal(JSON.stringify(first.writes).includes('SECRET'), false);
  if (process.env.WBLOCK_SPONSOR_EDIT) writeFileSync(process.env.WBLOCK_SPONSOR_EDIT, first.writes[0].rawValue);
  assert.deepEqual(first.errors, []);
  await first.context.close();
  console.log('PASS: native snapshot overrides local settings, displays imported duration and receives sanitized player edits');

  const next = await open(initialSnapshot, null);
  assert.equal(await next.page.locator('[data-sponsor-category=intro]').inputValue(), 'auto');
  assert.equal(next.writes.length, 0);
  await next.context.close();
  console.log('PASS: player settings survive a fresh browser context through native GM storage');

  const migrated = await open({}, { ...imported, minimumDuration: 7, userID: 'PRIVATE-SECRET', extra: { secret: 'NO-COPY' } });
  await migrated.page.waitForTimeout(100);
  assert.equal(migrated.writes.length, 1);
  assert.equal(JSON.parse(migrated.writes[0].rawValue).minimumDuration, 7);
  assert.equal(JSON.stringify(migrated.writes).includes('SECRET'), false);
  assert.equal(JSON.stringify(migrated.writes).includes('NO-COPY'), false);
  assert.deepEqual(migrated.errors, []);
  await migrated.context.close();
  console.log('PASS: legacy local preferences migrate once without copying unknown fields or credentials');
} finally {
  await browser.close();
}
