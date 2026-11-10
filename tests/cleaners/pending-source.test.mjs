// A <source> a player has just added has no currentSrc until resource
// selection runs a task later. Player Cleaner must wait for that choice
// rather than treat the video as sourceless: on iOS it used to drop the
// <source> and promote the host's bare URL instead. WELT's Bitmovin
// livestream lost its session parameters that way and showed a dead player.
// Runs on real media in WebKit, desktop and iPhone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>body { margin: 0; } .bitmovinplayer-container { display: block; position: relative; width: 320px; height: 180px; } video { width: 100%; height: 100%; }</style>
</head><body>
<live-player class="bitmovinplayer-container" src="/sound.mp4?bare"><video id="v" preload="metadata"></video><div class="bitmovinplayer-poster">Poster</div></live-player>
<script>
  addEventListener('load', () => setTimeout(() => {
    const source = document.createElement('source');
    source.src = '/sound.mp4?session=1';
    document.getElementById('v').appendChild(source);
  }, 50));
</script>
</body></html>`;

const browser = await webkit.launch();
try {
  for (const [label, device] of [['desktop', {}], ['iPhone', devices['iPhone 13']]]) {
    const context = await browser.newContext(device);
    await context.addInitScript({ content: script });
    await context.route('**/*', route => new URL(route.request().url()).pathname === '/sound.mp4'
      ? route.fulfill({ contentType: 'video/mp4', body: media })
      : route.fulfill({ contentType: 'text/html', body: fixture }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://fixture.test/');
    await page.waitForSelector('#v[data-wblock-player-cleaner]', { state: 'attached' });
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const v = document.getElementById('v');
      return { src: v.currentSrc, sources: v.querySelectorAll('source').length, error: v.error && v.error.code };
    });
    assert.match(state.src, /session=1$/, `${label}: plays the source the player chose`);
    assert.equal(state.sources, 1, `${label}: keeps the player's <source>`);
    assert.equal(state.error, null, `${label}: no media error`);
    assert.deepEqual(errors, [], `${label}: page errors`);
    console.log(`PASS ${label} pending <source> is kept`);
    await context.close();
  }
} finally {
  await browser.close();
}
