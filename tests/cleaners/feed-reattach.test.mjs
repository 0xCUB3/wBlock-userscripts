// Reddit's feed unloads a post's player when it scrolls away (drops the src
// and calls load()), detaches the post, and later puts the same element back.
// Its HLS player then attaches a ManagedMediaSource blob through a <source>
// child. On iOS Player Cleaner had already swapped in the host's native HLS
// URL and given the video native controls; after the round trip the blob
// stayed on the enhanced video and iOS showed the crossed-out play glyph,
// because WebKit refuses that attachment while native controls are on.
// The video must play the native URL again, or be handed back to the site.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const script = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const hls = 'https://v.redd.it/fixture/HLSPlaylist.m3u8?f=hd';
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>body { margin: 0; } shreddit-player { display: block; width: 320px; height: 180px; }</style>
<script>
customElements.define('shreddit-player', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) { return; }
    this.attachShadow({ mode: 'open' }).innerHTML =
      '<style>video { width: 100%; height: 100%; }</style><video playsinline muted></video><shreddit-media-ui><button>Play</button></shreddit-media-ui>';
  }
  get video() { return this.shadowRoot.querySelector('video'); }
  // hls.js on iOS: drop the src, then attach the stream through a <source>.
  start() {
    const v = this.video;
    v.removeAttribute('src');
    v.load();
    const source = document.createElement('source');
    source.src = URL.createObjectURL(new MediaSource());
    v.appendChild(source);
  }
  stop() { this.video.removeAttribute('src'); this.video.load(); }
});
</script></head><body><shreddit-feed><article id="post"><shreddit-player src="${hls}"></shreddit-player></article></shreddit-feed></body></html>`;

const browser = await webkit.launch();
try {
  const context = await browser.newContext(devices['iPhone 13']);
  await context.addInitScript({ content: script });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.reddit.com/r/fixture/');
  const state = () => page.evaluate(() => {
    const v = document.querySelector('shreddit-player').video;
    return { src: v.getAttribute('src'), blob: !!v.querySelector('source[src^="blob:"]'), controls: v.controls };
  });
  await page.evaluate(() => document.querySelector('shreddit-player').start());
  await page.waitForTimeout(300);
  assert.deepEqual(await state(), { src: hls, blob: false, controls: true }, 'first load plays the native HLS URL with native controls');

  for (let cycle = 1; cycle <= 6; cycle++) {
    // Scrolled away: unloaded, then detached from the feed.
    await page.evaluate(() => {
      const post = document.getElementById('post');
      post.querySelector('shreddit-player').stop();
      window.__post = post;
      post.remove();
    });
    await page.waitForTimeout(100);
    // Scrolled back: the same post returns and its player attaches again.
    await page.evaluate(() => {
      document.querySelector('shreddit-feed').appendChild(window.__post);
      document.querySelector('shreddit-player').start();
    });
    await page.waitForTimeout(300);
    const s = await state();
    assert.ok(s.src === hls && !s.blob && s.controls || !s.controls,
      `cycle ${cycle}: native URL with controls, or handed back to the site (${JSON.stringify(s)})`);
  }
  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS feed player reattached after unload keeps a playable source');
  await context.close();
} finally {
  await browser.close();
}
