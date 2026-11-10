// A slotted video renders inside the shadow tree of the element it is slotted
// into, so the shadow elements around that slot are its ancestors on screen.
// nytimes.com server-renders its players as declarative shadow roots: the video
// lives in <nyt-betamax>, slotted into <nyt-video-feed>, whose shadow tree wraps
// the slot in the feed's scroller. Player Cleaner hid that wrapper as chrome, so
// the video area went blank with only the photo credit left, and unmuting the
// top story opened a feed nobody could see. Covers four things: a slot's
// wrapper is never hidden, the hidden cover's picture becomes the poster, a
// snapping feed is left to the site however large it grows, and a declarative
// shadow root attached after its host is still found.
// Runs on real media in WebKit, desktop and iPhone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));
const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="teal"/></svg>');
const player = id => `<x-player id="${id}"><template shadowrootmode="open">
  <style>:host { display: grid; width: 100%; height: 100%; } video { width: 100%; height: 100%; }</style>
  <div class="box"><video src="/sound.mp4" muted playsinline preload="none"></video></div><slot></slot>
</template><div class="cover" style="position:absolute;inset:0"><x-poster><template shadowrootmode="open"><img src="${poster}" style="width:100%"></template></x-poster><button>Play</button></div></x-player>`;
const shell = (id, scroller) => `<div class="media" style="position:relative;width:320px;height:480px">
<x-feed id="${id}" style="position:absolute;display:contents"><template shadowrootmode="open">
  <style>.wrap, .feed, article { width: 320px; height: 480px; } .feed { ${scroller} } .close { position: absolute; top: 8px; right: 8px; width: 40px; height: 40px; }</style>
  <div class="wrap"><div class="backdrop" style="position:fixed;display:none"></div>
    <div class="feed"><article><slot></slot></article></div>
    <button class="close">Close</button></div>
</template>${player(id + '-player')}</x-feed></div><p class="credit">Photo credit</p>`;
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body { margin: 0; }</style></head><body>
${shell('plain', '')}
${shell('feed', 'overflow-y: auto; scroll-snap-type: y mandatory;')}
</body></html>`;

const late = ['<!doctype html><html><head><meta charset="utf-8"></head><body><!--' + 'x'.repeat(4096) + '--><div style="position:relative;width:320px;height:180px"><x-late id="late">',
  '<template shadowrootmode="open"><video src="/sound.mp4" playsinline preload="auto" style="width:320px;height:180px"></video><slot></slot></template><div class="cover" style="position:absolute;inset:0"><button>Play</button></div></x-late></div></body></html>'];
const server = createServer((request, response) => {
  if (request.url === '/sound.mp4') { response.writeHead(200, { 'content-type': 'video/mp4' }); response.end(media); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.write(late[0]);
  setTimeout(() => response.end(late[1]), 300);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const browser = await webkit.launch();
try {
  for (const [label, device] of [['desktop', {}], ['iPhone', devices['iPhone 13']]]) {
    const context = await browser.newContext(device);
    await context.addInitScript({ content: script });
    await context.route('https://fixture.test/**', route => new URL(route.request().url()).pathname === '/sound.mp4'
      ? route.fulfill({ contentType: 'video/mp4', body: media })
      : route.fulfill({ contentType: 'text/html', body: fixture }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://fixture.test/');
    const state = id => page.evaluate(id => {
      const host = document.getElementById(id), feed = host.closest('x-feed') || host;
      const video = host.shadowRoot.querySelector('video');
      const hidden = root => [...root.querySelectorAll('[data-wblock-pc-hidden]')].map(el => el.className || el.tagName);
      return { enhanced: video.hasAttribute('data-wblock-player-cleaner'), controls: video.controls, height: video.offsetHeight,
        hidden: [...hidden(feed.shadowRoot || feed), ...hidden(feed)], close: feed.shadowRoot ? feed.shadowRoot.querySelector('.close').offsetHeight : null };
    }, id);

    // The plain slotted player is enhanced; the wrapper around its slot stays.
    await page.waitForFunction(() => document.getElementById('plain-player').shadowRoot.querySelector('video[data-wblock-player-cleaner]'));
    await page.waitForTimeout(300);
    const plain = await state('plain-player');
    assert.equal(plain.controls, true, `${label}: slotted player gets native controls`);
    assert.ok(plain.height > 100, `${label}: slotted video keeps its box (${plain.height}px)`);
    assert.ok(!plain.hidden.includes('wrap') && !plain.hidden.includes('feed'), `${label}: slot wrappers stay visible (${plain.hidden})`);
    assert.ok(plain.hidden.includes('cover'), `${label}: the site's own cover is still hidden`);
    assert.equal(await page.evaluate(() => document.getElementById('plain-player').shadowRoot.querySelector('video').poster), poster, `${label}: the hidden cover's picture becomes the native poster`);

    // The snapping feed is left alone, also after the site's sound button and
    // however many items the feed loads.
    const untouched = async step => {
      const feed = await state('feed-player');
      assert.deepEqual([feed.enhanced, feed.controls, feed.hidden], [false, false, []], `${label}: feed left to the site ${step}`);
      assert.ok(feed.height > 100 && feed.close > 0, `${label}: feed video and close button visible ${step}`);
    };
    await untouched('on load');
    await page.evaluate(() => { document.getElementById('feed-player').shadowRoot.querySelector('video').muted = false; });
    await page.waitForTimeout(300);
    await untouched('after the site unmutes it');
    for (let round = 0; round < 3; round++) {
      await page.evaluate(() => {
        const feed = document.getElementById('feed');
        for (let i = 0; i < 5; i++) feed.insertAdjacentHTML('beforeend', '<div class="item"><button>Next</button></div>');
        feed.shadowRoot.querySelector('.feed').insertAdjacentHTML('beforeend', '<article><video src="/sound.mp4" playsinline style="width:100%;height:100%"></video></article>');
      });
      await page.waitForTimeout(200);
      await untouched(`with ${round + 1} more batches of items`);
    }
    assert.equal(await page.evaluate(() => document.getElementById('feed').querySelectorAll('[data-wblock-pc-hidden]').length +
      document.getElementById('feed').shadowRoot.querySelectorAll('[data-wblock-pc-hidden],video[controls]').length), 0, `${label}: nothing hidden or taken over in the grown feed`);

    // A declarative shadow root parsed after its host was inserted: the parser
    // attaches it without calling attachShadow. The response is streamed so
    // the host lands in the page one chunk before its template.
    await page.goto(`http://127.0.0.1:${server.address().port}/late`);
    await page.waitForFunction(() => document.getElementById('late').shadowRoot.querySelector('video[data-wblock-player-cleaner]'), null, { timeout: 5000 })
      .catch(() => assert.fail(`${label}: a late declarative shadow root is never found`));
    assert.deepEqual(errors, [], `${label}: page errors`);
    console.log(`PASS ${label} slotted players, snapping feed and late declarative shadow root`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
