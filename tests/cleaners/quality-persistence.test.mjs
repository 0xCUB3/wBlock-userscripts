// Page wiring for Tube Cleaner's iPhone quality restore. When to restore,
// when to fall back and when to stop are proven in
// tests/rules/quality-watch.test.mjs; this checks the requests reach
// YouTube's menu, storage, and the cancellation paths.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const fixture = new URL('./fixture.html', import.meta.url).href;
const browser = await webkit.launch();
try {
  const context = await browser.newContext(devices['iPhone 13']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(script);
  await page.clock.install();
  await page.goto(fixture);
  await page.waitForSelector('.wblock-tc-native');

  async function choose(label) {
    await page.evaluate(label => {
      document.querySelector('.wblock-tc-quality-button').click();
      Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
        .find(button => button.textContent === label).click();
    }, label);
    await page.clock.runFor(600);
  }
  async function sample(time, state = {}) {
    await page.evaluate(({ time, state }) => {
      const video = document.querySelector('#movie_player video');
      // Control progress, not YouTube's quality implementation. The production
      // request still traverses the fixture's asynchronous settings menu.
      for (const [key, value] of Object.entries({ currentTime: time, paused: false,
        seeking: false, ended: false, readyState: 4, ...state })) {
        Object.defineProperty(video, key, { configurable: true, value });
      }
      video.dispatchEvent(new Event('timeupdate'));
    }, { time, state });
  }
  async function snapshot() {
    return page.evaluate(() => ({
      preference: localStorage.getItem('wblock.tubeCleaner.quality'),
      bias: localStorage.getItem('yt-player-quality'),
      selected: window.__uiSelectedQuality,
      current: window.__wblockTubeDebug.getCurrentQuality(),
      clicks: window.__settingsClicks,
      ranges: window.__qualityRangeCalls
    }));
  }
  async function reload() {
    await page.reload();
    await page.waitForSelector('.wblock-tc-native');
  }

  await choose('1080p');
  assert.equal((await snapshot()).preference, 'hd1080');
  await reload();
  assert.equal((await snapshot()).preference, 'hd1080');
  assert.equal((await snapshot()).bias, null);
  assert.equal((await snapshot()).clicks, 0);
  await sample(0.5);
  await page.clock.runFor(600);
  assert.equal((await snapshot()).selected, 'hd1080', 'restore after playback begins');
  console.log('PASS: iOS saves 1080p across reload and waits for playback progress');

  await page.clock.runFor(9000);
  assert.equal((await snapshot()).current, 'auto', 'a stalled restoration falls back to Auto');
  assert.equal((await snapshot()).preference, 'hd1080', 'recovery must not erase the preference');
  console.log('PASS: a stalled restoration falls back to Auto and keeps the preference');

  await reload();
  await choose('Auto');
  await sample(0.5);
  await page.clock.runFor(1000);
  assert.equal((await snapshot()).preference, 'auto');
  assert.equal((await snapshot()).selected, null, 'Auto cancels a pending saved-quality request');
  await reload();
  await sample(0.5);
  await page.clock.runFor(600);
  assert.equal((await snapshot()).clicks, 0, 'Auto persists across reload too');
  console.log('PASS: manual Auto cancels pending restoration and persists');

  await choose('1080p');
  await reload();
  await sample(0.5);
  await page.clock.runFor(600);
  await choose('720p');
  await page.clock.runFor(9000);
  assert.equal((await snapshot()).current, 'hd720', 'an old watchdog cannot override a new manual choice');
  console.log('PASS: manual quality changes cancel the restoration watchdog');

  await page.evaluate(() => {
    const debug = window.__wblockTubeDebug;
    debug.setPreferredQuality('hd1080');
    debug.applyPreferredQuality();
    const oldVideo = document.querySelector('#movie_player video');
    window.__oldQualityVideo = oldVideo;
    oldVideo.replaceWith(document.createElement('video'));
    window.__settingsClicks = 0;
  });
  await page.clock.runFor(100);
  await page.evaluate(() => {
    Object.defineProperty(window.__oldQualityVideo, 'currentTime', { configurable: true, value: 1 });
    window.__oldQualityVideo.dispatchEvent(new Event('timeupdate'));
  });
  assert.equal((await snapshot()).clicks, 0, 'released video cannot restore a stale preference');
  await sample(0.5);
  await page.clock.runFor(600);
  assert.equal((await snapshot()).selected, 'hd1080', 'replacement video also restores the saved choice');
  console.log('PASS: video replacement cancels old listeners and restores on the new stream');
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    window.__sameQualityVideo = player.querySelector('video');
    player.getVideoData = () => ({ video_id: 'NEXTVID1234' });
    window.__settingsClicks = 0;
    window.__uiSelectedQuality = null;
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await sample(0);
  assert.equal((await snapshot()).clicks, 0, 'SPA navigation must also wait for progress');
  await sample(0.5);
  await page.clock.runFor(600);
  assert.equal((await snapshot()).selected, 'hd1080');
  assert.equal(await page.evaluate(() => window.__sameQualityVideo === document.querySelector('#movie_player video')), true);
  assert.deepEqual(errors, []);
  console.log('PASS: YouTube SPA navigation restores quality when the same video element is reused');

  // Auto in native fullscreen promotes from 360p to 1080p, returns to Auto on
  // exit or weak-network stall, and never overrides an explicit quality choice.
  await choose('Auto');
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    window.__uiSelectedQuality = null;
    player.setPlaybackQualityRange('medium', 'medium');
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
  });
  await page.clock.runFor(600);
  assert.equal((await snapshot()).selected, 'hd1080', 'Auto promotes to 1080p in native fullscreen');
  assert.equal((await snapshot()).preference, 'auto', 'fullscreen promotion must not overwrite Auto preference');
  await page.evaluate(() => {
    document.querySelector('#movie_player video').dispatchEvent(new Event('webkitendfullscreen'));
  });
  await page.clock.runFor(600);
  assert.equal((await snapshot()).current, 'auto', 'leaving fullscreen returns Auto to YouTube ABR');
  console.log('PASS: Auto promotes to HD in iOS native fullscreen and restores Auto on exit');

  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    player.setPlaybackQualityRange('medium', 'medium');
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
  });
  await page.clock.runFor(600);
  assert.equal((await snapshot()).selected, 'hd1080');
  await page.clock.runFor(9000);
  assert.equal((await snapshot()).current, 'auto', 'stalled fullscreen promotion falls back to Auto');
  console.log('PASS: stalled fullscreen Auto promotion falls back to Auto on weak networks');

  // Quality saved via GM_setValue survives a fresh browser context (new Private tab / origin).
  const sharedStore = {};
  async function openWithGM(store) {
    const gmContext = await browser.newContext(devices['iPhone 13']);
    const gmPage = await gmContext.newPage();
    await gmPage.exposeBinding('__persistGM', (_, k, v) => { store[k] = v; });
    await gmPage.addInitScript(({ store }) => {
      window.GM_getValue = (k, fallback) => (k in store ? store[k] : fallback);
      window.GM_setValue = (k, v) => { store[k] = v; window.__persistGM(k, v); };
    }, { store });
    await gmPage.addInitScript(script);
    await gmPage.clock.install();
    await gmPage.goto(fixture);
    await gmPage.waitForSelector('.wblock-tc-native');
    return { gmContext, gmPage };
  }
  const firstGM = await openWithGM(sharedStore);
  await firstGM.gmPage.evaluate(() => {
    document.querySelector('.wblock-tc-quality-button').click();
    Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
      .find(button => button.textContent === '720p').click();
  });
  await firstGM.gmPage.clock.runFor(600);
  assert.equal(sharedStore['wblock.tubeCleaner.quality'], 'hd720');
  await firstGM.gmContext.close();

  const secondGM = await openWithGM(sharedStore);
  assert.equal(await secondGM.gmPage.evaluate(() => window.__wblockTubeDebug.getPreferredQuality()), 'hd720');
  await secondGM.gmPage.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    for (const [k, v] of Object.entries({ currentTime: 0.5, paused: false, seeking: false, ended: false, readyState: 4 })) {
      Object.defineProperty(video, k, { configurable: true, value: v });
    }
    video.dispatchEvent(new Event('timeupdate'));
  });
  await secondGM.gmPage.clock.runFor(600);
  assert.equal(await secondGM.gmPage.evaluate(() => window.__uiSelectedQuality), 'hd720');
  await secondGM.gmContext.close();
  console.log('PASS: saved quality persists across fresh contexts via GM storage');
} finally {
  await browser.close();
}
