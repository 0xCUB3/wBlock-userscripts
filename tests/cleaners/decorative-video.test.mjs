// Player Cleaner leaves GIF-like videos alone: a looping clip without
// controls that plays no sound (Discord's splash animation, chat and feed
// GIFs). Real players next to them, including muted looping feed videos that
// carry audio, are still taken over, and unmuting a decorative clip through
// the site's sound button makes it a player. Runs on real media in WebKit,
// desktop and iPhone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = {
  '/silent.mp4': readFileSync(new URL('./media/silent.mp4', import.meta.url)),
  '/sound.mp4': readFileSync(new URL('./media/sound.mp4', import.meta.url)),
};
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  body { margin: 0; background: #313338; min-height: 2000px; }
  #splash { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #313338; z-index: 5; }
  #splash video { width: 120px; height: 80px; }
  .card { position: relative; width: 300px; height: 200px; margin: 16px; }
  .card video { display: block; width: 300px; height: 200px; }
  .badge, .sound, .bar { position: absolute; }
  .badge { left: 4px; top: 4px; }
  .sound { right: 4px; bottom: 4px; }
  .bar { left: 0; right: 0; bottom: 0; height: 32px; background: rgba(0,0,0,.6); }
  main { margin-top: 400px; }
</style></head><body>
<div id="splash"><video id="splash-video" src="/silent.mp4" autoplay loop muted playsinline></video></div>
<main>
  <div class="card" id="gif-card"><video id="gif" src="/silent.mp4" autoplay loop muted playsinline></video><span class="badge">GIF</span></div>
  <div class="card" id="gif-unmuted-card"><video id="gif-unmuted" src="/silent.mp4" loop playsinline></video></div>
  <div class="card video-js" id="known-gif-card"><video id="known-gif" src="/silent.mp4" autoplay loop muted playsinline></video><div class="bar"><button>Play</button></div></div>
  <div class="card" id="feed-card"><video id="feed" src="/sound.mp4" loop playsinline></video><button class="sound">Sound</button></div>
  <div class="card" id="silent-feed-card"><video id="silent-feed" src="/silent.mp4" loop muted playsinline></video><button class="sound" id="unmute">Sound</button></div>
  <div class="card video-js" id="news-card"><video id="news" src="/sound.mp4" autoplay muted playsinline></video><div class="bar"><button>Play</button></div></div>
  <div class="card" id="custom-card"><video id="custom" src="/silent.mp4" playsinline></video><div class="bar"><button>Play</button></div></div>
</main>
<script>
  for (const id of ['gif-unmuted', 'feed', 'silent-feed']) {
    const v = document.getElementById(id);
    v.muted = id !== 'gif-unmuted';
    v.play().catch(() => {});
  }
  document.getElementById('unmute').addEventListener('click', () => { document.getElementById('silent-feed').muted = false; });
</script></body></html>`;

const browser = await webkit.launch();
try {
  for (const [label, device] of [['desktop', {}], ['iPhone', devices['iPhone 13']]]) {
    const context = await browser.newContext(device);
    await context.addInitScript({ content: script });
    await context.route('**/*', route => {
      const body = media[new URL(route.request().url()).pathname];
      return body ? route.fulfill({ contentType: 'video/mp4', body }) : route.fulfill({ contentType: 'text/html', body: fixture });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://fixture.test/');
    await page.waitForFunction(() => [...document.querySelectorAll('video')].every(v => v.readyState >= 2));
    // Players take over by the next frame after metadata; give it a margin.
    await page.waitForSelector('#feed[data-wblock-player-cleaner]');
    await page.waitForTimeout(500);
    const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('video')].map(v =>
      [v.id, { enhanced: v.hasAttribute('data-wblock-player-cleaner'), controls: v.controls }])));
    const before = await state();
    for (const id of ['splash-video', 'gif', 'gif-unmuted', 'known-gif', 'silent-feed']) {
      assert.deepEqual(before[id], { enhanced: false, controls: false }, `${label}: ${id} is decorative`);
    }
    for (const id of ['feed', 'news', 'custom']) {
      assert.deepEqual(before[id], { enhanced: true, controls: true }, `${label}: ${id} is a player`);
    }
    // Hidden overlays stay on decorative videos.
    assert.equal(await page.evaluate(() => document.querySelector('#known-gif-card .bar').offsetHeight > 0), true, `${label}: decorative chrome kept`);

    await page.evaluate(() => document.getElementById('unmute').click());
    await page.waitForSelector('#silent-feed[data-wblock-player-cleaner]', { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.getElementById('silent-feed').controls), true, `${label}: unmuted clip has controls`);
    assert.deepEqual(errors, [], `${label}: page errors`);
    console.log(`PASS ${label} decorative videos`);
    await context.close();
  }
} finally {
  await browser.close();
}
