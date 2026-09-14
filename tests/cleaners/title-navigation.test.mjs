import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

const fixture = readFileSync(new URL('./fixture.html', import.meta.url), 'utf8');
const browser = await webkit.launch();
try {
  for (const slug of ['dearrow', 'tube-cleaner']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
    await page.goto('https://fixture.test/watch?v=FIRSTVID001');
    await page.evaluate(() => {
      window.heading = document.querySelector('#watch-metadata h1 yt-formatted-string');
      // Model a renderer that retains its own nodes, as Polymer does.
      window.renderTitle = title => {
        (window.titleRuns || []).forEach(node => node.remove());
        const run = document.createElement('span');
        run.appendChild(document.createTextNode(title));
        window.titleRuns = [run];
        window.heading.appendChild(run);
      };
      window.heading.replaceChildren();
      window.renderTitle('First original');
      window.firstRun = window.titleRuns[0];
      window.firstText = window.firstRun.firstChild;
      window.card = document.querySelector('ytd-compact-video-renderer');
      window.cardTitle = window.card.querySelector('#video-title');
      window.cardRuns = ['Card ', 'original'].map(text => {
        const span = document.createElement('span');
        span.textContent = text;
        return span;
      });
      window.cardTitle.replaceChildren(...window.cardRuns);
    });
    const script = readFileSync(new URL(`../../packages/${slug}/dist/${slug}.user.js`, import.meta.url), 'utf8');
    await page.evaluate(`
      const __wblockTubeCleanerFeatures = { backgroundPlayback: false, sponsorBlock: false,
        pictureInPicture: false, toolbar: false, chapters: false, captions: false, resumePosition: false };
      const __wblockDeArrowSettings = { enabled: true, replaceTitles: true,
        replaceThumbnails: false, showOriginalOnHover: true };
      const __wblockTubeCleanerDeArrow = __wblockDeArrowSettings;
      const branding = {
        FIRSTVID001: { titles: [{ title: 'First custom', votes: 4 }] },
        SECONDVID02: { titles: [] },
        THIRDVID003: { titles: [{ title: 'Third custom', votes: 4 }] },
        CARDVID1234: { titles: [{ title: 'Card custom', votes: 4 }] }
      };
      window.fetch = async url => ({ ok: true, status: 200,
        json: async () => branding[new URL(url).searchParams.get('videoID')] || branding });
    ` + script);
    await page.waitForFunction(() => window.heading.textContent === 'First custom');
    assert.equal(await page.evaluate(() => window.firstRun.parentNode === window.heading &&
      window.firstRun.firstChild === window.firstText), true);
    await page.waitForFunction(() => window.cardTitle.textContent === 'Card custom');
    for (const [event, expected] of [['mouseenter', 'Card original'], ['mouseleave', 'Card custom']]) {
      await page.evaluate(event => window.card.dispatchEvent(new Event(event)), event);
      assert.equal(await page.evaluate(() => window.cardTitle.textContent), expected);
      assert.equal(await page.evaluate(() => window.cardRuns.every(run => run.parentNode === window.cardTitle)), true);
    }
    await page.evaluate(() => { window.cardRuns[1].firstChild.data = 'changed'; });
    await page.waitForFunction(() => window.cardTitle.textContent === 'Card custom');
    await page.evaluate(() => window.card.dispatchEvent(new Event('mouseenter')));
    assert.equal(await page.evaluate(() => window.cardTitle.textContent), 'Card changed');
    await page.evaluate(() => window.card.dispatchEvent(new Event('mouseleave')));
    await page.evaluate(() => {
      history.pushState(null, '', '/watch?v=SECONDVID02');
      window.renderTitle('Second original');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.heading.textContent), 'Second original',
      `${slug}: navigating to an unbranded video must not retain the previous title`);
    await page.evaluate(() => {
      history.pushState(null, '', '/watch?v=THIRDVID003');
      window.renderTitle('Third original');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForFunction(() => window.heading.textContent === 'Third custom');
    assert.equal(await page.evaluate(() => window.titleRuns[0].parentNode === window.heading), true);
    await page.evaluate(() => window.__wblockDeArrowDebug.setSetting('replaceTitles', false));
    assert.equal(await page.evaluate(() => window.heading.textContent), 'Third original');
    assert.equal(await page.evaluate(() => window.heading.childNodes.length), 1);

    // Reusing the same Text object must also work across title changes.
    await page.evaluate(() => {
      window.reusedText = window.titleRuns[0].firstChild;
      window.reusedText.data = 'Updated original';
      window.__wblockDeArrowDebug.setSetting('replaceTitles', true);
    });
    await page.waitForFunction(() => window.heading.textContent === 'Third custom');
    assert.equal(await page.evaluate(() => window.titleRuns[0].firstChild === window.reusedText), true);
    await page.evaluate(() => window.__wblockDeArrowDebug.setSetting('enabled', false));
    assert.equal(await page.evaluate(() => window.heading.textContent), 'Updated original');
    // A late branding response for a departed video must not replace the next title.
    await page.evaluate(() => {
      window.fetch = () => new Promise(resolve => { window.releaseBranding = () => resolve({
        ok: true, status: 200, json: async () => ({ SLOWVID0001: { titles: [{ title: 'Stale custom', votes: 4 }] } })
      }); });
      history.pushState(null, '', '/watch?v=SLOWVID0001');
      window.renderTitle('Slow original');
      window.__wblockDeArrowDebug.setSetting('enabled', true);
    });
    await page.waitForFunction(() => typeof window.releaseBranding === 'function');
    await page.evaluate(() => {
      history.pushState(null, '', '/watch?v=SECONDVID02');
      window.renderTitle('Latest original');
      document.dispatchEvent(new Event('yt-navigate-finish'));
      window.releaseBranding();
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.heading.textContent), 'Latest original');
    assert.deepEqual(errors, []);
    console.log(`PASS ${slug}: successive titles, missing branding, node reuse, and restoration`);
    await page.close();
  }
} finally {
  await browser.close();
}
