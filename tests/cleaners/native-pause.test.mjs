// A pause made with the native controls must hold. Controlled players keep
// their own play state and answer a pause they did not make with play():
// NYT's Betamax player restarts the video within milliseconds, so the native
// pause button did nothing on nytimes.com. The page's own pause and play, and a
// play after the user acts elsewhere on the page, still go through. Runs on
// real media in WebKit, desktop and iPhone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  .player { position: relative; width: 320px; height: 180px; }
  video { width: 100%; height: 100%; }
  .overlay { position: absolute; inset: 0; }
</style></head><body>
<div class="player"><video id="v" src="/sound.mp4" preload="auto" playsinline></video><div class="overlay"><button id="overlay-play">Play</button></div></div>
<button id="next">Next video</button>
<script>
  // Betamax-style controlled player: its state says what the element should do.
  var video = document.getElementById('v');
  var wantPlaying = false;
  window.sitePlay = function () { wantPlaying = true; video.muted = true; return video.play(); };
  window.sitePause = function () { wantPlaying = false; video.pause(); };
  video.addEventListener('pause', function () {
    if (wantPlaying && !video.ended) { video.play().catch(function () {}); }
  });
  document.getElementById('next').addEventListener('click', function () { window.sitePlay(); });
</script>
</body></html>`;

const browser = await webkit.launch();
try {
  for (const [label, device] of [['desktop', {}], ['iPhone', devices['iPhone 13']]]) {
    const context = await browser.newContext(device);
    // The native control buttons act on the element without calling the
    // page's play() and pause(); keep the untouched methods to stand in.
    await context.addInitScript(() => {
      window.__nativePause = HTMLMediaElement.prototype.pause;
      window.__nativePlay = HTMLMediaElement.prototype.play;
    });
    await context.addInitScript({ content: script });
    await context.route('**/*', route => new URL(route.request().url()).pathname === '/sound.mp4'
      ? route.fulfill({ contentType: 'video/mp4', body: media })
      : route.fulfill({ contentType: 'text/html', body: fixture }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://fixture.test/');
    await page.waitForSelector('#v[data-wblock-player-cleaner]', { state: 'attached' });
    const paused = () => page.evaluate(() => document.getElementById('v').paused);
    const tapVideo = () => page.evaluate(() => {
      const video = document.getElementById('v');
      for (const type of ['pointerdown', 'pointerup', 'click']) video.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true }));
    });

    await page.evaluate(() => window.sitePlay());
    await page.waitForTimeout(300);
    assert.equal(await paused(), false, `${label}: the site starts playback`);

    await tapVideo();
    await page.evaluate(() => window.__nativePause.call(document.getElementById('v')));
    await page.waitForTimeout(600);
    assert.equal(await paused(), true, `${label}: a native pause holds against the site's replay`);

    await tapVideo();
    await page.evaluate(() => window.__nativePlay.call(document.getElementById('v')));
    await page.waitForTimeout(300);
    assert.equal(await paused(), false, `${label}: native play resumes`);

    await page.evaluate(() => window.sitePause());
    await page.waitForTimeout(300);
    assert.equal(await paused(), true, `${label}: the site's own pause works`);
    await page.evaluate(() => window.sitePlay());
    await page.waitForTimeout(300);
    assert.equal(await paused(), false, `${label}: the site's own play works after its pause`);

    await page.evaluate(() => window.__nativePause.call(document.getElementById('v')));
    await page.waitForTimeout(300);
    assert.equal(await paused(), true, `${label}: a second native pause holds`);
    await page.click('#next');
    await page.waitForTimeout(300);
    assert.equal(await paused(), false, `${label}: a site control outside the video plays again`);

    assert.deepEqual(errors, [], `${label}: page errors`);
    console.log(`PASS ${label} native pause holds against a controlled player`);
    await context.close();
  }
} finally {
  await browser.close();
}
