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

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
