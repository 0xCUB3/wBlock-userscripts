import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const source = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const browser = await webkit.launch();
try {
  for (const device of [null, devices['iPhone 13']]) {
    // On iPhone, hide-time PiP is background playback, so only that switch gates it.
    for (const config of [
      { name: 'app disabled', app: false, expected: !!device },
      { name: 'site disabled', app: true, site: '0', expected: !!device },
      { name: 'app overrides site', app: false, site: '1', expected: !!device },
      { name: 'enabled', app: true, expected: true },
      { name: 'default', expected: true },
      { name: 'background playback disabled', background: false, expected: !device },
    ]) {
      const context = await browser.newContext(device || {});
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><div id="movie_player"><video playsinline></video></div>' }));
      await context.addInitScript(({ app, site, background }) => {
        window.__wblockTubeCleanerFeatures = { pictureInPicture: app, backgroundPlayback: background };
        if (site !== undefined) localStorage.setItem('wblock.tubeCleaner.autoPiP', site);
        // WebKit's YouTube caption bridge expects the site's player API.
        HTMLElement.prototype.getOption = () => [];
        HTMLElement.prototype.isSubtitlesOn = () => false;
        HTMLElement.prototype.setOption = () => {};
        HTMLElement.prototype.loadModule = () => {};
        window.nativeHidden = false;
        Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.nativeHidden });
      }, config);
      await context.addInitScript({ content: source });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('https://music.youtube.com/watch?v=test');
      await page.waitForFunction(() => window.__wblockTubeDebug?.music.state().video);
      const state = await page.evaluate(() => {
        const video = document.querySelector('video');
        Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
        Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
        video.webkitSupportsPresentationMode = () => true;
        video.webkitPresentationMode = 'inline';
        let requests = 0;
        video.webkitSetPresentationMode = mode => { video.webkitPresentationMode = mode; requests++; };
        // The iPhone path requests PiP before the hidden event arrives.
        window.dispatchEvent(new Event('blur'));
        const blurRequests = requests;
        video.webkitPresentationMode = 'inline';
        requests = 0;
        window.nativeHidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        return { blurRequests, hiddenRequests: requests, backgroundPlayback: document.hidden === false };
      });
      const label = `${device ? 'iPhone' : 'desktop'} ${config.name}`;
      assert.equal(state.hiddenRequests, config.expected ? 1 : 0, `${label}: tab hiding`);
      assert.equal(state.blurRequests, device && config.expected ? 1 : 0, `${label}: blur`);
      assert.equal(state.backgroundPlayback, config.background !== false, `${label}: background playback`);
      assert.deepEqual(errors, [], `${label}: page errors`);
      console.log(`PASS ${label}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
