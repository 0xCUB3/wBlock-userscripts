// A player with no box yet gives Player Cleaner nothing to measure, so it must
// not treat a page-sized positioned ancestor as the player and hide the rest.
// The Washington Post homepage keeps its Ask The Post AI logo video in a
// display:none tab panel inside a sticky <main>; hiding every sibling there
// left only the header and footer. Runs on real media in WebKit, desktop and
// iPhone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>
  body { margin: 0; }
  main { position: sticky; top: 0; }
  section { min-height: 300px; }
  .inactive { display: none; }
</style></head><body>
<header><nav><a href="#">Top Stories</a></nav></header>
<main id="main-content">
  <section id="top"><h2>Top story</h2><p>Lead text</p><button>Share</button></section>
  <section id="more"><h2>More stories</h2><p>Headline list</p></section>
  <div class="inactive" id="ai-panel"><div><video id="logo" src="/sound.mp4" preload="auto" playsinline></video><p>Ask a question</p></div></div>
</main>
<footer id="footer">Company</footer>
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
    await page.waitForSelector('#logo[data-wblock-player-cleaner]', { state: 'attached' });
    await page.waitForTimeout(300);
    const shown = id => page.evaluate(id => {
      const el = document.getElementById(id);
      return !el.hasAttribute('data-wblock-pc-hidden') && el.offsetHeight > 0;
    }, id);
    for (const id of ['top', 'more', 'footer']) assert.equal(await shown(id), true, `${label}: #${id} stays visible`);

    // Once the panel opens, the video has a box and its chrome is fair game again.
    await page.evaluate(() => document.getElementById('ai-panel').classList.remove('inactive'));
    await page.waitForTimeout(300);
    for (const id of ['top', 'more', 'footer']) assert.equal(await shown(id), true, `${label}: #${id} visible with the panel open`);
    assert.deepEqual(errors, [], `${label}: page errors`);
    console.log(`PASS ${label} unrendered video keeps the page`);
    await context.close();
  }
} finally {
  await browser.close();
}
