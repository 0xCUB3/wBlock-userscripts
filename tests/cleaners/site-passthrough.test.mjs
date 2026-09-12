import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const source = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const hosts = ['x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com', 'platform.twitter.com'];
const otherHosts = ['example.com', 'notx.com', 'nottwitter.com', 'x.com.example.com'];
const browser = await webkit.launch();
try {
  for (const device of [null, devices['iPhone 13']]) {
    const context = await browser.newContext(device || {});
    await context.addInitScript({ content: source });
    await context.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><article><p>Post text</p><div class="video-js" style="width:320px;height:180px"><video></video><button class="vjs-control-bar">Play</button></div></article></body>' })
      : route.abort());
    for (const host of [...hosts, ...otherHosts]) {
      const page = await context.newPage();
      await page.goto(`https://${host}/fixture`);
      await page.evaluate(() => {
        window.originalVideo = document.querySelector('video');
        window.originalShell = originalVideo.parentElement;
        window.originalButton = document.querySelector('button');
        originalVideo.src = '/video.mp4';
        const next = document.querySelector('article').cloneNode(true);
        next.id = 'feed-post';
        document.body.appendChild(next);
        originalVideo.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
      });
      if (otherHosts.includes(host)) {
        await page.waitForFunction(() => document.querySelector('video').hasAttribute('data-wblock-player-cleaner'));
      } else {
        await page.waitForTimeout(600);
        const state = await page.evaluate(() => ({
          sameVideo: originalVideo.isConnected && originalVideo.parentElement === originalShell,
          buttonPresent: originalButton.isConnected && getComputedStyle(originalButton).display !== 'none',
          postPresent: document.querySelector('p').textContent === 'Post text',
          videosUntouched: [...document.querySelectorAll('video')].every(v => !v.controls && !v._wblockEnhanced && !v.hasAttribute('style') && v.getAttribute('src') === '/video.mp4'),
          noCleanerMarkers: !document.querySelector('[data-wblock-player-cleaner], [data-wblock-pc-hidden], #wblock-pc-hide'),
          noVisibilityOverride: !Object.hasOwn(document, 'hidden') && !Object.hasOwn(document, 'visibilityState'),
          feedVideoPresent: !!document.querySelector('#feed-post video'),
        }));
        for (const [check, passed] of Object.entries(state)) {
          assert.equal(passed, true, `${device ? 'iPhone' : 'desktop'} ${host}: ${check}`);
        }
      }
      console.log(`PASS ${device ? 'iPhone' : 'desktop'} ${host}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
