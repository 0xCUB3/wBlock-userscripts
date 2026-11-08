import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const source = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const hosts = ['amazon.com', 'www.amazon.co.uk', 'x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com', 'platform.twitter.com', 'drive.google.com', 'docs.google.com', 'youtube.googleapis.com'];
const otherHosts = ['example.com', 'notamazon.com', 'notx.com', 'nottwitter.com', 'x.com.example.com', 'mail.google.com', 'drive.google.com.example.com'];
// wBlock's @exclude semantics: /regex/ or an anchored glob where * is any run.
const excludes = [...source.matchAll(/^\/\/ @exclude\s+(\S+)$/gm)].map(m => m[1]).map(p => p.length > 1 && p.startsWith('/') && p.endsWith('/')
  ? new RegExp(p.slice(1, -1))
  : new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
const excluded = url => excludes.some(re => re.test(url));
for (const host of hosts) for (const url of [`https://${host}/`, `https://${host}/i/status/1?x=1`]) assert.equal(excluded(url), true, `not excluded: ${url}`);
for (const host of otherHosts) assert.equal(excluded(`https://${host}/fixture`), false, `wrongly excluded: ${host}`);
console.log('PASS metadata excludes');

const browser = await webkit.launch();
try {
  for (const device of [null, devices['iPhone 13']]) {
    const context = await browser.newContext(device || {});
    await context.addInitScript({ content: source });
    await context.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><article><p>Post text</p><div class="video-js" style="width:320px;height:180px"><video></video><button class="vjs-control-bar">Play</button></div></article></body>' })
      : route.abort());
    for (const host of otherHosts) {
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
      await page.waitForFunction(() => document.querySelector('video').hasAttribute('data-wblock-player-cleaner'));
      console.log(`PASS ${device ? 'iPhone' : 'desktop'} ${host}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
