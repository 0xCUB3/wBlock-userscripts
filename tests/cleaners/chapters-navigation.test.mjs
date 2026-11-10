import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const fixture = new URL('./fixture.html', import.meta.url).href;
const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`
    const __wblockTubeCleanerFeatures = { backgroundPlayback: false, sponsorBlock: false,
      pictureInPicture: false, toolbar: false, chapters: true, captions: false, resumePosition: false };
    window.chapterPayload = function (id, title) {
      return { currentVideoEndpoint: { watchEndpoint: { videoId: id } },
        engagementPanels: title ? [{ chapterRenderer: {
          title: { simpleText: title }, timeRangeStartMillis: 0
        }}] : [] };
    };
    window.ytInitialData = window.chapterPayload('FIRSTVID001', 'First video');
    window.ytInitialPlayerResponse = { videoDetails: { videoId: 'FIRSTVID001' } };
    history.replaceState(null, '', location.pathname + '?v=FIRSTVID001');
  ` + script);
  await page.goto(fixture);
  await page.waitForSelector('.wblock-tc-native');

  async function expectChapter(title) {
    await page.waitForFunction(title => {
      const video = document.querySelector('#movie_player video');
      const tracks = Array.from(video.textTracks).filter(track => track.kind === 'chapters');
      return tracks.length === 1 && tracks[0].mode === 'hidden' &&
        tracks[0].cues?.length === 1 && tracks[0].cues[0].text === '0:00  ' + title;
    }, title, { timeout: 3500 });
  }
  async function navigate(id, title, { app = false, signal = true, mobile = false } = {}) {
    await page.evaluate(({ id, title, app, signal, mobile }) => {
      const [watchTag, appTag] = mobile ? ['ytm-watch', 'ytm-app'] : ['ytd-watch-flexy', 'ytd-app'];
      let watch = document.querySelector(watchTag);
      if (!watch) { watch = document.createElement(watchTag); document.body.appendChild(watch); }
      let shell = document.querySelector(appTag);
      if (!shell) { shell = document.createElement(appTag); document.body.appendChild(shell); }
      watch.data = app ? null : window.chapterPayload(id, title);
      shell.data = app ? { response: window.chapterPayload(id, title) } : null;
      const player = document.getElementById('movie_player');
      player.getPlayerResponse = () => ({ videoDetails: { videoId: id } });
      history.replaceState(null, '', location.pathname + '?v=' + id);
      if (signal) document.dispatchEvent(new Event('yt-navigate-finish'));
    }, { id, title, app, signal, mobile });
  }
  await expectChapter('First video');
  // m.youtube.com keeps the next video's watch response on ytm-watch / ytm-app.
  await navigate('MOBILEVID01', 'Mobile second', { mobile: true });
  await expectChapter('Mobile second');
  await navigate('MOBILEVID02', 'Mobile third', { mobile: true, app: true });
  await expectChapter('Mobile third');
  await page.evaluate(() => document.querySelectorAll('ytm-watch, ytm-app').forEach(node => node.remove()));
  console.log('PASS: m.youtube.com SPA navigation reads ytm-watch and ytm-app data');

  await navigate('SECONDVID02', 'Second video');
  await expectChapter('Second video');
  assert.equal(await page.evaluate(() => window.ytInitialData.currentVideoEndpoint.watchEndpoint.videoId), 'FIRSTVID001');
  console.log('PASS: SPA navigation reads live watch data while initial globals stay stale');

  await navigate('THIRDVID003', 'Second video', { app: true });
  await expectChapter('Second video');
  console.log('PASS: ytd-app response and identical chapter titles on a different video');

  await navigate('EMPTYVID004', null);
  await page.waitForFunction(() => !document.querySelector('track[data-wblock-native-chapters]'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('track[data-wblock-native-chapters]').count(), 0);
  console.log('PASS: a chapterless video never inherits the initial page chapters');

  // A data signal can precede actual hydration even after the first retry window.
  await page.waitForTimeout(10500);
  await page.evaluate(() => document.dispatchEvent(new Event('yt-page-data-updated')));
  await page.waitForTimeout(100);
  await navigate('EMPTYVID004', 'Late chapters', { signal: false });
  await expectChapter('Late chapters');
  console.log('PASS: a later data signal restarts bounded retries for silent hydration');

  await page.evaluate(() => {
    document.querySelector('track[data-wblock-native-chapters]').remove();
    document.querySelector('#movie_player video').dispatchEvent(new Event('loadedmetadata'));
  });
  await expectChapter('Late chapters');
  assert.deepEqual(errors, []);
  console.log('PASS: chapter tracks recover after media metadata reload without toggling the feature');
} finally {
  await browser.close();
}
