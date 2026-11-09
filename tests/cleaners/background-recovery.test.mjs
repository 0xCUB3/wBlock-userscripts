// Wiring for Tube Cleaner's background recovery (#12) on macOS. The decision
// itself is proven in tests/rules/background-recovery.test.mjs; this checks
// that real visibility, media events, Media Session handlers and the retry
// timer reach it in a page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const fixture = new URL('./fixture.html', import.meta.url).href;

// Fake the native visibility getters and keep the handlers Tube Cleaner gives
// Media Session, so the test can press "pause" the way Now Playing does.
const prelude = `
window.__nativeHidden = false;
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__nativeHidden });
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => window.__nativeHidden ? 'hidden' : 'visible' });
window.__sessionHandlers = {};
if (window.MediaSession) {
  const native = MediaSession.prototype.setActionHandler;
  MediaSession.prototype.setActionHandler = function (action, handler) {
    window.__sessionHandlers[action] = handler;
    try { return native.call(this, action, handler); } catch (e) {}
  };
}`;

const browser = await webkit.launch();
try {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(prelude + '\n' + script);
  await page.goto(fixture);
  await page.waitForSelector('.wblock-tc-native');

  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    window.__paused = true;
    window.__plays = 0;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => window.__paused });
    video.play = () => { window.__plays++; window.__paused = false; video.dispatchEvent(new Event('play')); video.dispatchEvent(new Event('playing')); return Promise.resolve(); };
    video.pause = () => { window.__paused = true; video.dispatchEvent(new Event('pause')); };
    window.__setHidden = hidden => { window.__nativeHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
    video.play();
    window.__plays = 0;
  });

  // Safari pauses the playing video as the tab group switches.
  await page.evaluate(() => { window.__setHidden(true); document.querySelector('#movie_player video').pause(); });
  await page.waitForFunction(() => window.__plays > 0, null, { timeout: 3000 }).catch(() => {});
  assert.equal(await page.evaluate(() => window.__plays), 1, 'a pause around hiding is resumed once');
  assert.equal(await page.evaluate(() => window.__paused), false);
  console.log('PASS: resumes a video Safari paused while switching away');

  // Back, then away again, and pause from Now Playing right after the switch.
  await page.evaluate(() => { window.__setHidden(false); window.__setHidden(true); window.__plays = 0; });
  const hasPause = await page.evaluate(() => typeof window.__sessionHandlers.pause === 'function');
  assert.ok(hasPause, 'Tube Cleaner registers a Media Session pause handler');
  await page.evaluate(() => window.__sessionHandlers.pause());
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__plays), 0, 'a Now Playing pause stays paused');
  assert.equal(await page.evaluate(() => window.__paused), true);
  console.log('PASS: keeps a Now Playing pause right after switching away');

  // A pause made in the page before switching away stays paused too.
  await page.evaluate(() => { window.__setHidden(false); document.querySelector('#movie_player video').play(); window.__plays = 0; });
  await page.evaluate(() => document.querySelector('#movie_player video').pause());
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__setHidden(true));
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__plays), 0, 'an in-page pause stays paused');
  console.log('PASS: keeps an in-page pause made before switching away');

  // Media Session commands around hiding (macOS 27 can send Safari's own
  // pause as a Pause command ~140 ms before the page hides). Each case starts
  // visible and playing, sends its commands, then hides after `hideAfter` ms.
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    navigator.mediaSession.setActionHandler('stop', () => video.pause());
    window.__command = action => { window.__sessionHandlers[action](); if (!window.__paused) video.pause(); };
  });
  async function scenario(name, steps, hideAfter, expectedPlays) {
    await page.evaluate(() => { window.__setHidden(false); document.querySelector('#movie_player video').play(); window.__plays = 0; });
    await page.evaluate(steps);
    await page.waitForTimeout(hideAfter);
    await page.evaluate(() => window.__setHidden(true));
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.__plays), expectedPlays, name);
    console.log(`PASS: ${name}`);
  }
  await scenario('resumes after a Pause command just before hiding', () => window.__command('pause'), 140, 1);
  await scenario('keeps a Pause command made well before hiding', () => window.__command('pause'), 600, 0);
  await scenario('keeps a Stop just before hiding', () => window.__command('stop'), 140, 0);
  await scenario('playing again clears an earlier Stop', () => {
    const video = document.querySelector('#movie_player video');
    window.__command('stop'); video.play(); window.__plays = 0; video.pause();
  }, 140, 1);
  await scenario('a video that ended before hiding stays ended',
    () => { window.__command('pause'); document.querySelector('#movie_player video').dispatchEvent(new Event('ended')); }, 140, 0);
  await scenario('a new source before hiding cancels',
    () => { window.__command('pause'); document.querySelector('#movie_player video').dispatchEvent(new Event('emptied')); }, 140, 0);

  // A Pause command while hidden still cancels a pending resume.
  await page.evaluate(() => { window.__setHidden(false); document.querySelector('#movie_player video').play(); window.__plays = 0; });
  await page.evaluate(() => { window.__command('pause'); });
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__setHidden(true); window.__sessionHandlers.pause(); });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__plays), 0, 'a Pause command while hidden cancels');
  console.log('PASS: a Pause command while hidden cancels a pending resume');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
