// iOS fires webkitpresentationmodechanged on the way into native fullscreen as
// well as on the way out. Player Cleaner treated every one as an exit: it
// dropped its in-fullscreen mark and re-ran its chrome hiding mid-transition,
// and when iOS then detached the video for the system player the video lost its
// hooks. The mark must hold from begin to end. WebKit on desktop has no system
// player, so the presentation mode is modelled on the element.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
<div class="player" style="position:relative;width:320px;height:180px"><video id="v" src="/sound.mp4" preload="auto" playsinline style="width:100%;height:100%"></video>
<div class="overlay" style="position:absolute;inset:0"><button>Play</button></div></div>
</body></html>`;

const browser = await webkit.launch();
try {
  const context = await browser.newContext(devices['iPhone 13']);
  await context.addInitScript({ content: script });
  await context.route('**/*', route => new URL(route.request().url()).pathname === '/sound.mp4'
    ? route.fulfill({ contentType: 'video/mp4', body: media })
    : route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto('https://fixture.test/');
  await page.waitForSelector('#v[data-wblock-player-cleaner]');
  const mode = name => page.evaluate(name => {
    const video = document.getElementById('v');
    Object.defineProperty(video, 'webkitPresentationMode', { configurable: true, get: () => name });
    if (name === 'fullscreen') video.dispatchEvent(new Event('webkitbeginfullscreen'));
    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    if (name === 'inline') video.dispatchEvent(new Event('webkitendfullscreen'));
    return video._wblockInNativeFullscreen;
  }, name);

  assert.equal(await mode('fullscreen'), true, 'entering fullscreen keeps the in-fullscreen mark');
  // iOS moves the element out of the page for the system player.
  const kept = await page.evaluate(async () => {
    const video = document.getElementById('v'), parent = video.parentNode;
    video.remove();
    await new Promise(resolve => setTimeout(resolve, 50));
    const enhanced = video._wblockEnhanced;
    parent.insertBefore(video, parent.firstChild);
    return enhanced;
  });
  assert.equal(kept, true, 'a video detached for the system player keeps its hooks');
  assert.equal(await mode('inline'), false, 'leaving fullscreen clears the mark');
  assert.equal(await page.evaluate(() => document.getElementById('v').controls), true, 'native controls are back after fullscreen');
  console.log('PASS iPhone native fullscreen begin is not treated as its end');
  await context.close();
} finally {
  await browser.close();
}
