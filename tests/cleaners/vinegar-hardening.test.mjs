// Regression tests for the Vinegar-inspired hardening in Tube Cleaner and
// Player Cleaner (macOS Safari + iPhone WebKit):
// - WebKit CaptionMirror blocking (window.setupCaptionMirroring, synchronous
//   TextTrack.prototype.mode clamp) and MediaSession captionTracks sync
// - Auto-translated caption track (&tlang=) when browser language is absent
// - Original audio track selection (anti-AI auto-dubbing)
// - Playback rate & desktop volume locking/persistence + desktop mute sync
// - iOS m.youtube.com .page-container[inert] & body[faux-fullscreen] cleanup
// - PiP & fullscreen guards (disablePictureInPicture, webkitSetPresentationMode,
//   webkitExitFullscreen, gated site fullscreen/PiP listeners, contextmenu)
// - Spurious MediaSession play suppression after pause on an already-paused video
// - Background-opened tab visibility deferral + webkitvisibilitychange blocking
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit, devices } from 'playwright';

const tubeScript = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const playerScript = readFileSync(new URL('../../packages/player-cleaner/dist/player-cleaner.user.js', import.meta.url), 'utf8');
const tubeFixture = new URL('./fixture.html', import.meta.url).href;
const playerFixture = new URL('./fixture-player-cleaner-replace.html', import.meta.url).href;
const media = readFileSync(new URL('./media/sound.mp4', import.meta.url));

const captionSessionPrelude = `
window.__msState = { captionTracks: [], captionsEnabled: false, handlers: {} };
if (window.MediaSession) {
  let _tracks = [], _enabled = false;
  Object.defineProperty(MediaSession.prototype, 'captionTracks', {
    configurable: true,
    get() { return _tracks; },
    set(v) { _tracks = v; window.__msState.captionTracks = v; }
  });
  Object.defineProperty(MediaSession.prototype, 'captionsEnabled', {
    configurable: true,
    get() { return _enabled; },
    set(v) { _enabled = !!v; window.__msState.captionsEnabled = !!v; }
  });
  const _nativeSetHandler = MediaSession.prototype.setActionHandler;
  MediaSession.prototype.setActionHandler = function (action, handler) {
    window.__msState.handlers[action] = handler;
    try { return _nativeSetHandler.call(this, action, handler); } catch (e) {}
  };
}
`;

const foreignCaptionPrelude = `
window.__tlangRequests = [];
window.ytInitialPlayerResponse = window.ytInitialPlayerResponse || {};
window.ytInitialPlayerResponse.captions = {
  playerCaptionsTracklistRenderer: {
    captionTracks: [
      { baseUrl: 'https://captions.test/ja?lang=ja', languageCode: 'ja', name: { simpleText: 'Japanese' }, vssId: '.ja' }
    ]
  }
};
const _origFetch = window.fetch;
window.fetch = function (input) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.indexOf('https://captions.test/') === 0) {
    if (url.indexOf('tlang=') !== -1) window.__tlangRequests.push(url);
    return Promise.resolve(new Response('WEBVTT\\n\\n00:00:00.000 --> 00:00:04.000\\nHello translated\\n', {
      status: 200, headers: { 'Content-Type': 'text/vtt' }
    }));
  }
  return _origFetch ? _origFetch.apply(this, arguments) : Promise.reject(new Error('no fetch'));
};
`;

