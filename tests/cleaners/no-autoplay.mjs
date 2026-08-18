import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webkit } from 'playwright';

const dir = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(dir, '..', '..', 'packages', 'no-autoplay', 'dist', 'no-autoplay.user.js'), 'utf8');
const fixture = readFileSync(join(dir, 'fixture-no-autoplay.html'), 'utf8');
const url = 'https://example.com/wblock-no-autoplay';

const failSafe = setTimeout(() => {
  console.error('FAIL No Autoplay: timed out');
  process.exit(1);
}, 25000);

async function playResult(page, selector) {
  return page.evaluate(async (sel) => {
    const media = document.querySelector(sel);
    const outcome = await Promise.race([
      media.play().then(() => ({ name: 'ok' })).catch((error) => ({
        name: error && error.name,
        message: String(error && error.message || ''),
      })),
      new Promise((resolve) => setTimeout(() => resolve({ name: 'pending' }), 400)),
    ]);
    return {
      ...outcome,
      unlocked: !!media._wblockNoAutoplayUnlocked,
      paused: media.paused,
    };
  }, selector);
}

const browser = await webkit.launch({ timeout: 15000 });
try {
  const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await context.route(url, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: fixture,
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.addInitScript(script);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-wblock-no-autoplay]');

  const feed = await page.evaluate(() => {
    const video = document.getElementById('feed');
    return {
      autoplay: video.autoplay,
      hasAttr: video.hasAttribute('autoplay'),
      marked: video.getAttribute('data-wblock-no-autoplay') === '1',
      paused: video.paused,
    };
  });
  assert.deepEqual(feed, { autoplay: false, hasAttr: false, marked: true, paused: true },
    'markup autoplay is stripped before playback');

  const blocked = await playResult(page, '#feed');
  assert.equal(blocked.name, 'NotAllowedError', 'programmatic play() is rejected');
  assert.match(blocked.message, /autoplay is disabled/);
  assert.equal(blocked.paused, true, 'blocked video stays paused');

  await page.locator('#play').click();
  const unlockedMain = await page.evaluate(() => {
    const video = document.getElementById('main');
    return {
      unlocked: !!video._wblockNoAutoplayUnlocked,
      marked: video.getAttribute('data-wblock-no-autoplay-unlocked') === '1',
    };
  });
  assert.deepEqual(unlockedMain, { unlocked: true, marked: true },
    'a sibling play button unlocks the only video in that player');
  const unlockedPlay = await playResult(page, '#main');
  assert.notEqual(unlockedPlay.name, 'NotAllowedError',
    'unlocked play() is not rejected by No Autoplay');

  const stillBlocked = await playResult(page, '#other');
  assert.equal(stillBlocked.name, 'NotAllowedError', 'unlocking one video does not unlock others');

  await page.locator('#feed').click();
  const unlockedFeed = await playResult(page, '#feed');
  assert.notEqual(unlockedFeed.name, 'NotAllowedError', 'a direct click unlocks that video');
  assert.equal(unlockedFeed.unlocked, true);

  const inserted = await page.evaluate(async () => {
    const video = document.createElement('video');
    video.id = 'late';
    video.autoplay = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    document.body.appendChild(video);
    const afterSet = { autoplay: video.autoplay, hasAttr: video.hasAttribute('autoplay') };
    const play = await Promise.race([
      video.play().then(() => ({ name: 'ok' })).catch((error) => ({
        name: error && error.name,
        message: String(error && error.message || ''),
      })),
      new Promise((resolve) => setTimeout(() => resolve({ name: 'pending' }), 400)),
    ]);
    return { afterSet, play, marked: video.getAttribute('data-wblock-no-autoplay') === '1' };
  });
  assert.equal(inserted.afterSet.autoplay, false, 'late autoplay setter is ignored');
  assert.equal(inserted.afterSet.hasAttr, false, 'late autoplay attribute is not kept');
  assert.equal(inserted.marked, true, 'late video is armed');
  assert.equal(inserted.play.name, 'NotAllowedError', 'late programmatic play() is rejected');

  console.log('PASS No Autoplay');
} finally {
  clearTimeout(failSafe);
  await browser.close();
}
