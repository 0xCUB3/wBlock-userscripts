// Wiring for the cleaners' iOS background resume. The decision itself is
// proven in tests/rules/background-resume.test.mjs; this checks that WebKit's
// background pause, the page's pause() calls, taps, Media Session handlers,
// the end of the video and real visibility reach it on iPhone, in the order
// Safari delivers them, and that hide-time PiP takes over once play() is
// refused. Tube Cleaner runs on its YouTube fixture; Player Cleaner on a
// generic player next to a decorative looping clip it must leave alone, and
// on a ManagedMediaSource player it leaves to the site, which gets the resume
// with no controls, chrome changes or PiP.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { devices, webkit } from 'playwright';

const dist = slug => readFileSync(new URL(`../../packages/${slug}/dist/${slug}.user.js`, import.meta.url), 'utf8');
const media = {
  '/silent.mp4': readFileSync(new URL('./media/silent.mp4', import.meta.url)),
  '/sound.mp4': readFileSync(new URL('./media/sound.mp4', import.meta.url)),
};
const playerFixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>.player { position: relative; width: 320px; height: 180px; } .player video { width: 320px; height: 180px; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 32px; background: rgba(0,0,0,.6); }</style></head><body>
<div class="player"><video id="main" src="/sound.mp4" playsinline></video><div class="bar"><button>Play</button></div></div>
<div class="player"><video id="gif" src="/silent.mp4" autoplay loop muted playsinline></video></div>
</body></html>`;
const mseFixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>.player { position: relative; width: 320px; height: 180px; } .player video { width: 320px; height: 180px; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 32px; background: rgba(0,0,0,.6); }</style></head><body>
<div class="player video-js"><video id="mse" playsinline></video><div class="bar"><button>Play</button></div></div>
<div class="player"><video id="idle" playsinline></video></div>
<div class="player"><video id="gif" autoplay loop muted playsinline></video></div>
<script>
const MS = window.ManagedMediaSource || window.MediaSource;
for (const id of ['mse', 'idle', 'gif']) document.getElementById(id).src = URL.createObjectURL(new MS());
navigator.mediaSession.setActionHandler('pause', () => document.getElementById('mse').pause());
</script></body></html>`;

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

// A video whose play() and pause() are observable. The page's pause() still
// goes through HTMLMediaElement.prototype.pause, the way players' do;
// WebKit's own pause only fires the event.
function instrument(selector) {
  const video = document.querySelector(selector);
  const v = { paused: true, ended: false, plays: 0, pip: 0, refuse: false };
  window.__v = window.__v || {};
  window.__v[selector] = v;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => v.paused });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => v.ended });
  video.play = () => {
    v.plays++;
    if (v.refuse) return Promise.reject(new DOMException('refused', 'NotAllowedError'));
    v.paused = false; video.dispatchEvent(new Event('play')); video.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  };
  video.pause = function () {
    HTMLMediaElement.prototype.pause.call(this);
    if (!v.paused) { v.paused = true; video.dispatchEvent(new Event('pause')); }
  };
  video.webkitSupportsPresentationMode = () => true;
  video.webkitPresentationMode = 'inline';
  video.webkitSetPresentationMode = mode => { video.webkitPresentationMode = mode; if (mode === 'picture-in-picture') v.pip++; };
  v.systemPause = () => { v.paused = true; video.dispatchEvent(new Event('pause')); };
  window.__setHidden = hidden => { window.__nativeHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
}

async function suite({ name, slug, url, route, ready, selector, before, after, pip = true }) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  if (route) await context.route('**/*', route);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(prelude + '\n' + dist(slug));
  await page.goto(url);
  await page.waitForSelector(ready);
  await page.evaluate(instrument, selector);
  const v = (expression, ...args) => page.evaluate(([s, e, a]) => new Function('v', 'video', ...a.map((_, i) => `a${i}`), `return (${e})`)(
    window.__v[s], document.querySelector(s), ...a), [selector, expression, args]);
  if (before) await before(page);

  // Each case starts visible and playing, runs its steps, then reports how
  // many times the script called play().
  async function scenario(label, steps, expectedPlays) {
    await v('(window.__setHidden(false), v.ended = false, v.paused = true, video.play(), v.plays = 0)');
    // Leave the input grace of whatever came before.
    await page.waitForTimeout(1100);
    for (const step of steps) {
      if (typeof step === 'number') await page.waitForTimeout(step);
      else await v(step);
    }
    await page.waitForTimeout(100);
    assert.equal(await v('v.plays'), expectedPlays, `${name}: ${label}`);
    console.log(`PASS: ${name}: ${label}`);
  }

  const hide = 'window.__setHidden(true)';
  await scenario('resumes WebKit\'s pause just before the page hides', ['v.systemPause()', 600, hide], 1);
  assert.equal(await v('v.paused'), false);
  await scenario('resumes WebKit\'s pause just after the page hides', [hide, 300, 'v.systemPause()'], 1);
  await scenario('keeps a visible pause the page never hides after', ['v.systemPause()', 1500], 0);
  await scenario('keeps a pause well before hiding', ['v.systemPause()', 1400, hide], 0);
  await scenario('keeps a pause long after hiding (the lock screen\'s)', [hide, 1300, 'v.systemPause()'], 0);
  await scenario('keeps the page\'s pause() before hiding', ['video.pause()', 300, hide], 0);
  await scenario('keeps the page\'s pause() after hiding', [hide, 200, 'video.pause()'], 0);
  await scenario('keeps a pause right after a tap',
    ['(window.dispatchEvent(new Event(\'touchend\')), v.systemPause())', 300, hide], 0);
  await scenario('keeps a Media Session pause', [hide, 200, 'window.__sessionHandlers.pause()'], 0);
  await scenario('keeps a Media Session pause made before hiding',
    ['window.__sessionHandlers.pause()', 300, hide, 200, 'v.systemPause()'], 0);
  await scenario('keeps the end of the video', ['(v.ended = true, v.systemPause())', 300, hide], 0);
  await scenario('resumes again after playing past an earlier Media Session pause',
    ['window.__sessionHandlers.pause()', 'video.play()', 'v.plays = 0', 200, 'v.systemPause()', 300, hide], 1);

  // Hide-time PiP stays out of the way while resume works, and takes over
  // once WebKit refuses the play(), but never on a player left to the site.
  assert.equal(await v('v.pip'), 0, `${name}: no PiP while resume works`);
  await scenario('a refused resume is tried once', ['(v.refuse = true, v.systemPause())', 300, hide, 100], 1);
  await v('(v.refuse = false, window.__setHidden(false), video.play(), window.__setHidden(true))');
  assert.equal(await v('v.pip'), pip ? 1 : 0, `${name}: PiP on the next hide after a refusal`);
  console.log(`PASS: ${name}: ${pip ? 'PiP takes over' : 'no PiP'} on the next hide after a refused resume`);
  assert.equal(await page.evaluate(() => document.hidden), false, `${name}: the page still reads as visible`);
  await v('window.__setHidden(false)');
  if (after) await after(page);

  assert.deepEqual(errors, []);
  await context.close();
}

