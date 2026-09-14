import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const fixture = readFileSync(new URL('./fixture.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const browser = await webkit.launch();
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage(mobile ? devices['iPhone 13'] : {});
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
    await page.goto('https://fixture.test/watch?v=FIRSTVID001');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(`
      const __wblockTubeCleanerFeatures = { backgroundPlayback: false, sponsorBlock: false,
        pictureInPicture: false, toolbar: true, chapters: false, captions: false, resumePosition: false };
    ` + script);
    await page.clock.runFor(250);
    const visible = () => page.evaluate(() => document.querySelector('.wblock-tc-toolbar')?.style.opacity === '1');
    const state = async (values, event) => page.evaluate(({ values, event }) => {
      const video = document.querySelector('#movie_player video');
      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(video, key, { configurable: true, get: () => value });
      }
      video.dispatchEvent(new Event(event));
    }, { values, event });
    const pointer = async (type, bottom = false) => page.evaluate(({ type, bottom, mobile }) => {
      const video = document.querySelector('#movie_player video');
      const rect = video.getBoundingClientRect();
      video.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerId: 7,
        pointerType: mobile ? 'touch' : 'mouse', clientX: rect.left + rect.width / 2,
        clientY: bottom ? rect.bottom - 20 : rect.top + rect.height / 2 }));
    }, { type, bottom, mobile });
    await state({ paused: false, ended: false }, 'play');
    await page.clock.runFor(3100);
    assert.equal(await visible(), true, 'custom controls must not fade a second before WebKit’s four-second idle deadline');
    await pointer('pointerdown');
    await page.clock.runFor(5000);
    assert.equal(await visible(), true, 'holding a pointer must keep controls reachable');
    await pointer('pointerup');
    await page.clock.runFor(3900);
    assert.equal(await visible(), true, 'release must restart the idle deadline');
    await page.clock.runFor(200);
    assert.equal(await visible(), false, 'idle controls should fade after four seconds');
    await state({ seeking: true }, 'seeking');
    await page.clock.runFor(4100);
    assert.equal(await visible(), true, 'seeking must keep controls visible');
    await state({ seeking: false }, 'seeked');
    await page.clock.runFor(4100);
    assert.equal(await visible(), false, 'idle hide resumes after seeking');
    await state({ webkitCurrentPlaybackTargetIsWireless: true }, 'webkitcurrentplaybacktargetiswirelesschanged');
    await page.clock.runFor(4100);
    assert.equal(await visible(), true, 'AirPlay controls must stay visible like WebKit’s');
    await state({ webkitCurrentPlaybackTargetIsWireless: false }, 'webkitcurrentplaybacktargetiswirelesschanged');
    await page.clock.runFor(4100);
    assert.equal(await visible(), false);
    if (!mobile) {
      await pointer('pointermove', true);
      await page.clock.runFor(4100);
      assert.equal(await visible(), true, 'hovering the native bottom control area must not fade custom controls');
      await pointer('pointermove');
      await page.clock.runFor(4100);
      assert.equal(await visible(), false, 'moving off controls restores idle hiding');
    }
    await state({ paused: true }, 'pause');
    await page.clock.runFor(4100);
    assert.equal(await visible(), true, 'pause cancels pending hides');
    await state({ paused: false, ended: false }, 'play');
    await page.clock.runFor(4100);
    await state({ ended: true }, 'ended');
    assert.equal(await visible(), true, 'ending playback reveals controls');
    console.log(`PASS ${mobile ? 'iOS' : 'macOS'}: native idle deadline, pointer hold, seek, AirPlay, pause, and end`);
    await page.close();
  }
} finally {
  await browser.close();
}
