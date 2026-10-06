import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const fixture = readFileSync(new URL('./fixture.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const browser = await webkit.launch();
try {
  const safari27 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15';
  for (const name of ['macOS', 'macOS Safari 27', 'iPhone', 'iPad desktop-site']) {
    const mobile = !name.startsWith('macOS');
    const page = await browser.newPage(name === 'iPhone' ? devices['iPhone 13']
      : name === 'macOS Safari 27' ? { userAgent: safari27 } : {});
    if (name === 'iPad desktop-site') {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 });
      });
    }
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
    // Safari's private control tree cannot be measured from page JavaScript.
    // Check the public video/toolbar geometry instead, including short players
    // where reserving the expanded volume slider's height put pills mid-video.
    const layouts = mobile ? [null] : [
      { width: 320, height: 180 }, { width: 960, height: 540 },
      { width: 1280, height: 720 }
    ];
    for (const layout of layouts) {
      if (layout) {
        await page.evaluate(({ width, height }) => {
          document.querySelector('#player-wrap').style.width = width + 'px';
          document.querySelector('#movie_player').style.height = height + 'px';
        }, layout);
      }
      const geometry = await page.evaluate(() => {
        const video = document.querySelector('#movie_player video');
        const toolbar = document.querySelector('.wblock-tc-toolbar');
        const quality = toolbar.querySelector('.wblock-tc-quality-button');
        const sponsor = toolbar.querySelector('.wblock-tc-sponsor-button');
        const audio = toolbar.querySelector('.wblock-tc-audio-button');
        const vr = video.getBoundingClientRect();
        const tr = toolbar.getBoundingClientRect();
        const qr = quality.getBoundingClientRect();
        const sr = sponsor.getBoundingClientRect();
        return {
          gap: vr.bottom - tr.bottom,
          right: vr.right - tr.right,
          inside: tr.top >= vr.top && tr.left >= vr.left && tr.right <= vr.right,
          qualityGap: vr.bottom - qr.bottom,
          sponsorGap: vr.bottom - sr.bottom,
          audioGap: audio ? vr.bottom - audio.getBoundingClientRect().bottom : null,
          safeArea: toolbar.style.bottom.includes('safe-area-inset-bottom'),
          // Empty space left of the shorter SB row must still reach the video,
          // not close Safari's volume popover as the pointer moves toward it.
          emptyHit: document.elementFromPoint(tr.left + 1, sr.top + sr.height / 2) === video,
          qualityHit: document.elementFromPoint(qr.left + qr.width / 2, qr.top + qr.height / 2) === quality
        };
      });
      const label = `${name} ${layout ? `${layout.width}x${layout.height}` : 'inline'}`;
      console.log(`GEOMETRY ${label}: ${JSON.stringify(geometry)}`);
      // Safari 27 moved the macOS volume slider out of the bottom bar (#942);
      // older versions still need the pills above it (wBlock-userscripts#7).
      const expectedGap = mobile ? 56 : name === 'macOS Safari 27' ? 58 : 130;
      assert.equal(geometry.gap, expectedGap, `${label}: toolbar must clear the native controls`);
      assert.equal(geometry.qualityGap, geometry.gap, `${label}: quality is nearest the native strip`);
      assert.ok(geometry.sponsorGap > geometry.qualityGap, `${label}: SB stays above quality`);
      assert.equal(geometry.audioGap, mobile ? null : geometry.gap, `${label}: audio aligns with quality only on macOS`);
      assert.equal(geometry.safeArea, mobile, `${label}: preserve mobile safe-area positioning`);
      assert.ok(geometry.right >= 8 && geometry.inside && geometry.qualityHit, `${label}: buttons stay inside the video and clickable`);
      if (!mobile) assert.ok(geometry.emptyHit, `${label}: empty toolbar space must not intercept native controls`);
    }
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
    const mouse = async (type, selector = '#movie_player', relatedTarget = null) => page.evaluate(({ type, selector, relatedTarget }) => {
      const target = document.querySelector(selector);
      const video = document.querySelector('#movie_player video');
      const rect = video.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, composed: true, relatedTarget: relatedTarget ? document.querySelector(relatedTarget) : null,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
      }));
    }, { type, selector, relatedTarget });
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
    if (!mobile) {
      await pointer('pointermove', true);
      await mouse('mouseleave');
      await page.clock.runFor(50);
      assert.equal(await visible(), false, 'leaving the player hides controls immediately');
      await mouse('mousemove');
      await page.clock.runFor(50);
      assert.equal(await visible(), true, 're-entering the player shows controls immediately');
      await mouse('mouseout', '#movie_player', null);
      await page.clock.runFor(50);
      assert.equal(await visible(), false, 'leaving the window from the player hides controls immediately');
      await mouse('mouseenter', '.wblock-tc-toolbar');
      await page.clock.runFor(50);
      assert.equal(await visible(), true, 'hovering the custom toolbar keeps controls visible');
      await mouse('mouseout', '.wblock-tc-toolbar', null);
      await page.clock.runFor(50);
      assert.equal(await visible(), false, 'leaving the window while hovering the toolbar hides controls immediately');

      await mouse('mouseenter', '.wblock-tc-toolbar');
      await page.evaluate(() => document.querySelector('.wblock-tc-quality-button').click());
      assert.equal(await page.evaluate(() => document.querySelector('.wblock-tc-quality-menu')?.style.display), 'block', 'quality settings should open');
      await mouse('mouseout', '.wblock-tc-toolbar', null);
      await page.clock.runFor(50);
      assert.equal(await visible(), true, 'leaving the window must not hide an open settings panel');
      assert.equal(await page.evaluate(() => document.querySelector('.wblock-tc-quality-menu')?.style.display), 'block', 'open quality settings must remain reachable');
      await page.evaluate(() => document.querySelector('.wblock-tc-quality-button').click());
    }
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
    if (mobile) {
      const tap = bottom => page.evaluate(bottom => {
        const video = document.querySelector('#movie_player video');
        const rect = video.getBoundingClientRect();
        video.dispatchEvent(new CustomEvent('wblock-tc-video-tap', { detail: { doubleTap: false,
          clientX: rect.left + rect.width / 2, clientY: bottom ? rect.bottom - 20 : rect.top + rect.height / 2 } }));
      }, bottom);
      await tap(false);
      assert.equal(await visible(), true, 'tapping the video reveals hidden controls');
      await tap(true);
      assert.equal(await visible(), true, 'tapping native controls must not hide ours while they stay up');
      await tap(false);
      assert.equal(await visible(), false, 'tapping the video hides controls together with native ones');
      await tap(false);
      await state({ paused: true }, 'pause');
      await tap(false);
      assert.equal(await visible(), true, 'native controls stay up while paused, so taps must not hide ours');
      await state({ paused: false }, 'play');
      await page.clock.runFor(4100);
    }
    await state({ paused: true }, 'pause');
    await page.clock.runFor(4100);
    assert.equal(await visible(), true, 'pause cancels pending hides');
    await state({ paused: false, ended: false }, 'play');
    await page.clock.runFor(4100);
    await state({ ended: true }, 'ended');
    assert.equal(await visible(), true, 'ending playback reveals controls');
    console.log(`PASS ${name}: native idle deadline, pointer hold, seek, AirPlay, pause, and end`);
    await page.close();
  }
} finally {
  await browser.close();
}