const browser = await webkit.launch();
try {
  await suite({ name: 'Tube Cleaner', slug: 'tube-cleaner', url: new URL('./fixture.html', import.meta.url).href,
    ready: '.wblock-tc-native', selector: '#movie_player video' });

  // Player Cleaner: the decorative clip is never taken over, so WebKit's
  // pause of it at the hide is left alone.
  let gifPlays;
  await suite({
    name: 'Player Cleaner', slug: 'player-cleaner', url: 'https://player.test/',
    route: route => {
      const body = media[new URL(route.request().url()).pathname];
      return body ? route.fulfill({ contentType: 'video/mp4', body }) : route.fulfill({ contentType: 'text/html', body: playerFixture });
    },
    ready: '#main[data-wblock-player-cleaner]', selector: '#main',
    before: async page => {
      await page.evaluate(instrument, '#gif');
      await page.evaluate(() => {
        const gif = window.__v['#gif'];
        gif.paused = false;
        gif.systemPause();
        window.__setHidden(true);
      });
      await page.waitForTimeout(100);
      gifPlays = await page.evaluate(() => ({
        plays: window.__v['#gif'].plays, enhanced: document.getElementById('gif').hasAttribute('data-wblock-player-cleaner') }));
      await page.evaluate(() => window.__setHidden(false));
    },
  });
  assert.deepEqual(gifPlays, { plays: 0, enhanced: false }, 'Player Cleaner: a decorative loop video is untouched');
  console.log('PASS: Player Cleaner: a decorative loop video is untouched');

  // A ManagedMediaSource player stays the site's: it gets the resume once
  // played, while a never-played video and a decorative loop next to it
  // are left alone.
  const left = {};
  const leftAlone = async page => {
    await page.evaluate(instrument, '#idle');
    await page.evaluate(instrument, '#gif');
    await page.evaluate(() => {
      const gif = window.__v['#gif'];
      document.getElementById('gif').play();
      gif.plays = 0;
      window.__v['#idle'].systemPause();
      gif.systemPause();
      window.__setHidden(true);
    });
    await page.waitForTimeout(100);
    Object.assign(left, await page.evaluate(() => ({ idle: window.__v['#idle'].plays, gif: window.__v['#gif'].plays })));
    await page.evaluate(() => window.__setHidden(false));
  };
  const untouched = async page => {
    left.mse = await page.evaluate(() => {
      const video = document.getElementById('mse');
      return { enhanced: !!video._wblockEnhanced, marked: !!document.querySelector('[data-wblock-player-cleaner]'),
        controls: video.controls, hidden: !!document.querySelector('[data-wblock-pc-hidden]') ||
          getComputedStyle(document.querySelector('.bar')).display === 'none' };
    });
  };
  await suite({
    name: 'Player Cleaner (site MSE player)', slug: 'player-cleaner', url: 'https://player.test/', pip: false,
    route: route => route.fulfill({ contentType: 'text/html', body: mseFixture }),
    ready: '#mse[src^="blob:"]', selector: '#mse', before: leftAlone, after: untouched,
  });
  assert.deepEqual(left, { idle: 0, gif: 0, mse: { enhanced: false, marked: false, controls: false, hidden: false } },
    'Player Cleaner: the site MSE player is not enhanced, and idle and decorative videos are untouched');
  console.log('PASS: Player Cleaner: the site MSE player is not enhanced, and idle and decorative videos are untouched');
} finally {
  await browser.close();
}
