import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const mediaURL = 'https://service-pkgabcnews.akamaized.net/content/playlist.m3u8';
const feed = id => ({ channel: { item: { guid: id, temporalType: 'vod', isLiveVideo: false, title: 'ABC clip', 'media-group': { 'media-content': [
  { '@attributes': { url: 'https://ads.example/ad.mp4', type: 'video/mp4', medium: 'video' } },
  { '@attributes': { url: mediaURL, type: 'application/x-mpegURL', medium: 'video' } },
] } } } });
const html = `<!doctype html><style>amp-video-iframe{display:block;position:relative;width:640px;height:360px}</style>
<amp-video-iframe src="/fitt/video/amp/embed?id=123"><iframe src="/original" style="display:block"></iframe><div placeholder>Play original</div></amp-video-iframe>
<amp-video-iframe id="foreign" src="https://example.com/fitt/video/amp/embed?id=456"><div placeholder>Other player</div></amp-video-iframe>
<p id="article">Article content</p>`;
const browser = await webkit.launch();
try {
  for (const mobile of [false, true]) {
    for (const mode of ['success', 'feed-error', 'wrong-id', 'media-error']) {
      const context = await browser.newContext(mobile ? devices['iPhone 13'] : {});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let requests = 0;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/video/itemfeed') {
          requests++;
          await route.fulfill({ status: mode === 'feed-error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(feed(mode === 'wrong-id' ? '999' : '123')) });
        } else if (url.pathname === '/amp/article') {
          await route.fulfill({ contentType: 'text/html', body: html });
        } else await route.fulfill({ status: 200, body: '' });
      });
      await page.addInitScript(() => {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.__source || ''; }, set(value) { this.__source = value; } });
        HTMLMediaElement.prototype.load = function () { if (this.src) window.__candidate = this; };
        HTMLMediaElement.prototype.canPlayType = () => 'probably';
      });
      await page.addInitScript(script);
      await page.goto('https://abcnews.com/amp/article');
      if (mode === 'feed-error' || mode === 'wrong-id') {
        await page.waitForTimeout(300);
        assert.equal(await page.locator('video').count(), 0);
        assert.equal(await page.locator('iframe').getAttribute('src'), '/original');
      } else {
        await page.waitForFunction(() => !!window.__candidate);
        assert.equal(await page.locator('video').count(), 0, 'keep candidate off-DOM until usable');
        assert.equal(await page.locator('iframe').getAttribute('src'), '/original');
        if (mode === 'media-error') {
          await page.evaluate(() => window.__candidate.dispatchEvent(new Event('error')));
          assert.equal(await page.locator('video').count(), 0);
          assert.equal(await page.locator('iframe').getAttribute('src'), '/original');
        } else {
          await page.evaluate(() => window.__candidate.dispatchEvent(new Event('loadedmetadata')));
          await page.waitForSelector('video');
          assert.equal(await page.locator('iframe').getAttribute('src'), 'about:blank');
          const state = await page.locator('video').evaluate(v => ({ src: v.src, controls: v.controls, inline: v.playsInline, paused: v.paused, autoplay: v.autoplay }));
          assert.deepEqual(state, { src: mediaURL, controls: true, inline: true, paused: true, autoplay: false });
          await page.locator('video').evaluate(v => v.dispatchEvent(new Event('error')));
          await page.waitForTimeout(100);
          assert.equal(await page.locator('video').count(), 0);
          assert.equal(await page.locator('iframe').getAttribute('src'), '/original');
          assert.equal(await page.locator('iframe').evaluate(v => getComputedStyle(v).display), 'block');
          assert.equal(await page.locator('[placeholder]').first().evaluate(v => getComputedStyle(v).display), 'block');
        }
      }
      assert.equal(requests, 1, 'only matching ABC embed fetched once');
      assert.equal(await page.locator('#foreign video').count(), 0);
      assert.equal(await page.locator('#article').evaluate(v => getComputedStyle(v).display), 'block');
      assert.deepEqual(errors, []);
      console.log(`PASS ABC AMP ${mobile ? 'iPhone' : 'desktop'} ${mode}`);
      await context.close();
    }
  }
} finally { await browser.close(); }
