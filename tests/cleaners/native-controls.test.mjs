// Hit WebKit's actual native controls, not saved play()/pause() methods.
// A capturing listener on the video blocks the user-agent shadow control
// before its click handler can run. Bubbling guards must still precede the
// site's own video click handlers, including across detach/reattach.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));
const fixture = `<!doctype html><style>
  body { margin: 0; }
  .media-player { position: relative; width: 640px; height: 360px; }
  video { width: 100%; height: 100%; }
  .overlay { position: absolute; inset: 0; }
</style>
<div class="media-player"><video id="v" src="/sound.mp4" preload="auto" muted playsinline></video><div class="overlay"><button>Play</button></div></div>
<script>
  window.siteClicks = 0;
  const video = document.getElementById('v');
  video.addEventListener('click', () => {
    window.siteClicks++;
    Promise.resolve(video[video.paused ? 'play' : 'pause']()).catch(() => {});
  });
</script>`;

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
  await context.addInitScript({ content: script });
  await context.route('**/*', route => route.fulfill(route.request().url().endsWith('/sound.mp4')
    ? { contentType: 'video/mp4', body: media }
    : { contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const proof = async state => {
    if (process.env.WBLOCK_NATIVE_PROOF) {
      await page.screenshot({ path: `${process.env.WBLOCK_NATIVE_PROOF}-${state}.png` });
    }
  };
  await page.goto('https://fixture.test/');
  await page.waitForSelector('video[data-wblock-player-cleaner]', { state: 'attached' });
  await page.waitForFunction(() => v.readyState >= 2);
  await proof('ready');
  await page.mouse.move(30, 335);
  await page.mouse.click(30, 335);
  await page.waitForFunction(() => !v.paused && v.currentTime > 0.1, null, { timeout: 2000 })
    .catch(() => assert.fail('The native play control must start playback'));
  await proof('playing');
  assert.equal(await page.evaluate(() => siteClicks), 0, 'Native controls must not toggle the page listener');
  await page.evaluate(() => v.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
  assert.equal(await page.evaluate(() => siteClicks), 0, 'Direct video clicks must not toggle the page listener');

  await page.mouse.click(320, 180);
  await page.waitForFunction(() => v.paused, null, { timeout: 2000 })
    .catch(() => assert.fail('The native control must pause playback'));
  await proof('paused');
  await page.mouse.click(320, 180);
  await page.waitForFunction(() => !v.paused, null, { timeout: 2000 })
    .catch(() => assert.fail('The native control must resume playback'));
  await proof('resumed');
  assert.equal(await page.evaluate(() => siteClicks), 0, 'Native pause and resume must not toggle the page listener');

  const state = await page.evaluate(async () => {
    const video = v;
    const box = video.parentNode;
    box.remove();
    await new Promise(resolve => setTimeout(resolve, 200));
    const released = !video._wblockEnhanced;
    video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const releasedClicks = siteClicks;
    document.body.appendChild(box);
    return { released, releasedClicks };
  });
  assert.equal(state.released, true, 'Detached video releases enhancement');
  assert.equal(state.releasedClicks, 1, 'A released player gets its page clicks back');
  await page.waitForSelector('video[data-wblock-player-cleaner]', { state: 'attached' });
  await page.evaluate(() => v.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
  assert.equal(await page.evaluate(() => siteClicks), 1, 'Reattachment preserves the guard ahead of existing listeners');
  assert.deepEqual(errors, []);
  console.log('PASS WebKit native controls and page click isolation across reattachment');
} finally {
  await browser.close();
}