const browser = await webkit.launch();
try {
  // ------------------------------------------------------------------
  // 1. Tube Cleaner (macOS desktop): CaptionMirror, MediaSession captions,
  //    auto-translate, original audio, playback prefs/lock, mute sync,
  //    PiP/fullscreen/contextmenu guards, spurious play suppression
  // ------------------------------------------------------------------
  {
    const context = await browser.newContext({
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
    });
    await context.addInitScript(`
      localStorage.setItem('wblock.tubeCleaner.playback', JSON.stringify({ volume: 0.42, playbackRate: 1.75 }));
      window.__nativeHidden = false;
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__nativeHidden });
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => window.__nativeHidden ? 'hidden' : 'visible' });
      ${captionSessionPrelude}
      ${foreignCaptionPrelude}
      window.__audioSelected = null;
      window.__muteClicks = 0;
      window.__siteFsEvents = 0;
      window.__sitePipEvents = 0;
      window.__siteContextMenu = 0;
      document.addEventListener('DOMContentLoaded', () => {
        const player = document.getElementById('movie_player');
        const video = player && player.querySelector('video');
        if (player) {
          const origTrack = { id: '1;' + btoa('track:original:en') };
          const dubbedTrack = { id: '2;' + btoa('track:dubbed:fr') };
          player.getAvailableAudioTracks = () => [dubbedTrack, origTrack];
          player.getAudioTrack = () => window.__audioSelected || dubbedTrack;
          player.setAudioTrack = t => { window.__audioSelected = t; };
          player.isMuted = () => false;
          const muteBtn = document.createElement('button');
          muteBtn.className = 'ytp-mute-button';
          muteBtn.addEventListener('click', () => { window.__muteClicks++; });
          player.appendChild(muteBtn);
          player.addEventListener('contextmenu', () => { window.__siteContextMenu++; });
        }
        if (video) {
          video.addEventListener('webkitbeginfullscreen', () => { window.__siteFsEvents++; });
          video.addEventListener('webkitendfullscreen', () => { window.__siteFsEvents++; });
          video.addEventListener('webkitpresentationmodechanged', () => { window.__sitePipEvents++; });
          video.dispatchEvent(new Event('loadeddata'));
        }
      }, true);
    ` + '\n' + tubeScript);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(tubeFixture);
    await page.waitForSelector('.wblock-tc-native');
    await page.waitForFunction(() => document.querySelectorAll('track[data-wblock-native-subtitle]').length === 2);

    const result = await page.evaluate(() => {
      const video = document.querySelector('#movie_player video');
      const desc = Object.getOwnPropertyDescriptor(window, 'setupCaptionMirroring');
      const mirrorBlocked = !!(desc && desc.configurable === false && typeof window.setupCaptionMirroring === 'function');

      // Synchronous TextTrack.prototype.mode clamp on forced "YouTube Captions"
      const forced = video.addTextTrack('forced', 'YouTube Captions');
      forced.mode = 'showing';
      const forcedModeSync = forced.mode;

      // Auto-translated track added for en-US on a Japanese-only video
      const trackEls = Array.from(video.querySelectorAll('track[data-wblock-native-subtitle]'));
      const labels = trackEls.map(el => el.label);

      // MediaSession captionTracks synced and locked against YouTube overwrites
      navigator.mediaSession.captionTracks = [{ label: 'Fake YouTube', language: 'xx', enabled: true }];
      navigator.mediaSession.captionsEnabled = true;
      let siteHandlerInstalled = false;
      navigator.mediaSession.setActionHandler('togglecaptions', () => { siteHandlerInstalled = true; });
      const msLabelsBefore = window.__msState.captionTracks.map(t => t.label);
      window.__msState.handlers.selectcaptiontrack({ trackIndex: 1 });
      const afterSelect = {
        enabled: window.__msState.captionsEnabled,
        modes: trackEls.map(el => el.track.mode),
        msEnabled: window.__msState.captionTracks.map(t => t.enabled),
      };
      window.__msState.handlers.togglecaptions();
      const afterToggleOff = {
        enabled: window.__msState.captionsEnabled,
        modes: trackEls.map(el => el.track.mode),
        siteHandlerInstalled,
      };

      // Playback rate & volume restored and locked against YouTube writes
      const restoredVol = video.volume;
      const restoredRate = video.playbackRate;
      video.volume = 1;
      video.playbackRate = 1;
      video.defaultPlaybackRate = 1;
      const lockedVol = video.volume;
      const lockedRate = video.playbackRate;

      // Desktop mute sync when native mute toggles (bypassing JS muted setter)
      const nativeMutedSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
      // Simulate native UI muting (without calling JS setter): redefine muted getter temporarily
      Object.defineProperty(video, 'muted', { configurable: true, get: () => true });
      video.dispatchEvent(new Event('volumechange'));
      delete video.muted;

      // disablePictureInPicture locked false
      video.disablePictureInPicture = true;
      const pipDisabled = video.disablePictureInPicture;

      // PiP exit blocked for site calls while in PiP
      let modeCalls = [];
      Object.defineProperty(video, 'webkitPresentationMode', { configurable: true, value: 'picture-in-picture' });
      video.webkitSetPresentationMode = m => modeCalls.push(m);
      video.webkitSetPresentationMode('inline');
      video.webkitSetPresentationMode('fullscreen');

      // Site fullscreen & PiP-entry listeners gated; contextmenu stopped
      video.dispatchEvent(new Event('webkitbeginfullscreen'));
      video.dispatchEvent(new Event('webkitendfullscreen'));
      video.dispatchEvent(new Event('webkitpresentationmodechanged'));
      video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      // Spurious MediaSession play suppression on already-paused video
      video.dispatchEvent(new Event('play'));
      let playCalls = 0;
      Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
      video.play = () => { playCalls++; return Promise.resolve(); };
      video.pause = () => {};
      window.__msState.handlers.pause();
      window.__msState.handlers.play(); // spurious -> dropped
      const afterSpurious = playCalls;
      window.__msState.handlers.play(); // real second press -> plays
      const afterSecond = playCalls;

      return {
        mirrorBlocked, forcedModeSync, labels, tlangRequests: window.__tlangRequests.length,
        msLabelsBefore, afterSelect, afterToggleOff,
        audioSelected: window.__audioSelected && window.__audioSelected.id,
        restoredVol, restoredRate, lockedVol, lockedRate,
        muteClicks: window.__muteClicks, pipDisabled, modeCalls,
        siteFsEvents: window.__siteFsEvents, sitePipEvents: window.__sitePipEvents,
        siteContextMenu: window.__siteContextMenu,
        afterSpurious, afterSecond,
      };
    });

    assert.equal(result.mirrorBlocked, true, 'setupCaptionMirroring locked');
    assert.equal(result.forcedModeSync, 'disabled', 'CaptionMirror forced track clamped synchronously');
    assert.equal(result.labels.length, 2, 'adds auto-translated track alongside Japanese');
    assert.ok(result.labels[1].startsWith('Auto-translated ('), `label=${result.labels[1]}`);
    assert.equal(result.tlangRequests, 1, 'fetches &tlang= caption track');
    assert.deepEqual(result.msLabelsBefore, result.labels, 'MediaSession captionTracks locked against YouTube');
    assert.equal(result.afterSelect.enabled, true, 'selectcaptiontrack enables chosen track');
    assert.deepEqual(result.afterSelect.modes, ['disabled', 'showing']);
    assert.deepEqual(result.afterSelect.msEnabled, [false, true]);
    assert.equal(result.afterToggleOff.enabled, false, 'togglecaptions disables active track');
    assert.deepEqual(result.afterToggleOff.modes, ['disabled', 'disabled']);
    assert.equal(result.afterToggleOff.siteHandlerInstalled, false, 'YouTube cannot overwrite togglecaptions');
    assert.ok(result.audioSelected && atob(result.audioSelected.split(';')[1]).includes('original'), 'selects original audio track');
    assert.ok(Math.abs(result.restoredVol - 0.42) < 0.01 && result.restoredRate === 1.75, 'restores volume & rate');
    assert.ok(Math.abs(result.lockedVol - 0.42) < 0.01 && result.lockedRate === 1.75, 'locks volume & rate against site resets');
    assert.equal(result.muteClicks, 1, 'syncs native mute toggle back to YouTube');
    assert.equal(result.pipDisabled, false, 'disablePictureInPicture locked false');
    assert.deepEqual(result.modeCalls, ['fullscreen'], 'blocks site webkitSetPresentationMode(inline) during PiP');
    assert.equal(result.siteFsEvents, 0, 'gates YouTube webkitbeginfullscreen/webkitendfullscreen listeners');
    assert.equal(result.sitePipEvents, 0, 'gates YouTube PiP webkitpresentationmodechanged listener');
    assert.equal(result.siteContextMenu, 0, 'stops contextmenu bubbling to player shell');
    assert.equal(result.afterSpurious, 0, 'drops spurious MediaSession play after pause on paused video');
    assert.equal(result.afterSecond, 1, 'second MediaSession play always goes through');
    assert.deepEqual(errors, []);
    console.log('PASS Tube Cleaner desktop hardening (CaptionMirror, MediaSession captions, auto-translate, original audio, playback lock, mute sync, PiP/FS guards, spurious play)');
    await context.close();
  }

  // ------------------------------------------------------------------
  // 2. Tube Cleaner (iPhone): inert / faux-fullscreen cleanup, iOS rate lock
  //    without touching volume, and background-opened tab visibility deferral
  // ------------------------------------------------------------------
  {
    const context = await browser.newContext(devices['iPhone 13']);
    await context.addInitScript(`
      localStorage.setItem('wblock.tubeCleaner.playback', JSON.stringify({ volume: 0.25, playbackRate: 1.5 }));
      window.__nativeHidden = true;
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__nativeHidden });
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => window.__nativeHidden ? 'hidden' : 'visible' });
      document.addEventListener('DOMContentLoaded', () => {
        const pc = document.createElement('div');
        pc.className = 'page-container';
        pc.inert = true;
        document.body.appendChild(pc);
        document.body.setAttribute('faux-fullscreen', '');
      }, true);
    ` + '\n' + tubeScript);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(tubeFixture);
    await page.waitForSelector('.wblock-tc-native');

    const iosResult = await page.evaluate(async () => {
      const hiddenAtBgOpen = document.hidden;
      const stateAtBgOpen = document.visibilityState;
      // Now user switches to the tab -> becomes visible, then switches away
      window.__nativeHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      window.__nativeHidden = true;
      let webkitVisReachedPage = false;
      document.addEventListener('webkitvisibilitychange', () => { webkitVisReachedPage = true; });
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('webkitvisibilitychange'));
      const hiddenAfterReturnAndHide = document.hidden;
      const stateAfterReturnAndHide = document.visibilityState;

      const pc = document.querySelector('.page-container');
      const initialInert = pc.inert;
      const initialFaux = document.body.hasAttribute('faux-fullscreen');
      pc.inert = true;
      document.body.setAttribute('faux-fullscreen', 'true');
      await new Promise(r => setTimeout(r, 20));
      const clearedInert = pc.inert;
      const clearedFaux = document.body.hasAttribute('faux-fullscreen');

      const video = document.querySelector('#movie_player video');
      const rateRestored = video.playbackRate;
      video.playbackRate = 1;
      const rateLocked = video.playbackRate;
      const volUntouched = video.volume === 1;

      return {
        hiddenAtBgOpen, stateAtBgOpen, hiddenAfterReturnAndHide, stateAfterReturnAndHide,
        webkitVisReachedPage, initialInert, initialFaux, clearedInert, clearedFaux,
        rateRestored, rateLocked, volUntouched,
      };
    });

    assert.equal(iosResult.hiddenAtBgOpen, true, 'background-opened tab stays hidden until first viewed');
    assert.equal(iosResult.stateAtBgOpen, 'hidden');
    assert.equal(iosResult.hiddenAfterReturnAndHide, false, 'background playback activates after first view');
    assert.equal(iosResult.stateAfterReturnAndHide, 'visible');
    assert.equal(iosResult.webkitVisReachedPage, false, 'blocks webkitvisibilitychange when hidden');
    assert.equal(iosResult.initialInert, false, 'clears .page-container inert on iOS');
    assert.equal(iosResult.initialFaux, false, 'strips body faux-fullscreen on iOS');
    assert.equal(iosResult.clearedInert, false, 're-clears .page-container inert on mutation');
    assert.equal(iosResult.clearedFaux, false, 're-strips body faux-fullscreen on mutation');
    assert.equal(iosResult.rateRestored, 1.5, 'restores iOS playbackRate');
    assert.equal(iosResult.rateLocked, 1.5, 'locks iOS playbackRate');
    assert.equal(iosResult.volUntouched, true, 'does not lock/override hardware volume on iOS');
    assert.deepEqual(errors, []);
    console.log('PASS Tube Cleaner iPhone hardening (inert/faux-fullscreen, iOS rate lock, background-tab deferral)');
    await context.close();
  }

  // ------------------------------------------------------------------
  // 3. Player Cleaner (macOS desktop): MediaSession captionTracks sync,
  //    volume/rate locking, PiP/FS/contextmenu guards, spurious play,
  //    and visibilitychange/webkitvisibilitychange capture blocking
  // ------------------------------------------------------------------
  {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
    });
    await context.addInitScript(`
      localStorage.setItem('wblock.playerCleaner.preferences', JSON.stringify({ playbackRate: 1.5, volume: 0.4 }));
      window.__nativeHidden = false;
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__nativeHidden });
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => window.__nativeHidden ? 'hidden' : 'visible' });
      ${captionSessionPrelude}
      window.__pcSiteFs = 0;
      window.__pcSitePip = 0;
      window.__pcSiteCtx = 0;
      window.__pcSiteVis = 0;
      document.addEventListener('visibilitychange', () => { window.__pcSiteVis++; });
      document.addEventListener('webkitvisibilitychange', () => { window.__pcSiteVis++; });
    ` + '\n' + playerScript);

    await context.route('**/sound.mp4', route => route.fulfill({ contentType: 'video/mp4', body: media }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(playerFixture);
    await page.waitForSelector('video[data-wblock-player-cleaner]');

    const pcResult = await page.evaluate(() => {
      const video = document.querySelector('video[data-wblock-player-cleaner]');
      const wrap = video.parentElement;
      wrap.addEventListener('contextmenu', () => { window.__pcSiteCtx++; });
      video.addEventListener('webkitbeginfullscreen', () => { window.__pcSiteFs++; });
      video.addEventListener('webkitendfullscreen', () => { window.__pcSiteFs++; });
      video.addEventListener('webkitpresentationmodechanged', () => { window.__pcSitePip++; });

      // Site attempts to reset playbackRate and volume
      video.playbackRate = 1;
      video.defaultPlaybackRate = 1;
      video.volume = 1;
      const rateAfterReset = video.playbackRate;
      const volAfterReset = video.volume;

      // Trigger MediaSession activation + caption sync
      let playCalls = 0;
      Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
      video.dispatchEvent(new Event('play'));
      const msLabels = window.__msState.captionTracks.map(t => t.label);
      navigator.mediaSession.captionTracks = [{ label: 'Site Override', language: 'xx', enabled: true }];
      const msLabelsAfterSiteWrite = window.__msState.captionTracks.map(t => t.label);
      window.__msState.handlers.selectcaptiontrack({ trackIndex: 0 });
      const selectedEnabled = window.__msState.captionsEnabled;

      // Spurious play after pause on already-paused video
      Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
      video.play = () => { playCalls++; return Promise.resolve(); };
      video.pause = () => {};
      window.__msState.handlers.pause();
      window.__msState.handlers.play();
      const afterSpurious = playCalls;
      window.__msState.handlers.play();
      const afterSecond = playCalls;

      // PiP & fullscreen guards
      video.disablePictureInPicture = true;
      const pipDisabled = video.disablePictureInPicture;
      let modeCalls = [];
      Object.defineProperty(video, 'webkitPresentationMode', { configurable: true, value: 'picture-in-picture' });
      video.webkitSetPresentationMode = m => modeCalls.push(m);
      video.webkitSetPresentationMode('inline');
      video.dispatchEvent(new Event('webkitbeginfullscreen'));
      video.dispatchEvent(new Event('webkitendfullscreen'));
      video.dispatchEvent(new Event('webkitpresentationmodechanged'));
      video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      // visibilitychange / webkitvisibilitychange blocked on hide
      window.__pcSiteVis = 0;
      window.__nativeHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('webkitvisibilitychange'));

      return {
        rateAfterReset, volAfterReset, msLabels, msLabelsAfterSiteWrite, selectedEnabled,
        afterSpurious, afterSecond, pipDisabled, modeCalls,
        siteFs: window.__pcSiteFs, sitePip: window.__pcSitePip, siteCtx: window.__pcSiteCtx,
        siteVis: window.__pcSiteVis,
      };
    });

    assert.equal(pcResult.rateAfterReset, 1.5, 'Player Cleaner locks playbackRate against site resets');
    assert.ok(Math.abs(pcResult.volAfterReset - 0.4) < 0.01, 'Player Cleaner locks volume against site resets');
    assert.ok(pcResult.msLabels.length >= 1, 'Player Cleaner syncs MediaSession captionTracks');
    assert.deepEqual(pcResult.msLabelsAfterSiteWrite, pcResult.msLabels, 'Player Cleaner guards MediaSession captionTracks');
    assert.equal(pcResult.selectedEnabled, true, 'Player Cleaner selectcaptiontrack enables subtitle track');
    assert.equal(pcResult.afterSpurious, 0, 'Player Cleaner drops spurious play after pause on paused video');
    assert.equal(pcResult.afterSecond, 1, 'Player Cleaner allows second play press');
    assert.equal(pcResult.pipDisabled, false, 'Player Cleaner locks disablePictureInPicture false');
    assert.deepEqual(pcResult.modeCalls, [], 'Player Cleaner blocks site webkitSetPresentationMode(inline) in PiP');
    assert.equal(pcResult.siteFs, 0, 'Player Cleaner gates site fullscreen listeners');
    assert.equal(pcResult.sitePip, 0, 'Player Cleaner gates site PiP presentation listener');
    assert.equal(pcResult.siteCtx, 0, 'Player Cleaner stops contextmenu bubbling');
    assert.equal(pcResult.siteVis, 0, 'Player Cleaner stops site visibilitychange/webkitvisibilitychange on hide');
    assert.deepEqual(errors, []);
    console.log('PASS Player Cleaner hardening (MediaSession captions, playback lock, PiP/FS/ctx guards, spurious play, visibility blocking)');
    await context.close();
  }
} finally {
  await browser.close();
}
