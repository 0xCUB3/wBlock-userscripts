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
  await sample(0);
  assert.equal((await snapshot()).clicks, 0, 'metadata without progress must not switch quality');
  await sample(0.5);
  await page.clock.runFor(600);
  assert.equal((await snapshot()).selected, 'hd1080', 'restore after playback begins');
  console.log('PASS: iOS saves 1080p across reload and waits for playback progress');

  await sample(0.5, { paused: true });
  await page.clock.runFor(9000);
  assert.equal((await snapshot()).current, 'hd1080', 'intentional pause is not a stall');
  await sample(0.5);
  await page.clock.runFor(9000);
  assert.equal((await snapshot()).current, 'auto', 'stalled restoration must recover to Auto');
  assert.equal((await snapshot()).preference, 'hd1080', 'recovery must not erase the preference');
  const recoveredClicks = (await snapshot()).clicks;
  await sample(1);
  await page.clock.runFor(1000);
  assert.equal((await snapshot()).clicks, recoveredClicks, 'never retry restoration on the same activation');
  console.log('PASS: stalled restoration falls back once, preserving the preference and ignoring pauses');

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
  for (let i = 1; i <= 22; i++) {
    await sample(i);
    await page.clock.runFor(1000);
  }
  assert.equal((await snapshot()).current, 'hd1080', 'healthy playback must not fall back');
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
} finally {
  await browser.close();
}
