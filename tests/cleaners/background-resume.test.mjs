// Wiring for Tube Cleaner's iOS background resume. The decision itself is
// proven in tests/rules/background-resume.test.mjs; this checks that WebKit's
// background pause, the page's pause() calls, taps, Media Session handlers,
// the end of the video and real visibility reach it on iPhone, in the order
// Safari delivers them, and that hide-time PiP takes over once play() is refused.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { devices, webkit } from 'playwright';

const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const fixture = new URL('./fixture.html', import.meta.url).href;

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
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(prelude + '\n' + script);
  await page.goto(fixture);
  await page.waitForSelector('.wblock-tc-native');

  // A video whose play() and pause() are observable. The page's pause()
  // still goes through HTMLMediaElement.prototype.pause, the way YouTube's
  // does; WebKit's own pause only fires the event.
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    window.__paused = true;
    window.__ended = false;
    window.__plays = 0;
    window.__pip = 0;
    window.__refuse = false;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => window.__paused });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => window.__ended });
    video.play = () => {
      window.__plays++;
      if (window.__refuse) return Promise.reject(new DOMException('refused', 'NotAllowedError'));
      window.__paused = false; video.dispatchEvent(new Event('play')); video.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    video.pause = function () {
      HTMLMediaElement.prototype.pause.call(this);
      if (!window.__paused) { window.__paused = true; video.dispatchEvent(new Event('pause')); }
    };
    video.webkitSupportsPresentationMode = () => true;
    video.webkitPresentationMode = 'inline';
    video.webkitSetPresentationMode = mode => { video.webkitPresentationMode = mode; if (mode === 'picture-in-picture') window.__pip++; };
    window.__systemPause = () => { window.__paused = true; video.dispatchEvent(new Event('pause')); };
    window.__setHidden = hidden => { window.__nativeHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
  });

  // Each case starts visible and playing, runs its steps, then reports how
  // many times Tube Cleaner called play().
  async function scenario(name, steps, expectedPlays) {
    await page.evaluate(() => {
      window.__setHidden(false); window.__ended = false; window.__paused = true;
      document.querySelector('#movie_player video').play(); window.__plays = 0;
    });
    // Leave the input grace of whatever came before.
    await page.waitForTimeout(1100);
    for (const step of steps) {
      if (typeof step === 'number') await page.waitForTimeout(step);
      else await page.evaluate(step);
    }
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__plays), expectedPlays, name);
    console.log(`PASS: ${name}`);
  }

  const hide = () => window.__setHidden(true);
  await scenario('resumes WebKit\'s pause just before the page hides', [() => window.__systemPause(), 600, hide], 1);
  assert.equal(await page.evaluate(() => window.__paused), false);
  await scenario('resumes WebKit\'s pause just after the page hides', [hide, 300, () => window.__systemPause()], 1);
  await scenario('keeps a visible pause the page never hides after', [() => window.__systemPause(), 1500], 0);
  await scenario('keeps a pause well before hiding', [() => window.__systemPause(), 1400, hide], 0);
  await scenario('keeps a pause long after hiding (the lock screen\'s)', [hide, 1300, () => window.__systemPause()], 0);
  await scenario('keeps YouTube\'s pauseVideo before hiding',
    [() => document.querySelector('#movie_player video').pause(), 300, hide], 0);
  await scenario('keeps YouTube\'s pauseVideo after hiding',
    [hide, 200, () => document.querySelector('#movie_player video').pause()], 0);
  await scenario('keeps a pause right after a tap',
    [() => { window.dispatchEvent(new Event('touchend')); window.__systemPause(); }, 300, hide], 0);
  await scenario('keeps a Media Session pause', [hide, 200, () => window.__sessionHandlers.pause()], 0);
  await scenario('keeps a Media Session pause made before hiding',
    [() => window.__sessionHandlers.pause(), 300, hide, 200, () => window.__systemPause()], 0);
  await scenario('keeps the end of the video', [() => { window.__ended = true; window.__systemPause(); }, 300, hide], 0);
  await scenario('resumes again after playing past an earlier Media Session pause',
    [() => window.__sessionHandlers.pause(), () => document.querySelector('#movie_player video').play(),
      () => { window.__plays = 0; }, 200, () => window.__systemPause(), 300, hide], 1);

  // Hide-time PiP stays out of the way while resume works, and takes over
  // once WebKit refuses the play().
  assert.equal(await page.evaluate(() => window.__pip), 0, 'no PiP while resume works');
  await scenario('a refused resume falls back to PiP',
    [() => { window.__refuse = true; window.__systemPause(); }, 300, hide, 100], 1);
  await page.evaluate(() => { window.__refuse = false; window.__setHidden(false); document.querySelector('#movie_player video').play(); });
  await page.evaluate(() => window.__setHidden(true));
  assert.equal(await page.evaluate(() => window.__pip), 1, 'PiP on the next hide after a refusal');
  console.log('PASS: PiP takes over on the next hide after a refused resume');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
