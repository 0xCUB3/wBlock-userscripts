// Autonomous WebKit (Safari-engine) test harness for the Tube Cleaner and
// Player Cleaner userscripts.
//
// It loads synthetic pages in Playwright WebKit, injects the current distribution
// at document-start in the page world (matching `@run-at` +
// `@inject-into page`), and asserts the player transformation actually happens.
// Scenarios:
//   1. desktop  – Tube Cleaner, macOS Safari-like
//   2. iPhone   – Tube Cleaner, mobile Safari (touch, mobile UA)
//   3. iPad desktop-site – Tube Cleaner, iPadOS requesting www.youtube.com
//   4. Player Cleaner – opaque (blob) source, enhance-in-place + controls guard
//   5. Player Cleaner – clean source, full replacement path (poster/tracks copy)
//   6. Player Cleaner – media-element source ownership vs external API hints
//
// Exit code is non-zero if any assertion fails, so this can gate CI.
// Usage: node run-tests.mjs [--filter substring]

import { webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'packages', 'tube-cleaner', 'dist', 'tube-cleaner.user.js');
const PLAYER_SCRIPT_PATH = join(__dirname, '..', '..', 'packages', 'player-cleaner', 'dist', 'player-cleaner.user.js');
const INJECTOR_PATH = join(__dirname, 'userscript-injector.js');
const FIXTURE_URL = pathToFileURL(join(__dirname, 'fixture.html')).href;
const FIXTURE_NOPI_URL = pathToFileURL(join(__dirname, 'fixture-noplaysinline.html')).href;
const FIXTURE_TUBE_EARLY_URL = pathToFileURL(join(__dirname, 'fixture-tube-cleaner-early.html')).href;
const FIXTURE_TUBE_MULTIPLE_URL = pathToFileURL(join(__dirname, 'fixture-tube-cleaner-multiple.html')).href;
const FIXTURE_TUBE_MULTIPLE_SOURCE = readFileSync(join(__dirname, 'fixture-tube-cleaner-multiple.html'), 'utf8');
const FIXTURE_PLAYER_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner.html')).href;
const FIXTURE_PLAYER_REPLACE_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-replace.html')).href;
const FIXTURE_PLAYER_DISCOVERY_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-discovery.html')).href;
const FIXTURE_PLAYER_JW_INIT_RACE_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-jw-init-race.html')).href;
const FIXTURE_PLAYER_LIVE_BLOB_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-live-blob.html')).href;
const FIXTURE_PLAYER_HANDSHAKE_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-handshake.html')).href;
const FIXTURE_PLAYER_SHADOW_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-shadow.html')).href;
const FIXTURE_PLAYER_REDDIT_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-reddit.html')).href;
const FIXTURE_PLAYER_BARE_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-bare.html')).href;
const FIXTURE_PLAYER_RELATIVE_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-relative.html')).href;
const FIXTURE_PLAYER_UPGRADE_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-upgrade.html')).href;
const FIXTURE_PLAYER_EARLY_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-early.html')).href;
const FIXTURE_PLAYER_ARTDECO_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-artdeco.html')).href;
const FIXTURE_PLAYER_ESPN_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-espn.html')).href;
const FIXTURE_PLAYER_PBS_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-pbs.html')).href;
const FIXTURE_PLAYER_PBS_HOST = join(__dirname, 'fixture-player-cleaner-pbs-host.html');
const FIXTURE_PLAYER_DISCORD_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-discord.html')).href;
const FIXTURE_PLAYER_TWITCH_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-twitch.html')).href;
const FIXTURE_PLAYER_FOX_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-fox.html')).href;
const FIXTURE_PLAYER_VIDEOJS_IOS_URL = pathToFileURL(join(__dirname, 'fixture-player-cleaner-videojs-ios.html')).href;
const FIXTURE_PLAYER_YOUTUBE_EMBED = join(__dirname, 'fixture-player-cleaner-youtube-embed.html');

const userscript = readFileSync(SCRIPT_PATH, 'utf8');
const playerUserscript = readFileSync(PLAYER_SCRIPT_PATH, 'utf8');
const injectorSource = readFileSync(INJECTOR_PATH, 'utf8');
const filter = (process.argv.find(a => a.startsWith('--filter=')) || '').split('=')[1] || '';
// Thumbnail URLs the current scenario requested from dearrow-thumb.ajay.app.
let page_thumbnailRequests = [];

const iosStuckPreferencesPrelude = `
try {
  localStorage.setItem('wblock.tubeCleaner.audioOnly', '1');
  localStorage.setItem('wblock.tubeCleaner.quality', 'hd1080');
  localStorage.setItem('yt-player-quality', JSON.stringify({ quality: 'hd1080', previousQuality: 'auto' }));
} catch (e) {}
`;

const ipadDesktopPrelude = `
Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
  configurable: true,
  get: function () { return 5; }
});
Object.defineProperty(Navigator.prototype, 'platform', {
  configurable: true,
  get: function () { return 'MacIntel'; }
});
`;

const visibilityPrelude = `
window.__wblockNativeHidden = false;
window.__wblockNativeVisibility = 'visible';
Object.defineProperty(Document.prototype, 'hidden', {
  configurable: true,
  get: function () { return window.__wblockNativeHidden; }
});
Object.defineProperty(Document.prototype, 'visibilityState', {
  configurable: true,
  get: function () { return window.__wblockNativeVisibility; }
});
Object.defineProperty(Document.prototype, 'webkitHidden', {
  configurable: true,
  get: function () { return window.__wblockNativeHidden; }
});
Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
  configurable: true,
  get: function () { return window.__wblockNativeVisibility; }
});
`;

// Mirrors the chapter payload currently served for the Tau test video. YouTube
// places two copies of the same macro-marker list in ytInitialData.
const chapterDataPrelude = `
(function () {
  var chapters = [
    ['0:00', 'Introducing Tau'],
    ['1:03', 'Tau UI demo'],
    ['3:43', 'Architecture: Tau AI, Tau agent, and Tau coding']
  ];
  function render(definition) {
    return { macroMarkersListItemRenderer: {
      timeDescription: { simpleText: definition[0] },
      title: { simpleText: definition[1] }
    }};
  }
  window.ytInitialData = {
    engagementPanels: chapters.map(render),
    playerOverlays: chapters.map(render)
  };
  window.ytInitialPlayerResponse = { videoDetails: { channelId: 'test-channel' } };
})();
`;

const sponsorBlockPrelude = `
(function () {
  history.replaceState(null, '', location.pathname + '?v=dQw4w9WgXcQ');
  var nativeFetch = window.fetch;
  window.__wblockSponsorRequestCount = 0;
  window.fetch = function (url, options) {
    if (String(url).indexOf('sponsor.ajay.app/api/skipSegments/') !== -1) {
      window.__wblockSponsorRequest = String(url);
      window.__wblockSponsorRequestCount++;
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([{
        videoID: 'dQw4w9WgXcQ',
        segments: [
          { UUID: 'test-sponsor', category: 'sponsor', actionType: 'skip', segment: [10, 20] },
          { UUID: 'test-selfpromo', category: 'selfpromo', actionType: 'skip', segment: [30, 40] },
          { UUID: 'test-interaction', category: 'interaction', actionType: 'skip', segment: [50, 60] },
          { UUID: 'test-timer', category: 'sponsor', actionType: 'skip', segment: [70, 80] },
          { UUID: 'test-end', category: 'sponsor', actionType: 'skip', segment: [290, 300] }
        ]
      }]); }});
    }
    return nativeFetch.apply(this, arguments);
  };
})();
`;

// The app prepends this constant to the script. The prelude runs in the
// injector's closure, so checks reach it through the debug hook.
const deArrowPrelude = `
const __wblockTubeCleanerDeArrow = { enabled: true, replaceTitles: true, replaceThumbnails: true,
  randomThumbnails: false, showOriginalOnHover: true };
(function () {
  var nativeFetch = window.fetch;
  window.__wblockDeArrowRequests = [];
  window.fetch = function (url, options) {
    var value = String(url);
    if (value.indexOf('sponsor.ajay.app/api/branding') !== -1) {
      window.__wblockDeArrowRequests.push(value);
      var watch = {
        titles: [{ title: 'Accurate Watch Title', original: false, votes: 4, locked: false }],
        thumbnails: []
      };
      var card = {
        titles: [{ title: 'Accurate Related Title', original: false, votes: 2, locked: false }],
        thumbnails: [{ timestamp: 12.5, original: false, votes: 3, locked: false }]
      };
      var randomFallback = { titles: [], thumbnails: [], videoDuration: 120, randomTime: 0.25 };
      var payload = value.indexOf('videoID=CARDVID1234') !== -1 ? card :
        value.indexOf('videoID=RANDOMVID01') !== -1 ? randomFallback : { dQw4w9WgXcQ: watch };
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(payload); } });
    }
    return nativeFetch.apply(this, arguments);
  };
})();
`;

// WEB caption URLs with exp=xpe currently require a Proof-of-Origin token. The
// fixture exercises Tube Cleaner's lightweight Android VR metadata fallback and
// returns two valid WebVTT documents for Safari's native subtitle menu.
const captionDataPrelude = `
(function () {
  window.ytInitialPlayerResponse = window.ytInitialPlayerResponse || { videoDetails: { channelId: 'test-channel' } };
  window.ytInitialPlayerResponse.captions = { playerCaptionsTracklistRenderer: { captionTracks: [{
    baseUrl: 'https://captions.test/token-gated?exp=xpe&lang=en', languageCode: 'en',
    name: { simpleText: 'English' }, vssId: '.en'
  }] } };
  window.ytcfg = { get: function (key) {
    if (key === 'INNERTUBE_API_KEY') return 'fixture-api-key';
    if (key === 'VISITOR_DATA') return 'fixture-visitor';
    return null;
  }};
  var nativeFetch = window.fetch;
  window.__wblockCaptionPlayerRequests = 0;
  window.__wblockCaptionTextRequests = 0;
  window.fetch = function (url, options) {
    var value = String(url);
    if (value.indexOf('/youtubei/v1/player') !== -1) {
      window.__wblockCaptionPlayerRequests++;
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [
          { baseUrl: 'https://captions.test/en?lang=en', languageCode: 'en', name: { simpleText: 'English' }, vssId: '.en' },
          { baseUrl: 'https://captions.test/es?lang=es', languageCode: 'es', name: { simpleText: 'Español' }, vssId: '.es' }
        ] } }
      }); }});
    }
    if (value.indexOf('https://captions.test/') === 0) {
      window.__wblockCaptionTextRequests++;
      var language = value.indexOf('/es?') !== -1 ? 'es' : 'en';
      var cue = language === 'es' ? 'Hola desde Tube Cleaner' : 'Hello from Tube Cleaner';
      return Promise.resolve({ ok: true, text: function () {
        return Promise.resolve('WEBVTT\\n\\n00:00:00.000 --> 00:00:05.000\\n' + cue + '\\n');
      }});
    }
    return nativeFetch.apply(this, arguments);
  };
})();
`;

const mediaSessionPrelude = `
(function () {
  const state = { handlers: {}, metadata: null, positions: [] };
  window.__wblockMediaSessionState = state;
  window.MediaMetadata = class {
    constructor(init) { Object.assign(this, init); }
  };
  const session = {
    get metadata() { return state.metadata; },
    set metadata(value) { state.metadata = value; },
    setActionHandler(name, handler) { state.handlers[name] = handler; },
    setPositionState(value) { state.positions.push(value); },
    playbackState: 'none'
  };
  Object.defineProperty(Navigator.prototype, 'mediaSession', {
    configurable: true, get: function () { return session; }
  });
})();
`;

const playerPreferencesPrelude = `
localStorage.setItem('wblock.playerCleaner.preferences', JSON.stringify({
  playbackRate: 1.5, volume: 0.35, muted: true, subtitleLanguage: 'en',
  backgroundPlayback: true
}));
localStorage.setItem('wblock.playerCleaner.resume', JSON.stringify({
  [location.origin + location.pathname + location.search + '|https://example.com/media/movie.mp4']: 42
}));
`;

const resourceCounterPatch = `
(function () {
  var counters = window.__wblockResourceCounters = {
    listeners: 0, intervals: 0, mutationObservers: 0, intersectionObservers: 0
  };
  function patchTarget(target) {
    var add = target.addEventListener.bind(target);
    var remove = target.removeEventListener.bind(target);
    target.addEventListener = function () { counters.listeners++; return add.apply(target, arguments); };
    target.removeEventListener = function () { counters.listeners--; return remove.apply(target, arguments); };
  }
  patchTarget(document);
  patchTarget(window);
  var setIntervalNative = window.setInterval.bind(window);
  var clearIntervalNative = window.clearInterval.bind(window);
  window.setInterval = function () { counters.intervals++; return setIntervalNative.apply(window, arguments); };
  window.clearInterval = function (id) { counters.intervals--; return clearIntervalNative(id); };

  var NativeMutationObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) { super(callback); this.__wblockActive = false; }
    observe() {
      if (!this.__wblockActive) { this.__wblockActive = true; counters.mutationObservers++; }
      return super.observe(...arguments);
    }
    disconnect() {
      if (this.__wblockActive) { this.__wblockActive = false; counters.mutationObservers--; }
      return super.disconnect();
    }
  };

  var NativeIntersectionObserver = window.IntersectionObserver;
  if (NativeIntersectionObserver) {
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      constructor(callback, options) { super(callback, options); this.__wblockActive = false; }
      observe() {
        if (!this.__wblockActive) { this.__wblockActive = true; counters.intersectionObservers++; }
        return super.observe(...arguments);
      }
      disconnect() {
        if (this.__wblockActive) { this.__wblockActive = false; counters.intersectionObservers--; }
        return super.disconnect();
      }
    };
  }
})();
`;

const results = [];
function record(scenario, name, pass, detail = '') {
  results.push({ scenario, name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

// Run an in-page check that returns {pass, detail}. Retries until pass or timeout
// because the userscript transforms the player asynchronously (250ms poll loop).
async function check(page, scenario, name, fn, { timeout = 6000, interval = 150, arg } = {}) {
  const start = Date.now();
  let last = { pass: false, detail: 'timeout' };
  while (Date.now() - start < timeout) {
    try {
      last = await page.evaluate(fn, arg);
      if (last && last.pass) break;
    } catch (e) {
      last = { pass: false, detail: 'eval error: ' + e.message };
    }
    await page.waitForTimeout(interval);
  }
  record(scenario, name, !!(last && last.pass), (last && last.detail) || '');
}

async function waitForTransform(page) {
  await page.waitForSelector('.wblock-tc-native', { timeout: 10000 }).catch(() => {});
}

async function runScenario(name, { device, fixture, ua, hasTouch, viewport, scriptSource, readySignal, gotoURL, responseBody }) {
  console.log(`\n=== Scenario: ${name} ===`);
  const browser = await webkit.launch();
  const ctxOpts = {};
  if (device) Object.assign(ctxOpts, device);
  if (ua) ctxOpts.userAgent = ua;
  if (hasTouch) ctxOpts.hasTouch = true;
  if (viewport) ctxOpts.viewport = viewport;
  const context = await browser.newContext(ctxOpts);
  // The thumbnail server reports the frame time it actually served in
  // X-Timestamp. CARDVID1234 at 12.5 answers with 14 so the script's
  // mandatory re-request at the served time is exercised.
  const thumbnailRequests = [];
  await context.route('https://dearrow-thumb.ajay.app/**', route => {
    const url = new URL(route.request().url());
    thumbnailRequests.push(url.href);
    const requested = Number(url.searchParams.get('time'));
    const served = url.searchParams.get('videoID') === 'CARDVID1234' && requested === 12.5 ? 14 : requested;
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Timestamp, X-Title, X-Failure-Reason',
        'X-Timestamp': String(served),
      },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#345"/></svg>',
    });
  });
  page_thumbnailRequests = thumbnailRequests;
  if (gotoURL && responseBody != null) {
    const origin = new URL(gotoURL).origin + '/**';
    await context.route(origin, route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: responseBody,
    }));
  }
  const page = await context.newPage();

  // Inject the real userscript at document-start in the page world.
  await page.addInitScript(scriptSource || userscript);

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(gotoURL || fixture, { waitUntil: gotoURL ? 'commit' : 'domcontentloaded' });
  if (readySignal) await page.waitForSelector(readySignal, { timeout: 10000 }).catch(() => {});
  else await waitForTransform(page);

  return { browser, context, page, pageErrors };
}

async function commonChecks(page, scenario, { expectToolbar = true } = {}) {
  await check(page, scenario, 'injects its stylesheet (#wblock-tc-style)', () => ({
    pass: !!document.getElementById('wblock-tc-style'),
  }));

  await check(page, scenario, 'marks player native (.wblock-tc-native)', () => {
    const p = document.getElementById('movie_player');
    return { pass: !!(p && p.classList.contains('wblock-tc-native')) };
  });

  await check(page, scenario, 'sets data-wblock-tc-cleaned', () => {
    const p = document.getElementById('movie_player');
    return { pass: !!(p && p.hasAttribute('data-wblock-tc-cleaned')) };
  });

  await check(page, scenario, 'forces video.controls === true', () => {
    const v = document.querySelector('#movie_player video');
    return { pass: !!(v && v.controls === true), detail: v ? `controls=${v.controls}` : 'no video' };
  });

  // Native scrubber drags die if YouTube's shell sees the pointer stream and
  // reasserts player state mid-drag (a controls toggle rebuilds the inline
  // shadow controls). Every pointer/mouse/touch event bubbling out of the
  // video must stop there.
  await check(page, scenario, 'keeps scrubber drag events away from the YouTube player shell', () => {
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    if (!player || !video) return { pass: false, detail: 'missing player or video' };
    // The synthetic click below trips the iOS toolbar's tap-to-toggle handler;
    // snapshot the toolbar's inline style so later toolbar checks see the
    // state a real page load produces.
    const toolbar = document.querySelector('.wblock-tc-toolbar');
    const savedToolbarStyle = toolbar ? toolbar.getAttribute('style') : null;
    const leaked = [];
    const record = (event) => leaked.push(event.type);
    const types = ['click', 'pointerdown', 'pointermove', 'pointerup',
      'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend'];
    types.forEach((type) => player.addEventListener(type, record));
    let sent = 0;
    types.forEach((type) => {
      let event;
      if (type.startsWith('pointer')) {
        if (typeof PointerEvent !== 'function') return;
        event = new PointerEvent(type, { bubbles: true, composed: true });
      } else if (type.startsWith('touch')) {
        if (typeof TouchEvent !== 'function') return;
        try { event = new TouchEvent(type, { bubbles: true, composed: true }); }
        catch { return; }
      } else {
        event = new MouseEvent(type, { bubbles: true, composed: true });
      }
      sent += 1;
      video.dispatchEvent(event);
    });
    types.forEach((type) => player.removeEventListener(type, record));
    if (toolbar && savedToolbarStyle !== null) toolbar.setAttribute('style', savedToolbarStyle);
    return { pass: sent > 0 && leaked.length === 0,
      detail: leaked.length ? `leaked=${leaked.join(',')}` : `sent=${sent} leaked=0` };
  });

  // Bubble-phase blockers cannot silence YouTube's capture-phase document
  // handlers, so the mid-drag teardown they trigger is prevented at the
  // source instead: nothing may turn the controls attribute off, and no
  // controls-attribute mutation may occur at all (each one rebuilds WebKit's
  // inline shadow controls and cancels the drag).
  await check(page, scenario, 'pins the controls attribute against mid-drag teardown', () => {
    const video = document.querySelector('#movie_player video');
    if (!video) return { pass: false, detail: 'no video' };
    const observer = new MutationObserver(() => {});
    observer.observe(video, { attributes: true, attributeFilter: ['controls'] });
    video.controls = false;
    video.removeAttribute('controls');
    video.setAttribute('controls', '');
    if (typeof video.toggleAttribute === 'function') video.toggleAttribute('controls');
    const kept = video.controls === true && video.hasAttribute('controls');
    const mutations = observer.takeRecords().length;
    observer.disconnect();
    return { pass: kept && mutations === 0, detail: `kept=${kept} mutations=${mutations}` };
  });

  // Pressing F must match the native fullscreen button (video-element
  // fullscreen), not YouTube's container fullscreen, and must never fire
  // while the user is typing.
  await check(page, scenario, 'routes the F shortcut to native video fullscreen', () => {
    const video = document.querySelector('#movie_player video');
    if (!video) return { pass: false, detail: 'no video' };
    const modes = [];
    video.webkitSupportsPresentationMode = () => true;
    video.webkitSetPresentationMode = (mode) => { modes.push(mode); };
    const reachedYouTube = [];
    const record = (event) => reachedYouTube.push(event.key);
    document.addEventListener('keydown', record);
    const plain = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, composed: true });
    document.body.dispatchEvent(plain);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const typed = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, composed: true });
    input.dispatchEvent(typed);
    document.removeEventListener('keydown', record);
    input.remove();
    delete video.webkitSupportsPresentationMode;
    delete video.webkitSetPresentationMode;
    return {
      pass: plain.defaultPrevented && modes.length === 1 && modes[0] === 'fullscreen' &&
        reachedYouTube.length === 1 && !typed.defaultPrevented,
      detail: 'prevented=' + plain.defaultPrevented + ' modes=' + modes.join(',') +
        ' reached=' + reachedYouTube.length + ' typedPrevented=' + typed.defaultPrevented
    };
  });

  // A second press must leave native fullscreen even when the element's
  // getters lag, and a third must re-enter once the exit event has fired.
  await check(page, scenario, 'F toggles native fullscreen out and back in using element events', () => {
    const video = document.querySelector('#movie_player video');
    if (!video) return { pass: false, detail: 'no video' };
    const modes = [];
    let mode = 'inline';
    video.webkitSupportsPresentationMode = () => true;
    video.webkitSetPresentationMode = (m) => { modes.push(m); };
    Object.defineProperty(video, 'webkitPresentationMode', { configurable: true, get: () => mode });
    const press = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, composed: true }));
    mode = 'fullscreen';
    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    press();
    // Getter sticks at 'fullscreen' after the exit event: events win.
    video.dispatchEvent(new Event('webkitendfullscreen'));
    press();
    delete video.webkitSupportsPresentationMode;
    delete video.webkitSetPresentationMode;
    delete video.webkitPresentationMode;
    delete video._wblockNativeFullscreenState;
    return { pass: modes.join(',') === 'inline,fullscreen', detail: 'modes=' + modes.join(',') };
  });

  await check(page, scenario, 'C toggles the native subtitle track instead of YouTube captions', () => {
    const video = document.querySelector('#movie_player video');
    if (!video) return { pass: false, detail: 'no video' };
    const tracks = Array.from(video.textTracks).filter(t => t.kind === 'subtitles');
    if (!tracks.length) return { pass: true, detail: 'skipped: scenario installs no subtitle tracks' };
    tracks.forEach(t => { t.mode = 'disabled'; });
    const press = () => {
      const event = new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true, composed: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const prevented = press();
    const showingOn = tracks.filter(t => t.mode === 'showing').length;
    press();
    const showingOff = tracks.filter(t => t.mode === 'showing').length;
    return { pass: prevented && showingOn === 1 && showingOff === 0,
      detail: `prevented=${prevented} on=${showingOn} off=${showingOff}` };
  });

  await check(page, scenario, 'hides the YouTube caption overlay under the native player', () => {
    const player = document.querySelector('#movie_player');
    if (!player) return { pass: false, detail: 'no player' };
    const overlay = document.createElement('div');
    overlay.className = 'ytp-caption-window-container';
    player.appendChild(overlay);
    const display = getComputedStyle(overlay).display;
    overlay.remove();
    return { pass: display === 'none', detail: `display=${display}` };
  });

  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    const tracks = Array.from(video.textTracks).filter(t => t.kind === 'subtitles');
    tracks.forEach(t => { t.mode = 'disabled'; });
    window.__wblockTrackCount = tracks.length;
    if (tracks.length > 1) { tracks[0].mode = 'showing'; }
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    const tracks = Array.from(video.textTracks).filter(t => t.kind === 'subtitles');
    if (tracks.length > 1) { tracks[1].mode = 'showing'; }
  });
  await page.waitForTimeout(100);
  await check(page, scenario, 'keeps only the most recently enabled native subtitle track showing', () => {
    const video = document.querySelector('#movie_player video');
    const tracks = Array.from(video.textTracks).filter(t => t.kind === 'subtitles');
    if (tracks.length < 2) return { pass: true, detail: `skipped: tracks=${tracks.length}` };
    const showing = tracks.map(t => t.mode);
    tracks.forEach(t => { t.mode = 'disabled'; });
    return { pass: showing[0] === 'disabled' && showing[1] === 'showing', detail: `modes=${showing.join(',')}` };
  });

  await check(page, scenario, 'keeps unknown YouTube overlays behind the native video', () => {
    const player = document.querySelector('.wblock-tc-native');
    const video = player?.querySelector('video');
    if (!player || !video) return { pass: false, detail: 'missing player or video' };

    const overlay = document.createElement('div');
    overlay.className = 'ytp-overlays-container';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:10000';
    player.appendChild(overlay);

    const rect = video.getBoundingClientRect();
    const pointerEvents = getComputedStyle(overlay).pointerEvents;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    overlay.remove();
    return {
      pass: pointerEvents === 'none' && hit === video,
      detail: `pointerEvents=${pointerEvents} hit=${hit?.tagName}`,
    };
  });

  await check(page, scenario, 'centers non-standard video ratios after YouTube offsets the media element', () => {
    const player = document.querySelector('#movie_player');
    const video = player?.querySelector('video');
    if (!player || !video) return { pass: false, detail: 'missing player or video' };

    // YouTube puts a narrow source in its 16:9 frame by assigning a smaller
    // width and a positive left offset. Tube Cleaner expands the element, so it
    // must also discard that stale geometry and center the pixels with contain.
    video.style.cssText += ';position:absolute;left:173px;top:29px;width:240px;height:360px;object-fit:fill';
    const playerRect = player.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    const fillsFrame = Math.abs(videoRect.left - playerRect.left) < 1 &&
      Math.abs(videoRect.top - playerRect.top) < 1 &&
      Math.abs(videoRect.width - playerRect.width) < 1 &&
      Math.abs(videoRect.height - playerRect.height) < 1;
    return {
      pass: fillsFrame && style.objectFit === 'contain' && style.objectPosition === '50% 50%',
      detail: `frame=${playerRect.width.toFixed(0)}x${playerRect.height.toFixed(0)} video=${videoRect.left.toFixed(0)},${videoRect.top.toFixed(0)} ${videoRect.width.toFixed(0)}x${videoRect.height.toFixed(0)} fit=${style.objectFit} position=${style.objectPosition}`,
    };
  });

  if (expectToolbar) {
    await check(page, scenario, 'builds separate playback and service rows with quality, audio, SB, and DA', () => {
      const tb = document.querySelector('.wblock-tc-toolbar');
      const playback = tb?.querySelector('.wblock-tc-playback-row');
      const services = tb?.querySelector('.wblock-tc-services-row');
      const quality = playback?.querySelector('.wblock-tc-quality-button');
      const audio = playback?.querySelector('.wblock-tc-audio-button');
      const sponsor = services?.querySelector('.wblock-tc-sponsor-button');
      const deArrow = tb?.querySelector('.wblock-tc-dearrow-button');
      return { pass: !!(quality && audio && sponsor) && !deArrow && !playback.querySelector('.wblock-tc-sponsor-button'),
        detail: `quality=${!!quality} audio=${!!audio} sponsor=${!!sponsor} deArrow=${!!deArrow}` };
    });
  } else {
    await check(page, scenario, 'adds separate quality and service rows beside Safari native controls on iOS', () => {
      const toolbar = document.querySelector('.wblock-tc-toolbar');
      const playback = toolbar?.querySelector('.wblock-tc-playback-row');
      const services = toolbar?.querySelector('.wblock-tc-services-row');
      const quality = playback?.querySelector('.wblock-tc-quality-button');
      const sponsor = services?.querySelector('.wblock-tc-sponsor-button');
      const deArrow = toolbar?.querySelector('.wblock-tc-dearrow-button');
      const audio = toolbar?.querySelector('.wblock-tc-audio-button');
      return {
        pass: !!toolbar && !!quality && !!sponsor && !deArrow && !audio &&
          getComputedStyle(toolbar).pointerEvents === 'auto',
        detail: `toolbar=${!!toolbar} quality=${!!quality} sponsor=${!!sponsor} deArrow=${!!deArrow} audio=${!!audio}`,
      };
    });
    await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-button').click());
    await check(page, scenario, 'keeps the complete SponsorBlock settings panel reachable in the iOS viewport', () => {
      const panel = document.querySelector('.wblock-tc-sponsor-menu');
      const rect = panel?.getBoundingClientRect();
      const pageOverlay = panel?.parentElement === document.body;
      const maxScroll = panel ? Math.max(0, panel.scrollHeight - panel.clientHeight) : 0;
      if (panel) panel.scrollTop = panel.scrollHeight;
      const allControlsReachable = !!panel && (maxScroll === 0 || panel.scrollTop >= maxScroll - 1);
      return { pass: !!rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && allControlsReachable && pageOverlay,
        detail: rect ? `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)} content=${panel.scrollHeight}/${panel.clientHeight} scroll=${panel.scrollTop}/${maxScroll} pageOverlay=${pageOverlay}` : 'no panel' };
    });
    await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-button').click());
  }

  await check(page, scenario, 'overrides document.hidden (background playback)', () => {
    const desc = Object.getOwnPropertyDescriptor(document, 'hidden');
    return { pass: !!(desc && typeof desc.get === 'function' && document.hidden === false),
      detail: `hidden=${document.hidden}, overridden=${!!(desc && desc.get)}` };
  });

  await check(page, scenario, 'hooks auto-PiP on the video', () => {
    const v = document.querySelector('#movie_player video');
    return { pass: !!(v && v._wblockAutoPiPHooked === true) };
  });

  await check(page, scenario, 'exposes debug quality API', () => {
    const d = window.__wblockTubeDebug;
    if (!d) return { pass: false, detail: 'no __wblockTubeDebug' };
    const levels = d.getAvailableQualities();
    return { pass: Array.isArray(levels) && levels.includes('hd1080'), detail: `levels=${levels.join(',')}` };
  });
}

// The fixture's mock player repeatedly removes controls/inline playback and
// reapplies native PiP/AirPlay restrictions. Both platforms restore PiP and
// native controls; iOS must retain the MMS remote-playback safety restriction.
async function controlsSurvivalCheck(page, scenario, { preserveIOSMMSRestrictions = false } = {}) {
  await page.waitForTimeout(4200); // let several fightControls rounds run
  const label = preserveIOSMMSRestrictions
    ? 'native controls survive while iOS MMS safety restrictions remain'
    : 'native media capabilities SURVIVE YouTube restrictions';
  await check(page, scenario, label, (preserveIOSMMSRestrictions) => {
    const v = document.querySelector('#movie_player video');
    if (!v) return { pass: false, detail: 'no video' };
    const state = {
      controls: v.controls && v.hasAttribute('controls'),
      inline: v.playsInline && v.hasAttribute('playsinline') && v.hasAttribute('webkit-playsinline'),
    };
    if (preserveIOSMMSRestrictions) {
      state.pip = !v.disablePictureInPicture && !v.hasAttribute('disablepictureinpicture');
      state.controlsList = !v.hasAttribute('controlslist');
      state.remoteDisabled = v.disableRemotePlayback && v.hasAttribute('disableremoteplayback');
      state.airplayNotForced = v.getAttribute('x-webkit-airplay') !== 'allow';
    } else {
      state.pip = !v.hasAttribute('disablepictureinpicture');
      state.remote = !v.hasAttribute('disableremoteplayback');
      state.controlsList = !v.hasAttribute('controlslist');
      state.airplay = v.getAttribute('x-webkit-airplay') === 'allow';
    }
    return {
      pass: Object.values(state).every(Boolean),
      detail: Object.entries(state).map(([k, value]) => `${k}=${value}`).join(' '),
    };
  }, { timeout: 1500, interval: 500, arg: preserveIOSMMSRestrictions });
}

async function iosNativeControlsChecks(page, scenario) {
  await check(page, scenario, 'does not add Safari caption tracks when YouTube has none', () => {
    const tracks = document.querySelectorAll('track[data-wblock-native-subtitle], track[kind="subtitles"]');
    return { pass: tracks.length === 0, detail: `tracks=${tracks.length}` };
  });
  await check(page, scenario, 'clears persisted audio-only mode on iOS', () => {
    const video = document.querySelector('#movie_player video');
    const audioStyle = document.getElementById('wblock-tc-style-audio');
    return { pass: localStorage.getItem('wblock.tubeCleaner.audioOnly') !== '1' &&
      !audioStyle && video && getComputedStyle(video).visibility === 'visible',
      detail: `stored=${localStorage.getItem('wblock.tubeCleaner.audioOnly')} style=${!!audioStyle} visibility=${video && getComputedStyle(video).visibility}` };
  });
  await check(page, scenario, 'restores adaptive quality instead of retrying fixed 1080p', () => {
    const quality = localStorage.getItem('wblock.tubeCleaner.quality');
    const bias = localStorage.getItem('yt-player-quality');
    const settingsClicks = window.__settingsClicks || 0;
    return { pass: quality === 'auto' && bias === null && settingsClicks === 0,
      detail: `quality=${quality} bias=${bias} settingsClicks=${settingsClicks}` };
  });
  await check(page, scenario, 'changes iOS quality without persisting a fixed startup range', async () => {
    const button = document.querySelector('.wblock-tc-quality-button');
    if (!button) return { pass: false, detail: 'missing quality button' };
    button.click();
    const option = Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
      .find((item) => item.textContent === '1080p');
    if (!option) return { pass: false, detail: 'missing 1080p option' };
    option.click();
    await new Promise((resolve) => setTimeout(resolve, 550));
    const current = window.__wblockTubeDebug.getCurrentQuality();
    const preference = localStorage.getItem('wblock.tubeCleaner.quality');
    const bias = localStorage.getItem('yt-player-quality');
    return {
      pass: current === 'hd1080' && preference === 'auto' && bias === null,
      detail: `current=${current} preference=${preference} bias=${bias}`,
    };
  });
  await check(page, scenario, 'does not style Safari private media controls', () => {
    const css = document.getElementById('wblock-tc-style')?.textContent || '';
    return { pass: !css.includes('::-webkit-media-controls') && !css.includes('touch-action: manipulation !important; } .wblock-tc-native video') };
  });
  await check(page, scenario, 'keeps the native video inside the iOS player frame', () => {
    const player = document.querySelector('#movie_player');
    const container = player?.querySelector('.html5-video-container');
    const video = container?.querySelector('video');
    const playerRect = player?.getBoundingClientRect();
    const videoRect = video?.getBoundingClientRect();
    const position = container ? getComputedStyle(container).position : 'missing';
    const contained = !!(playerRect && videoRect &&
      Math.abs(videoRect.left - playerRect.left) < 1 &&
      Math.abs(videoRect.top - playerRect.top) < 1 &&
      Math.abs(videoRect.width - playerRect.width) < 1 &&
      Math.abs(videoRect.height - playerRect.height) < 1);
    return { pass: position === 'absolute' && contained,
      detail: `position=${position} player=${playerRect?.width.toFixed(0)}x${playerRect?.height.toFixed(0)} video=${videoRect?.width.toFixed(0)}x${videoRect?.height.toFixed(0)}` };
  });
  await check(page, scenario, 'keeps mobile YouTube controls behind the native video after unmute', () => {
    const player = document.querySelector('.wblock-tc-native');
    const video = player?.querySelector('video');
    if (!player || !video) return { pass: false, detail: 'missing player or video' };

    const content = document.createElement('div');
    content.className = 'ytp-player-content ytp-timely-actions-content';
    content.style.cssText = 'position:absolute;inset:0;z-index:1000';
    player.appendChild(content);

    const rect = video.getBoundingClientRect();
    const controls = document.createElement('div');
    controls.id = 'player-control-container';
    controls.innerHTML = '<ytm-custom-control><ytm-watch-player-controls><div id="player-control-overlay"></div></ytm-watch-player-controls></ytm-custom-control>';
    controls.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:2000`;

    // Mobile YouTube adds its separate controls tree when the required
    // "Tap to unmute" action runs. Keep that button usable, then ensure the
    // resulting YouTube overlay cannot cover Safari's controls.
    const unmute = document.createElement('button');
    unmute.className = 'ytp-unmute ytp-popup ytp-button';
    player.appendChild(unmute);
    const unmuteUsable = getComputedStyle(unmute).display !== 'none' &&
      getComputedStyle(unmute).pointerEvents !== 'none';
    unmute.addEventListener('click', () => {
      unmute.remove();
      document.body.appendChild(controls);
    });
    unmute.click();

    const contentPointerEvents = getComputedStyle(content).pointerEvents;
    const controlsDisplay = getComputedStyle(controls).display;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const pass = unmuteUsable && contentPointerEvents === 'none' && controlsDisplay === 'none' && hit === video;
    content.remove();
    controls.remove();
    return { pass, detail: `unmuteUsable=${unmuteUsable} contentPointerEvents=${contentPointerEvents} controlsDisplay=${controlsDisplay} hit=${hit?.tagName}` };
  });
  await check(page, scenario, 'keeps the iOS video visible with a real layout box', () => {
    const video = document.querySelector('#movie_player video');
    const rect = video?.getBoundingClientRect();
    return { pass: !!(video && rect && rect.width > 100 && rect.height > 100 &&
      getComputedStyle(video).display !== 'none' && getComputedStyle(video).visibility !== 'hidden'),
      detail: rect ? `${rect.width.toFixed(0)}x${rect.height.toFixed(0)} visibility=${getComputedStyle(video).visibility}` : 'no video' };
  });
}

async function iosLandscapeCheck(page, scenario) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    const wrap = document.getElementById('player-wrap');
    const player = document.querySelector('.wblock-tc-native');
    if (wrap) wrap.style.margin = '0';
    player.style.width = '100vw';
    player.style.height = '100vh';
  });
  await check(page, scenario, 'iOS native video survives landscape rotation', () => {
    const player = document.querySelector('.wblock-tc-native').getBoundingClientRect();
    const video = document.querySelector('.wblock-tc-native video');
    const rect = video.getBoundingClientRect();
    return { pass: video.controls && rect.width > 100 && rect.height > 100 &&
      rect.left >= player.left - 1 && rect.right <= player.right + 1,
      detail: `video=${rect.width.toFixed(0)}x${rect.height.toFixed(0)} viewport=${innerWidth}x${innerHeight}` };
  });
}

// The mobile toolbar auto-hides a few seconds after playback resumes and
// reappears on a tap to the video surface, mirroring Safari's control chrome.
// It must stay visible while paused and while a settings panel is open.
async function iosAutoHideCheck(page, scenario) {
  const videoSel = '#movie_player video';
  const setPlaying = async () => page.evaluate((v) => {
    const el = document.querySelector(v);
    Object.defineProperty(el, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(el, 'ended', { configurable: true, get: () => false });
    el.dispatchEvent(new Event('play'));
  }, videoSel);
  const setPaused = async () => page.evaluate((v) => {
    const el = document.querySelector(v);
    Object.defineProperty(el, 'paused', { configurable: true, get: () => true });
    el.dispatchEvent(new Event('pause'));
  }, videoSel);

  // Auto-hide after play.
  await setPlaying();
  await page.waitForFunction(() => document.querySelector('.wblock-tc-toolbar')?.style.opacity === '0', undefined, { timeout: 4000 });
  await check(page, scenario, 'iOS toolbar auto-hides after playback resumes', () => ({ pass: true, detail: 'hidden after play' }));

  // Tap the video to reveal.
  await page.evaluate((v) => document.querySelector(v).click(), videoSel);
  await check(page, scenario, 'iOS tap reveals the hidden toolbar', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    return { pass: o === '1', detail: `opacity=${o}` };
  });

  // Tap again hides (toggle).
  await page.evaluate((v) => document.querySelector(v).click(), videoSel);
  await check(page, scenario, 'iOS tap hides the visible toolbar', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    return { pass: o === '0', detail: `opacity=${o}` };
  });

  // Pause shows the toolbar and keeps it visible.
  await setPaused();
  await check(page, scenario, 'iOS pause reveals the toolbar', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    return { pass: o === '1', detail: `opacity=${o}` };
  });

  // While a settings panel is open, the auto-hide timer must not hide it.
  await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-button').click());
  await setPlaying();
  await page.waitForTimeout(3200);
  await check(page, scenario, 'iOS toolbar stays visible while a settings panel is open', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    return { pass: o === '1', detail: `opacity=${o}` };
  });
  await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-button').click());
}

// On iOS the SABR player often reports only the rendition buffered so far
// (frequently just 360p). The quality picker must still offer the canonical
// ladder so a tap can request a higher rendition on demand, and choosing one
// must not be silently downgraded back to 360p. Regression guard for the
// "only 360p shown on iOS, video is actually 1440p" report.
// #631: a two-finger spread on the player must be swallowed before YouTube's
// document-level capture handlers see it and must ask for native fullscreen on
// release, while a plain two-finger tap (no spread) asks for nothing.
async function iosPinchFullscreenCheck(page, scenario) {
  await check(page, scenario, 'pinch-out on the player is routed to native fullscreen', () => {
    const player = document.querySelector('#movie_player');
    const video = player && player.querySelector('video');
    const d = window.__wblockTubeDebug;
    if (!player || !video || !d || typeof d.pinchFullscreenRequests !== 'function') {
      return { pass: false, detail: 'missing player, video, or debug hook' };
    }
    let leaked = 0;
    const spy = (event) => { if (event.touches && event.touches.length === 2) leaked++; };
    document.body.addEventListener('touchstart', spy, true);
    document.body.addEventListener('touchmove', spy, true);
    // WebKit has no Touch constructor; use its legacy createTouch factory.
    if (typeof document.createTouch !== 'function' || typeof document.createTouchList !== 'function') {
      return { pass: false, detail: 'no document.createTouch in this WebKit' };
    }
    const touch = (id, x, y) => document.createTouch(window, video, id, x, y, x, y);
    const fire = (type, touches) => {
      const list = document.createTouchList(...touches);
      const event = new TouchEvent(type, { bubbles: true, cancelable: true, composed: true });
      for (const key of ['touches', 'targetTouches', 'changedTouches']) {
        Object.defineProperty(event, key, { value: list });
      }
      video.dispatchEvent(event);
    };
    const before = d.pinchFullscreenRequests();
    fire('touchstart', [touch(1, 100, 100), touch(2, 120, 100)]);
    fire('touchmove', [touch(1, 60, 100), touch(2, 160, 100)]);
    fire('touchend', []);
    const afterSpread = d.pinchFullscreenRequests();
    fire('touchstart', [touch(1, 100, 100), touch(2, 120, 100)]);
    fire('touchend', []);
    const afterTap = d.pinchFullscreenRequests();
    document.body.removeEventListener('touchstart', spy, true);
    document.body.removeEventListener('touchmove', spy, true);
    const pass = afterSpread === before + 1 && afterTap === afterSpread && leaked === 0;
    return { pass, detail: `spread=${afterSpread - before}, tap=${afterTap - afterSpread}, leakedToPage=${leaked}` };
  });
}

async function iosQualityLadderCheck(page, scenario) {
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    player.__origAvailable = player.getAvailableQualityLevels;
    player.getAvailableQualityLevels = function () { return ['medium']; };
  });
  await check(page, scenario, 'shows the full iOS quality ladder without a cramped scroll view', () => {
    const button = document.querySelector('.wblock-tc-quality-button');
    if (!button) return { pass: false, detail: 'missing quality button' };
    button.click();
    const menu = document.querySelector('.wblock-tc-quality-menu');
    const labels = Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
      .map((item) => item.textContent);
    const has = (t) => labels.includes(t);
    const allOptionsFit = !!menu && menu.scrollHeight <= menu.clientHeight;
    const pageOverlay = menu?.parentElement === document.body;
    const lastOption = menu?.lastElementChild;
    const menuRect = menu?.getBoundingClientRect();
    const lastRect = lastOption?.getBoundingClientRect();
    const trailingSpace = menuRect && lastRect ? menuRect.bottom - lastRect.bottom : Infinity;
    const pass = has('Auto') && has('1440p') && has('1080p') && has('720p') && has('480p') && has('360p') &&
      allOptionsFit && pageOverlay && trailingSpace <= 12;
    return { pass, detail: `menu=${labels.join(',')} content=${menu?.scrollHeight}/${menu?.clientHeight} trailing=${trailingSpace.toFixed(0)} pageOverlay=${pageOverlay}` };
  });
  const option = page.locator('.wblock-tc-quality-menu > button', { hasText: '1440p' });
  const optionCount = await option.count();
  if (optionCount === 1) {
    await option.tap();
    await page.waitForTimeout(550);
  }
  await check(page, scenario, 'activates 1440p from the iOS touch menu without downgrading to 360p', (optionCount) => {
    if (optionCount !== 1) return { pass: false, detail: 'missing 1440p button' };
    const current = window.__wblockTubeDebug.getCurrentQuality();
    return { pass: current === 'hd1440', detail: `current=${current}` };
  }, { arg: optionCount });
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    if (player.__origAvailable) player.getAvailableQualityLevels = player.__origAvailable;
  });
}

// A desktop SABR player can also expose only the currently buffered 360p
// rendition. The canonical ladder must not depend on the iOS user-agent check,
// or this exact state leaves desktop users with only Auto and 360p.
async function desktopPartialQualityLadderCheck(page) {
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    player.__origAvailableForDesktopPartial = player.getAvailableQualityLevels;
    player.getAvailableQualityLevels = function () { return ['medium']; };
  });
  await check(page, 'desktop', 'offers the full quality ladder when desktop SABR reports only 360p', () => {
    const button = document.querySelector('.wblock-tc-quality-button');
    if (!button) return { pass: false, detail: 'missing quality button' };
    button.click();
    const labels = Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
      .map((item) => item.textContent);
    const has = (t) => labels.includes(t);
    const pass = has('Auto') && has('1440p') && has('1080p') && has('720p') && has('480p') && has('360p');
    return { pass, detail: `menu=${labels.join(',')}` };
  });
  await page.locator('.wblock-tc-quality-menu > button', { hasText: '1080p' }).hover();
  await check(page, 'desktop', 'keeps hovered quality options on the dark menu', () => {
    const item = Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
      .find((button) => button.textContent === '1080p');
    if (!item) return { pass: false, detail: 'missing 1080p' };
    const bg = getComputedStyle(item).backgroundColor;
    const rgb = (bg.match(/[\d.]+/g) || []).map(Number);
    const alpha = rgb.length >= 4 ? rgb[3] : 1;
    const luminance = rgb.length >= 3 ? ((0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])) * alpha : 255;
    return { pass: luminance < 80, detail: `bg=${bg} lum=${luminance.toFixed(1)}` };
  });
  await page.locator('.wblock-tc-quality-menu > button', { hasText: 'Auto' }).hover();
  await check(page, 'desktop', 'clears the quality option highlight after the pointer leaves', () => {
    const item = Array.from(document.querySelectorAll('.wblock-tc-quality-menu > button'))
      .find((button) => button.textContent === '1080p');
    if (!item) return { pass: false, detail: 'missing 1080p' };
    const bg = getComputedStyle(item).backgroundColor;
    const rgb = (bg.match(/[\d.]+/g) || []).map(Number);
    const alpha = rgb.length >= 4 ? rgb[3] : (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' ? 0 : 1);
    return { pass: alpha < 0.05, detail: `bg=${bg} focused=${document.activeElement === item}` };
  });
  await page.evaluate(() => {
    const button = document.querySelector('.wblock-tc-quality-button');
    if (button && document.querySelector('.wblock-tc-quality-menu')?.style.display !== 'none') button.click();
    const player = document.getElementById('movie_player');
    if (player.__origAvailableForDesktopPartial) {
      player.getAvailableQualityLevels = player.__origAvailableForDesktopPartial;
    }
  });
}

async function audioToggleCheck(page, scenario) {
  await check(page, scenario, 'audio-only toggle injects audio style', async () => {
    const btns = [...document.querySelectorAll('.wblock-tc-toolbar button')];
    const audioBtn = btns.find(b => /audio|video/i.test(b.textContent));
    if (!audioBtn) return { pass: false, detail: 'no audio button' };
    audioBtn.click();
    await new Promise(r => setTimeout(r, 50));
    const on = !!document.getElementById('wblock-tc-style-audio');
    return { pass: on, detail: on ? 'audio style present' : 'audio style missing' };
  });
}

async function qualityUISelectionCheck(page, scenario) {
  await page.evaluate(() => window.__wblockTubeDebug.setQuality('hd1080'));
  await page.waitForTimeout(300);
  await check(page, scenario, 'keeps YouTube quality menu hidden while selecting', () => {
    const menu = document.querySelector('#movie_player .ytp-panel-menu');
    return {
      pass: !!menu && getComputedStyle(menu).display === 'none',
      detail: `menu=${!!menu} display=${menu ? getComputedStyle(menu).display : 'missing'}`,
    };
  });
  await page.waitForTimeout(500);
  await check(page, scenario, 'selects quality through YouTube UI without double-toggle', () => ({
    pass: window.__uiSelectedQuality === 'hd1080' && window.__settingsClicks === 2,
    detail: `selected=${window.__uiSelectedQuality} settingsClicks=${window.__settingsClicks}`,
  }));
  await page.evaluate(() => {
    window.__settingsClicks = 0;
    window.__qualityRangeCalls = [];
    window.__uiSelectedQuality = null;
    localStorage.setItem('wblock.tubeCleaner.quality', 'hd2160');
    window.__wblockTubeDebug.applyPreferredQuality();
  });
  await check(page, scenario, 'caps preferred 4K instead of pinning a single SABR rendition', () => {
    const range = JSON.stringify(window.__qualityRangeCalls);
    return {
      pass: range === JSON.stringify([['tiny', 'hd2160']]) && window.__settingsClicks === 0 && window.__uiSelectedQuality === null,
      detail: `range=${range} settingsClicks=${window.__settingsClicks} ui=${window.__uiSelectedQuality}`,
    };
  });
}

// ---- Scenario 1: desktop -------------------------------------------------
{
  const { browser, page, pageErrors } = await runScenario('desktop (macOS Safari-like)', {
    fixture: FIXTURE_URL,
    viewport: { width: 1280, height: 800 },
    scriptSource: sponsorBlockPrelude + '\n' + chapterDataPrelude + '\n' + captionDataPrelude + '\n' + mediaSessionPrelude + '\n' + deArrowPrelude + '\n' + userscript,
  });
  await commonChecks(page, 'desktop');
  await check(page, 'desktop', 'video click does not bubble to the YouTube player shell', () => {
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    let reached = 0;
    const onEvent = () => { reached++; };
    player.addEventListener('click', onEvent);
    video.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    player.removeEventListener('click', onEvent);
    return { pass: reached === 0, detail: `player events=${reached}` };
  });
  await check(page, 'desktop', 'video pointerup does not bubble to the YouTube player shell', () => {
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    let reached = 0;
    const onEvent = () => { reached++; };
    player.addEventListener('pointerup', onEvent);
    video.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    player.removeEventListener('pointerup', onEvent);
    return { pass: reached === 0, detail: `player events=${reached}` };
  });
  await check(page, 'desktop', 'video touchend does not bubble to the YouTube player shell', () => {
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    let reached = 0;
    const onEvent = () => { reached++; };
    player.addEventListener('touchend', onEvent);
    video.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
    player.removeEventListener('touchend', onEvent);
    return { pass: reached === 0, detail: `player events=${reached}` };
  });
  await check(page, 'desktop', 'deduplicates and timestamps native chapter cues', () => {
    const video = document.querySelector('#movie_player video');
    const elements = Array.from(video?.querySelectorAll('track[data-wblock-native-chapters]') || []);
    const tracks = video ? Array.from(video.textTracks).filter(t => t.kind === 'chapters') : [];
    const cues = tracks[0]?.cues ? Array.from(tracks[0].cues) : [];
    const labels = cues.map(c => c.text);
    const expected = [
      '0:00  Introducing Tau',
      '1:03  Tau UI demo',
      '3:43  Architecture: Tau AI, Tau agent, and Tau coding'
    ];
    return {
      pass: elements.length === 1 && elements[0].kind === 'chapters' && elements[0].default &&
        /^blob:/.test(elements[0].src) && tracks.length === 1 && JSON.stringify(labels) === JSON.stringify(expected),
      detail: `elements=${elements.length} kind=${elements[0]?.kind} default=${elements[0]?.default} src=${elements[0]?.src} tracks=${tracks.length} labels=${labels.join(' | ')}`,
    };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    video._wblockChapterData = null;
    video._wblockChapterVideoId = null;
    video._wblockChapterFingerprint = null;
    video._wblockChapterApplyKey = null;
    Object.defineProperty(window.ytInitialData, 'poison', {
      configurable: true,
      enumerable: true,
      get() { throw new Error('ytInitialData poison'); },
    });
    window.__wblockTubeDebug.applyChapters();
  });
  await check(page, 'desktop', 'keeps chapters when ytInitialData has throwing getters', () => {
    const video = document.querySelector('#movie_player video');
    const track = Array.from(video?.textTracks || []).find(t => t.kind === 'chapters');
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return { pass: labels.length === 3, detail: `labels=${labels.join(' | ')}` };
  });
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    let current = 10;
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 120 });
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => current, set: value => { current = value; } });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    player.getVideoData = () => ({ video_id: 'TESTVID123', title: 'Tau in Safari', author: 'Tau Channel', thumbnail: { thumbnails: [{ url: 'https://img.test/tau.jpg' }] } });
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForTimeout(250);
  await check(page, 'desktop', 'publishes guarded YouTube Now Playing metadata and actions', () => {
    const state = window.__wblockMediaSessionState;
    const metadata = state?.metadata;
    const actions = Object.keys(state?.handlers || {}).sort();
    return {
      pass: metadata?.title === 'Tau in Safari' && metadata?.artist === 'Tau Channel' &&
        metadata?.artwork?.[0]?.src === 'https://img.test/tau.jpg' && metadata?.chapterInfo?.length === 3 &&
        actions.join(',') === 'pause,play,seekbackward,seekforward,seekto,stop' &&
        state.positions.length > 0 && navigator.mediaSession.playbackState === 'playing',
      detail: `title=${metadata?.title} artist=${metadata?.artist} artwork=${metadata?.artwork?.[0]?.src} chapters=${metadata?.chapterInfo?.length} actions=${actions.join(',')} positions=${state?.positions.length}`,
    };
  });
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    player.getVideoData = () => ({ video_id: 'TESTVID123', title: 'Tau updated', author: 'Updated Channel' });
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await check(page, 'desktop', 'refreshes Now Playing metadata after SPA metadata changes', () => ({
    pass: window.__wblockMediaSessionState.metadata?.title === 'Tau updated' &&
      window.__wblockMediaSessionState.metadata?.artist === 'Updated Channel',
    detail: `title=${window.__wblockMediaSessionState.metadata?.title} artist=${window.__wblockMediaSessionState.metadata?.artist}`,
  }));
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    player.getVideoData = () => ({ video_id: 'TESTVID123', title: 'Tau in Safari', author: 'Tau Channel' });
    history.replaceState(null, '', location.pathname + '?v=dQw4w9WgXcQ');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    // A Safari chapter track must not be disabled during a cue refresh: native
    // chapter menus can stop exposing a track after that transition.
    const descriptor = Object.getOwnPropertyDescriptor(TextTrack.prototype, 'mode');
    window.__chapterModeChanges = [];
    Object.defineProperty(TextTrack.prototype, 'mode', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        if (value === 'disabled') window.__chapterModeChanges.push(value);
        return descriptor.set.call(this, value);
      },
    });
    // YouTube can replace ytInitialData after startup. The loadedmetadata pass
    // must retain the already-extracted chapter list instead of emptying it.
    Object.defineProperty(document.querySelector('#movie_player video'), 'duration', { configurable: true, get: () => NaN });
    window.ytInitialData = {};
    document.querySelector('#movie_player video')?.dispatchEvent(new Event('loadedmetadata'));
  });
  await check(page, 'desktop', 'keeps chapter cues when initial data disappears', () => {
    const video = document.querySelector('#movie_player video');
    const track = video ? Array.from(video.textTracks).find(t => t.kind === 'chapters') : null;
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return {
      pass: labels.length === 3 && track?.mode === 'hidden' && window.__chapterModeChanges.length === 0,
      detail: `labels=${labels.join(' | ')} mode=${track?.mode} disabled=${window.__chapterModeChanges.length}`,
    };
  });
  await page.waitForFunction(() => document.querySelectorAll('track[data-wblock-native-subtitle]').length === 2);
  await check(page, 'desktop', 'adds Safari caption tracks from usable WebVTT', () => {
    const video = document.querySelector('#movie_player video');
    const tracks = Array.from(video?.querySelectorAll('track[data-wblock-native-subtitle]') || []);
    const labels = tracks.map(track => `${track.srclang}:${track.label}`);
    return {
      pass: JSON.stringify(labels) === JSON.stringify(['en:English', 'es:Español']) &&
        tracks.every(track => track.kind === 'subtitles' && /^blob:/.test(track.src)) &&
        window.__wblockCaptionPlayerRequests === 1 && window.__wblockCaptionTextRequests === 2,
      detail: `tracks=${labels.join(',')} src=${tracks.map(t => t.src.slice(0, 8)).join(',')} playerRequests=${window.__wblockCaptionPlayerRequests} textRequests=${window.__wblockCaptionTextRequests}`,
    };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    const track = video?.querySelector('track[data-wblock-native-subtitle]')?.track;
    window.__youtubeSubtitlesOn = false;
    window.__subtitleClicks = 0;
    if (track) track.mode = 'showing';
  });
  await check(page, 'desktop', 'lets Safari show captions without clicking YouTube CC', () => {
    const video = document.querySelector('#movie_player video');
    const element = video?.querySelector('track[data-wblock-native-subtitle]');
    const mode = element?.track?.mode;
    return {
      pass: mode === 'showing' && window.__youtubeSubtitlesOn === false && window.__subtitleClicks === 0,
      detail: `nativeMode=${mode} youtubeOn=${window.__youtubeSubtitlesOn} clicks=${window.__subtitleClicks}`,
    };
  });
  await page.waitForFunction(() => document.querySelector('#watch-metadata h1 yt-formatted-string')?.textContent === 'Accurate Watch Title' &&
    document.querySelector('ytd-compact-video-renderer #video-title')?.textContent === 'Accurate Related Title');
  await check(page, 'desktop', 'applies submitted DeArrow titles and cached thumbnails to visible YouTube branding', () => {
    const watchTitle = document.querySelector('#watch-metadata h1 yt-formatted-string')?.textContent;
    const cardTitle = document.querySelector('ytd-compact-video-renderer #video-title')?.textContent;
    const thumbnail = document.querySelector('ytd-compact-video-renderer img')?.getAttribute('src') || '';
    const requested = document.querySelector('ytd-compact-video-renderer img')?.getAttribute('data-wblock-dearrow-thumbnail') || '';
    const requests = window.__wblockDeArrowRequests || [];
    const hashRequest = requests.find(value => /api\/branding\/[a-f0-9]{4}/.test(value));
    const cardRequest = requests.find(value => value.includes('videoID=CARDVID1234'));
    return {
      pass: watchTitle === 'Accurate Watch Title' && cardTitle === 'Accurate Related Title' &&
        thumbnail.startsWith('blob:') && requested.includes('dearrow-thumb.ajay.app/api/v1/getThumbnail') &&
        requested.includes('time=14') && !!hashRequest && !hashRequest.includes('dQw4w9WgXcQ') && !!cardRequest,
      detail: `watch=${watchTitle} card=${cardTitle} requests=${requests.length} thumbnail=${thumbnail} requested=${requested}`,
    };
  });
  record('desktop', 're-requests a DeArrow thumbnail at the served X-Timestamp when it differs',
    page_thumbnailRequests.some(u => u.includes('videoID=CARDVID1234') && u.includes('time=12.5')) &&
    page_thumbnailRequests.some(u => u.includes('videoID=CARDVID1234') && u.includes('time=14')) &&
    page_thumbnailRequests.filter(u => u.includes('videoID=CARDVID1234')).length === 2,
    `thumbnailRequests=${page_thumbnailRequests.filter(u => u.includes('CARDVID1234')).join(' ')}`);
  await page.evaluate(() => document.querySelector('ytd-compact-video-renderer').dispatchEvent(new MouseEvent('mouseenter')));
  await check(page, 'desktop', 'shows original DeArrow card branding on hover', () => {
    const title = document.querySelector('ytd-compact-video-renderer #video-title')?.textContent;
    const thumbnail = document.querySelector('ytd-compact-video-renderer img')?.getAttribute('src') || '';
    return { pass: title === 'Original Related Title' && thumbnail.startsWith('data:image/gif'),
      detail: `title=${title} thumbnail=${thumbnail}` };
  });
  await page.evaluate(() => document.querySelector('ytd-compact-video-renderer').dispatchEvent(new MouseEvent('mouseleave')));
  await check(page, 'desktop', 'restores custom DeArrow card branding after hover', () => {
    const title = document.querySelector('ytd-compact-video-renderer #video-title')?.textContent;
    const thumbnail = document.querySelector('ytd-compact-video-renderer img')?.getAttribute('src') || '';
    return { pass: title === 'Accurate Related Title' && thumbnail.startsWith('blob:'),
      detail: `title=${title} thumbnail=${thumbnail}` };
  });
  await page.evaluate(() => {
    window.__wblockTubeDebug.setDeArrowSetting('replaceTitles', false);
  });
  await check(page, 'desktop', 'applies independent DeArrow title settings from the app-injected constant', () => {
    const watchTitle = document.querySelector('#watch-metadata h1 yt-formatted-string')?.textContent;
    const cardTitle = document.querySelector('ytd-compact-video-renderer #video-title')?.textContent;
    const thumbnail = document.querySelector('ytd-compact-video-renderer img')?.getAttribute('src') || '';
    return { pass: watchTitle === 'Original Watch Title' &&
        cardTitle === 'Original Related Title' && thumbnail.startsWith('blob:'),
      detail: `watch=${watchTitle} card=${cardTitle}` };
  });
  await page.evaluate(() => {
    window.__wblockTubeDebug.setDeArrowSetting('replaceTitles', true);
  });
  await check(page, 'desktop', 'reapplies DeArrow titles from its bounded session cache', () => {
    const requests = window.__wblockDeArrowRequests || [];
    const watchTitle = document.querySelector('#watch-metadata h1 yt-formatted-string')?.textContent;
    const cardTitle = document.querySelector('ytd-compact-video-renderer #video-title')?.textContent;
    return { pass: requests.length === 2 && watchTitle === 'Accurate Watch Title' && cardTitle === 'Accurate Related Title',
      detail: `requests=${requests.length} watch=${watchTitle} card=${cardTitle}` };
  });
  await page.waitForFunction(() => document.querySelector('#watch-metadata h1 yt-formatted-string')?.textContent === 'Accurate Watch Title');
  await page.waitForFunction(() => !!window.__wblockSponsorRequest);
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await check(page, 'desktop', 'skips sponsors through the k-anonymous SponsorBlock endpoint', () => {
    const video = document.querySelector('#movie_player video');
    const request = window.__wblockSponsorRequest || '';
    const notice = document.querySelector('.wblock-tc-sponsor-notice');
    return {
      pass: video.currentTime === 20 && !!notice && !request.includes('dQw4w9WgXcQ') && /skipSegments\/[a-f0-9]{5}/.test(request),
      detail: `time=${video.currentTime} notice=${!!notice} request=${request}`,
    };
  });
  await page.click('.wblock-tc-sponsor-notice button');
  await check(page, 'desktop', 'undoes a SponsorBlock skip without immediately reskipping', () => {
    const video = document.querySelector('#movie_player video');
    video.dispatchEvent(new Event('timeupdate'));
    return { pass: video.currentTime > 10 && video.currentTime < 11,
      detail: `time=${video.currentTime}` };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    video.currentTime = 5;
    video.dispatchEvent(new Event('timeupdate'));
    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await check(page, 'desktop', 'skips a SponsorBlock segment again after Undo and re-entry', () => {
    const video = document.querySelector('#movie_player video');
    const notice = document.querySelector('.wblock-tc-sponsor-notice');
    return { pass: video.currentTime === 20 && !!notice, detail: `time=${video.currentTime} notice=${!!notice}` };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    let seeking = true;
    Object.defineProperty(video, 'seeking', { configurable: true, get: () => seeking });
    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
    window.__wblockSeekingSponsorTime = video.currentTime;
    seeking = false;
  });
  await check(page, 'desktop', 'does not skip a SponsorBlock segment during an in-progress seek', () => ({
    pass: window.__wblockSeekingSponsorTime === 12,
    detail: `time=${window.__wblockSeekingSponsorTime}`,
  }));
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 300 });
    video.currentTime = 291;
    video.dispatchEvent(new Event('timeupdate'));
    window.__wblockEndSkipTime = video.currentTime;
    delete video.duration;
  });
  // Seeking a WebKit media element to exactly its duration replays the video
  // instead of firing ended, which is what Safari users saw as "restarts at
  // the end" whenever an outro segment ran to the last frame.
  await check(page, 'desktop', 'stops a SponsorBlock skip just short of the duration instead of seeking to the end', () => ({
    pass: window.__wblockEndSkipTime > 299.9 && window.__wblockEndSkipTime < 300,
    detail: `time=${window.__wblockEndSkipTime}`,
  }));
  await page.evaluate(() => {
    history.replaceState(null, '', location.pathname + '?v=dQw4w9WgXcQ&cache-check=1');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(300);
  await check(page, 'desktop', 'reuses SponsorBlock and DeArrow caches across SPA activation', () => ({
    pass: window.__wblockSponsorRequestCount === 1 && window.__wblockDeArrowRequests.length === 2,
    detail: `sponsorRequests=${window.__wblockSponsorRequestCount} deArrowRequests=${window.__wblockDeArrowRequests.length}`,
  }));
  await page.evaluate(() => {
    window.__wblockTubeDebug.setDeArrowSetting('randomThumbnails', true);
    const card = document.createElement('ytd-compact-video-renderer');
    card.setAttribute('data-video-id', 'RANDOMVID01');
    card.setAttribute('data-channel-id', 'other-channel');
    card.innerHTML = '<a id="thumbnail" href="/watch?v=RANDOMVID01"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a><a id="video-title" href="/watch?v=RANDOMVID01">Original random video</a>';
    document.getElementById('recommendations').appendChild(card);
  });
  await page.waitForFunction(() => document.querySelector('[data-video-id="RANDOMVID01"] img')?.getAttribute('src')?.startsWith('blob:'));
  await check(page, 'desktop', 'uses DeArrow random-time fallback when a video has no submitted thumbnail', () => {
    const image = document.querySelector('[data-video-id="RANDOMVID01"] img');
    const requested = image?.getAttribute('data-wblock-dearrow-thumbnail') || '';
    return { pass: requested.includes('dearrow-thumb.ajay.app/api/v1/getThumbnail') && requested.includes('time=30'), detail: `requested=${requested}` };
  });
  await page.evaluate(() => {
    document.querySelector('.wblock-tc-sponsor-button').click();
    const selfPromo = document.querySelector('[data-sponsor-category="selfpromo"]');
    selfPromo.value = 'auto';
    selfPromo.dispatchEvent(new Event('change', { bubbles: true }));
    const interaction = document.querySelector('[data-sponsor-category="interaction"]');
    interaction.value = 'ask';
    interaction.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await check(page, 'desktop', 'persists SponsorBlock category settings from its toolbar panel', () => {
    const panel = document.querySelector('.wblock-tc-sponsor-menu');
    const settings = JSON.parse(localStorage.getItem('wblock.tubeCleaner.sponsorBlock') || '{}');
    return { pass: panel?.style.display === 'block' && settings.modes?.selfpromo === 'auto' &&
        settings.modes?.interaction === 'ask',
      detail: `panel=${panel?.style.display} selfpromo=${settings.modes?.selfpromo} interaction=${settings.modes?.interaction}` };
  });
  await check(page, 'desktop', 'credits SponsorBlock and links its donate page from the panel footer', () => {
    const links = [...document.querySelectorAll('.wblock-tc-sponsor-menu a')].map(a => a.href + '|' + a.textContent);
    return { pass: links.includes('https://sponsor.ajay.app/|Using SponsorBlock') && links.includes('https://sponsor.ajay.app/donate/|Donate'),
      detail: links.join(' ') };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    video.currentTime = 35;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await check(page, 'desktop', 'applies newly enabled SponsorBlock categories immediately', () => {
    const video = document.querySelector('#movie_player video');
    return { pass: video.currentTime === 40, detail: `time=${video.currentTime}` };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    video.currentTime = 55;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await check(page, 'desktop', 'supports SponsorBlock show-skip-button mode', () => {
    const video = document.querySelector('#movie_player video');
    const button = document.querySelector('.wblock-tc-sponsor-notice button');
    return { pass: video.currentTime === 55 && !!button, detail: `time=${video.currentTime} button=${button?.textContent}` };
  });
  await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-notice button').click());
  await check(page, 'desktop', 'manual SponsorBlock button skips the configured segment', () => {
    const video = document.querySelector('#movie_player video');
    return { pass: video.currentTime === 60, detail: `time=${video.currentTime}` };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    video.currentTime = 45;
    video.dispatchEvent(new Event('timeupdate'));
    video.currentTime = 55;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await check(page, 'desktop', 'shows the SponsorBlock Skip notice again after leaving and re-entering', () => {
    const video = document.querySelector('#movie_player video');
    const button = document.querySelector('.wblock-tc-sponsor-notice button');
    return { pass: video.currentTime === 55 && !!button, detail: `time=${video.currentTime} button=${button?.textContent}` };
  });
  await page.evaluate(() => document.querySelector('.wblock-tc-sponsor-notice button').click());
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    window.__wblockSyntheticMediaTime = 69.9;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => window.__wblockSyntheticMediaTime,
      set: value => { window.__wblockSyntheticMediaTime = value; },
    });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    video.dispatchEvent(new Event('playing'));
    setTimeout(() => { window.__wblockSyntheticMediaTime = 70.1; }, 70);
  });
  await page.waitForTimeout(180);
  await check(page, 'desktop', 'skips at a scheduled SponsorBlock boundary without timeupdate', () => {
    const video = document.querySelector('#movie_player video');
    return { pass: video.currentTime === 80, detail: `time=${video.currentTime}` };
  });
  await page.evaluate(() => {
    const channel = document.querySelector('[data-sponsor-channel="test-channel"] input');
    channel.checked = true;
    channel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await check(page, 'desktop', 'persists SponsorBlock channel exclusions', () => {
    const settings = JSON.parse(localStorage.getItem('wblock.tubeCleaner.sponsorBlock') || '{}');
    const button = document.querySelector('.wblock-tc-sponsor-button');
    return { pass: settings.excludedChannels?.includes('test-channel') && button?.getAttribute('aria-pressed') === 'false',
      detail: `channels=${settings.excludedChannels?.join(',')} active=${button?.getAttribute('aria-pressed')}` };
  });
  await controlsSurvivalCheck(page, 'desktop');
  await audioToggleCheck(page, 'desktop');
  await desktopPartialQualityLadderCheck(page);
  await qualityUISelectionCheck(page, 'desktop');
  await page.evaluate(() => {
    // On a real SPA navigation the persistent player can briefly expose the
    // old ytInitialData after the URL already identifies the next video.
    // Recreate that timing, then navigate to a video with no chapter payload.
    window.ytInitialData = {
      engagementPanels: [{ macroMarkersListItemRenderer: {
        timeDescription: { simpleText: '0:00' }, title: { simpleText: 'Old chapter' }
      }}]
    };
    window.ytInitialPlayerResponse = {
      videoDetails: { videoId: 'dQw4w9WgXcQ', channelId: 'test-channel' }
    };
    window.__wblockTubeDebug.applyChapters();
    history.replaceState(null, '', location.pathname + '?v=NOCHAPTERS01');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(150);
  await check(page, 'desktop', 'clears stale chapters when the next video has none', () => {
    const video = document.querySelector('#movie_player video');
    const track = video ? Array.from(video.textTracks).find(t => t.kind === 'chapters') : null;
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return { pass: labels.length === 0, detail: `labels=${labels.join(' | ')} mode=${track?.mode}` };
  });
  await page.evaluate(() => {
    function render(time, title) {
      return { macroMarkersListItemRenderer: {
        timeDescription: { simpleText: time }, title: { simpleText: title }
      }};
    }
    window.ytInitialData = {
      engagementPanels: [render('0:00', 'New chapter'), render('0:45', 'Another chapter')]
    };
    window.ytInitialPlayerResponse = { videoDetails: { videoId: 'NEWCHAP01XX' } };
    history.replaceState(null, '', location.pathname + '?v=NEWCHAP01XX');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await check(page, 'desktop', 'restores valid chapters after stale-track clearing', () => {
    const video = document.querySelector('#movie_player video');
    const track = video ? Array.from(video.textTracks).find(t => t.kind === 'chapters') : null;
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return {
      pass: JSON.stringify(labels) === JSON.stringify(['0:00  New chapter', '0:45  Another chapter']) && track?.mode === 'hidden',
      detail: `labels=${labels.join(' | ')} mode=${track?.mode}`,
    };
  });
  await page.evaluate(() => {
    const payload = window.ytInitialData;
    payload.engagementPanels[0].macroMarkersListItemRenderer.title.simpleText = 'Mutated in place';
    history.replaceState(null, '', location.pathname + '?v=MUTATED01XX');
    window.__wblockTubeDebug.applyChapters();
  });
  await check(page, 'desktop', 'recovers chapters when ytInitialData mutates in place', () => {
    const video = document.querySelector('#movie_player video');
    const track = Array.from(video?.textTracks || []).find(t => t.kind === 'chapters');
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return { pass: labels[0] === '0:00  Mutated in place' && track?.mode === 'hidden', detail: `labels=${labels.join(' | ')} mode=${track?.mode}` };
  });
  await page.evaluate(() => {
    window.ytInitialData = {
      playerOverlays: {
        playerOverlayRenderer: {
          decoratedPlayerBarRenderer: {
            decoratedPlayerBarRenderer: {
              playerBar: {
                multiMarkersPlayerBarRenderer: {
                  markersMap: [{
                    value: {
                      chapters: [
                        { chapterRenderer: { title: { simpleText: 'Introduction example' }, timeRangeStartMillis: 0 } },
                        { chapterRenderer: { title: { simpleText: 'Series preview' }, timeRangeStartMillis: 67000 } }
                      ]
                    }
                  }]
                }
              }
            }
          }
        }
      }
    };
    window.__wblockTubeDebug.applyChapters();
  });
  await check(page, 'desktop', 'mirrors player-bar chapterRenderer payloads', () => {
    const video = document.querySelector('#movie_player video');
    const track = Array.from(video?.textTracks || []).find(t => t.kind === 'chapters');
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return {
      pass: JSON.stringify(labels) === JSON.stringify(['0:00  Introduction example', '1:07  Series preview']),
      detail: `labels=${labels.join(' | ')}`,
    };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    const element = video.querySelector('track[data-wblock-native-chapters]');
    if (element) element.remove();
    video._wblockChaptersElement = null;
    video._wblockChaptersBlobUrl = null;
    video._wblockChaptersTrack = null;
    video._wblockChapterData = null;
    video._wblockChapterVideoId = null;
    video._wblockChapterFingerprint = null;
    video._wblockChapterApplyKey = null;
    window.ytInitialData = {};
    window.ytInitialPlayerResponse = { videoDetails: { videoId: 'LATECHAP01X' } };
    history.replaceState(null, '', location.pathname + '?v=LATECHAP01X');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.ytInitialData = {
      engagementPanels: [{
        macroMarkersListItemRenderer: {
          timeDescription: { simpleText: '0:00' },
          title: { simpleText: 'Late chapter' }
        }
      }]
    };
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await check(page, 'desktop', 'applies chapters that land after the player is already nativeized', () => {
    const video = document.querySelector('#movie_player video');
    const track = Array.from(video?.textTracks || []).find(t => t.kind === 'chapters');
    const labels = track?.cues ? Array.from(track.cues).map(c => c.text) : [];
    return { pass: labels[0] === '0:00  Late chapter', detail: `labels=${labels.join(' | ')}` };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
    video.dispatchEvent(new Event('play'));
  });
  await page.waitForFunction(() => document.querySelector('.wblock-tc-toolbar')?.style.opacity === '0', undefined, { timeout: 4000 });
  await check(page, 'desktop', 'desktop toolbar auto-hides after playback while the pointer stays over the player', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    return { pass: o === '0', detail: `opacity=${o}` };
  });
  const playerBox = await page.$eval('#movie_player', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(playerBox.x, playerBox.y);
  await page.mouse.move(playerBox.x + 12, playerBox.y + 8);
  await check(page, 'desktop', 'desktop toolbar reappears on movement while already hovering the player', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    const pe = document.querySelector('.wblock-tc-toolbar')?.style.pointerEvents;
    return { pass: o === '1' && pe === 'auto', detail: `opacity=${o} pointerEvents=${pe}` };
  });
  await page.mouse.move(20, 20);
  await page.waitForTimeout(200);
  await page.mouse.move(24, 80);
  await page.mouse.move(80, 140);
  await page.waitForFunction(() => document.querySelector('.wblock-tc-toolbar')?.style.opacity === '0', undefined, { timeout: 4000 });
  await check(page, 'desktop', 'desktop toolbar still hides after leaving the player even if the pointer keeps moving', () => {
    const o = document.querySelector('.wblock-tc-toolbar')?.style.opacity;
    return { pass: o === '0', detail: `opacity=${o}` };
  });
  // pointer-events does not cascade: a hidden toolbar whose buttons still
  // accept hits swallows taps meant for the video underneath.
  await check(page, 'desktop', 'hidden toolbar buttons do not intercept pointer events', () => {
    const toolbar = document.querySelector('.wblock-tc-toolbar');
    const buttons = toolbar ? Array.from(toolbar.querySelectorAll('button')) : [];
    if (!buttons.length) return { pass: false, detail: 'no toolbar buttons' };
    const live = buttons.filter(b => getComputedStyle(b).pointerEvents !== 'none');
    const cls = toolbar.classList.contains('wblock-tc-toolbar-hidden');
    return { pass: cls && live.length === 0, detail: `hiddenClass=${cls} liveButtons=${live.length}/${buttons.length}` };
  });
  record('desktop', 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: persistent YouTube video resume identity ------------------
{
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (persistent SPA resume)', {
    fixture: FIXTURE_URL,
    scriptSource: userscript,
    viewport: { width: 1280, height: 800 },
  });
  const S = 'tube-cleaner-persistent-resume';
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    player.getVideoData = () => ({ video_id: 'DUMMYVID001' });
    history.replaceState(null, '', location.pathname + '?v=DUMMYVID001');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    window.__wblockResumeCurrent = 37;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => window.__wblockResumeCurrent, set: value => { window.__wblockResumeCurrent = value; } });
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 120 });
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 1 });
    localStorage.setItem('wblock.tubeCleaner.position.NEXTVIDEO01', JSON.stringify({ time: 88 }));
    history.replaceState(null, '', location.pathname + '?v=NEXTVIDEO01');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(150);
  await check(page, S, 'does not apply the next URL resume time before YouTube confirms transition', () => ({
    pass: window.__wblockResumeCurrent === 37 && JSON.parse(localStorage.getItem('wblock.tubeCleaner.position.NEXTVIDEO01')).time === 88,
    detail: `current=${window.__wblockResumeCurrent} nextSaved=${localStorage.getItem('wblock.tubeCleaner.position.NEXTVIDEO01')}`,
  }));
  await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    player.getVideoData = () => ({ video_id: 'NEXTVIDEO01' });
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(100);
  await check(page, S, 'waits for a confirmed media event before restoring the next video', () => ({
    pass: window.__wblockResumeCurrent === 37,
    detail: `beforeMetadata=${window.__wblockResumeCurrent}`,
  }));
  await page.evaluate(() => document.querySelector('#movie_player video').dispatchEvent(new Event('loadedmetadata')));
  await check(page, S, 'restores the confirmed next video position', () => {
    const video = document.querySelector('#movie_player video');
    const player = document.getElementById('movie_player');
    return {
      pass: window.__wblockResumeCurrent === 88,
      detail: `afterMetadata=${window.__wblockResumeCurrent} saved=${localStorage.getItem('wblock.tubeCleaner.position.NEXTVIDEO01')} id=${player.getVideoData().video_id} ready=${video.readyState} duration=${video.duration} cleaned=${player.getAttribute('data-wblock-tc-cleaned')}`,
    };
  });
  await page.evaluate(() => {
    window.__wblockResumeCurrent = 41;
    const video = document.querySelector('#movie_player video');
    video.dispatchEvent(new Event('canplay'));
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await check(page, S, 'does not yank the playhead back after a later seek', () => ({
    pass: window.__wblockResumeCurrent === 41,
    detail: `afterSeek=${window.__wblockResumeCurrent}`,
  }));
  await page.evaluate(() => {
    const container = document.querySelector('#movie_player .html5-video-container');
    const next = document.createElement('video');
    Object.defineProperty(next, 'currentTime', { configurable: true, get: () => window.__wblockResumeCurrent, set: value => { window.__wblockResumeCurrent = value; } });
    Object.defineProperty(next, 'duration', { configurable: true, get: () => 120 });
    Object.defineProperty(next, 'readyState', { configurable: true, get: () => 1 });
    container.querySelector('video').replaceWith(next);
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => document.querySelector('#movie_player video').dispatchEvent(new Event('loadedmetadata')));
  await check(page, S, 'does not restore over a same-video SABR element that already has a playhead', () => ({
    pass: window.__wblockResumeCurrent === 41,
    detail: `afterSwap=${window.__wblockResumeCurrent}`,
  }));
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 2: non-standard watch-page aspect ratios ------------------
{
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (square video layout)', {
    fixture: FIXTURE_URL,
    viewport: { width: 600, height: 900 },
    scriptSource: userscript,
  });
  const S = 'tube-cleaner-square-aspect';

  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    const wrap = document.getElementById('player-wrap');
    const metadata = document.getElementById('watch-metadata');

    // Match mobile YouTube's body-level fixed-ratio player container. Its
    // reserved 16:9 height does not grow when #movie_player grows.
    wrap.id = 'player-container-id';
    wrap.className = 'player-container sticky-player';
    wrap.style.cssText = 'position:fixed;top:24px;left:0;width:600px;max-width:100%;margin:0;height:337.5px!important';

    // Mobile YouTube reserves flow space with a separate placeholder div.
    // Insert one between the player container and the metadata.
    const placeholder = document.createElement('div');
    placeholder.className = 'player-size player-placeholder';
    placeholder.style.cssText = 'position:relative;width:600px;max-width:100%;height:337.5px;margin:24px auto 0';
    metadata.parentElement.insertBefore(placeholder, metadata);
    metadata.style.marginTop = '0';

    window.__wblockBaseMetadataTop = metadata.getBoundingClientRect().top;
    window.__wblockBasePlayerTop = document.getElementById('movie_player').getBoundingClientRect().top;

    window.__wblockSyntheticVideoSize = [1000, 1000];
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      get: () => window.__wblockSyntheticVideoSize[0],
    });
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      get: () => window.__wblockSyntheticVideoSize[1],
    });
    video.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => document.querySelector('.player-placeholder')?.classList.contains('wblock-tc-aspect-host'), { timeout: 2000 }).catch(() => {});
  await check(page, S, 'grows a square player and moves the rest of the watch page below it', () => {
    const wrap = document.getElementById('player-container-id');
    const player = document.getElementById('movie_player')?.getBoundingClientRect();
    const video = document.querySelector('#movie_player video')?.getBoundingClientRect();
    const placeholder = document.querySelector('.player-placeholder');
    const placeholderRect = placeholder?.getBoundingClientRect();
    const metadata = document.getElementById('watch-metadata');
    const metadataRect = metadata?.getBoundingClientRect();
    const square = !!(player && Math.abs(player.width - player.height) < 1);
    const videoFillsPlayer = !!(player && video &&
      Math.abs(video.width - player.width) < 1 && Math.abs(video.height - player.height) < 1);
    const placeholderGrew = !!(placeholderRect && Math.abs(placeholderRect.height - player.height) < 2);
    const contentMoved = !!(player && metadataRect && metadataRect.top >= player.bottom - 2);
    return {
      pass: square && videoFillsPlayer && placeholderGrew && contentMoved && getComputedStyle(wrap).position === 'absolute',
      detail: `player=${player?.width.toFixed(0)}x${player?.height.toFixed(0)} placeholder=${placeholderRect?.height.toFixed(0)} metadataTop=${metadataRect?.top.toFixed(0)} position=${getComputedStyle(wrap).position}`,
    };
  });
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    Object.defineProperty(video, 'webkitDisplayingFullscreen', { configurable: true, get: () => true });
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
  });
  await check(page, S, 'suspends aspect reflow during iOS fullscreen events', () => ({
    pass: !document.querySelector('#movie_player')?.classList.contains('wblock-tc-aspect-host') &&
      !document.querySelector('.player-placeholder')?.classList.contains('wblock-tc-aspect-host'),
    detail: `playerHost=${document.querySelector('#movie_player')?.classList.contains('wblock-tc-aspect-host')} placeholderHost=${document.querySelector('.player-placeholder')?.classList.contains('wblock-tc-aspect-host')}`,
  }));
  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    Object.defineProperty(video, 'webkitDisplayingFullscreen', { configurable: true, get: () => false });
    video.dispatchEvent(new Event('webkitendfullscreen'));
  });

  await page.evaluate(() => scrollTo(0, 300));
  await page.waitForTimeout(50);
  await check(page, S, 'scrolls the expanded player with the page instead of pinning it', () => {
    const playerTop = document.getElementById('movie_player')?.getBoundingClientRect().top;
    const metadataTop = document.getElementById('watch-metadata')?.getBoundingClientRect().top;
    return {
      pass: playerTop < window.__wblockBasePlayerTop - 250 && metadataTop < 400,
      detail: `scrollY=${scrollY} playerTop=${playerTop?.toFixed(0)} metadataTop=${metadataTop?.toFixed(0)}`,
    };
  });
  await page.evaluate(() => scrollTo(0, 0));

  await page.evaluate(() => {
    window.__wblockSyntheticVideoSize = [1600, 900];
    document.querySelector('#movie_player video')?.dispatchEvent(new Event('resize'));
  });
  await check(page, S, 'restores normal frame spacing when the next video is 16:9', () => {
    const player = document.getElementById('movie_player');
    const wrap = document.getElementById('player-container-id');
    const metadata = document.getElementById('watch-metadata');
    const placeholder = document.querySelector('.player-placeholder');
    const playerRect = player?.getBoundingClientRect();
    const placeholderRect = placeholder?.getBoundingClientRect();
    const expectedHeight = (playerRect?.width || 0) * 9 / 16;
    return {
      pass: !!playerRect && Math.abs(playerRect.height - expectedHeight) < 1 &&
        !!placeholderRect && Math.abs(placeholderRect.height - expectedHeight) < 2 &&
        Math.abs(metadata.getBoundingClientRect().top - window.__wblockBaseMetadataTop) < 2 &&
        !player.classList.contains('wblock-tc-aspect-host') &&
        !wrap?.classList.contains('wblock-tc-aspect-host') &&
        !placeholder?.classList.contains('wblock-tc-aspect-host'),
      detail: `player=${playerRect?.width.toFixed(0)}x${playerRect?.height.toFixed(0)} placeholder=${placeholderRect?.height.toFixed(0)} metadataTop=${metadata.getBoundingClientRect().top.toFixed(0)} expected=${expectedHeight.toFixed(0)}`,
    };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 3: iPhone (mobile Safari) ----------------------------------
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('iPhone (mobile Safari)', {
    device: iphone,
    fixture: FIXTURE_URL,
    hasTouch: true,
    scriptSource: iosStuckPreferencesPrelude + '\n' + userscript,
  });
  await commonChecks(page, 'iPhone', { expectToolbar: false });
  await iosNativeControlsChecks(page, 'iPhone');
  await iosQualityLadderCheck(page, 'iPhone');
  await iosLandscapeCheck(page, 'iPhone');
  await iosAutoHideCheck(page, 'iPhone');
  await iosPinchFullscreenCheck(page, 'iPhone');
  await controlsSurvivalCheck(page, 'iPhone', { preserveIOSMMSRestrictions: true });
  record('iPhone', 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 3: iPad mobile UA (no playsinline) -------------------------
// Older iPadOS/mobile-site UAs still need the same inline-playback and touch UI
// defenses as modern iPadOS requesting the desktop site.
{
  const ipad = devices['iPad Pro 11'];
  const { browser, page, pageErrors } = await runScenario('iPad mobile UA (no playsinline)', {
    device: ipad,
    fixture: FIXTURE_NOPI_URL,
    hasTouch: true,
    scriptSource: iosStuckPreferencesPrelude + '\n' + userscript,
  });
  await commonChecks(page, 'iPad-mobile', { expectToolbar: false });
  await check(page, 'iPad-mobile', 'ensures playsinline for inline iOS playback', () => {
    const v = document.querySelector('#movie_player video');
    if (!v) return { pass: false, detail: 'no video' };
    const ok = v.hasAttribute('playsinline') || v.playsInline === true;
    return { pass: ok, detail: `playsInline=${v.playsInline}, attr=${v.hasAttribute('playsinline')}` };
  });
  await iosNativeControlsChecks(page, 'iPad-mobile');
  await controlsSurvivalCheck(page, 'iPad-mobile', { preserveIOSMMSRestrictions: true });
  record('iPad-mobile', 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 4: modern iPadOS requesting the desktop site --------------
// Current iPadOS identifies as MacIntel with touch points. This is the path that
// historically risks being mistaken for macOS, especially at document-start.
{
  const { browser, page, pageErrors } = await runScenario('iPadOS desktop-site UA', {
    fixture: FIXTURE_NOPI_URL,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    hasTouch: true,
    viewport: { width: 1024, height: 768 },
    scriptSource: iosStuckPreferencesPrelude + '\n' + ipadDesktopPrelude + '\n' + userscript,
  });
  const S = 'iPad-desktop';
  await commonChecks(page, S, { expectToolbar: false });
  await check(page, S, 'detects desktop-UA iPadOS as touch Safari', () => ({
    pass: navigator.platform === 'MacIntel' && navigator.maxTouchPoints === 5 &&
      !!document.querySelector('.wblock-tc-quality-button') &&
      !document.querySelector('.wblock-tc-audio-button'),
    detail: `platform=${navigator.platform} touches=${navigator.maxTouchPoints} quality=${!!document.querySelector('.wblock-tc-quality-button')} audio=${!!document.querySelector('.wblock-tc-audio-button')}`,
  }));
  await iosNativeControlsChecks(page, S);
  await controlsSurvivalCheck(page, S, { preserveIOSMMSRestrictions: true });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 5: Shorts stay stock (cleaner suspended on /shorts) --------
// Users asked for YouTube's own Shorts UI. On /shorts paths the cleaner must
// fully stand down (stylesheet suspended, player released, no toolbar) and
// must come back pre-paint when the SPA returns to a watch page.
{
  const { browser, page, pageErrors } = await runScenario('iPadOS multiple YouTube players', {
    fixture: FIXTURE_TUBE_MULTIPLE_URL,
    gotoURL: 'https://www.youtube.com/shorts/Shorts12345',
    responseBody: FIXTURE_TUBE_MULTIPLE_SOURCE,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    hasTouch: true,
    viewport: { width: 1024, height: 768 },
    scriptSource: ipadDesktopPrelude + '\n' + userscript,
    readySignal: '#current-short video',
  });
  const S = 'iPad-multiple-players';
  await check(page, S, 'suspends the stylesheet on Shorts', () => {
    const style = document.getElementById('wblock-tc-style');
    return { pass: !!style && style.disabled === true,
      detail: `present=${!!style} disabled=${style && style.disabled}` };
  });
  await check(page, S, 'leaves the Shorts player and video untouched', () => {
    const player = document.querySelector('#current-short');
    const video = player && player.querySelector('video');
    return { pass: !!player && !player.classList.contains('wblock-tc-native') &&
      !player.hasAttribute('data-wblock-tc-cleaned') &&
      !document.querySelector('.wblock-tc-toolbar') &&
      !!video && !video.hasAttribute('controls'),
      detail: `class=${player && player.className} controls=${video && video.hasAttribute('controls')}` };
  });
  await check(page, S, 'keeps YouTube Shorts chrome visible and interactive', () => {
    const chrome = document.querySelector('#current-short .ytp-chrome-bottom');
    if (!chrome) return { pass: false, detail: 'no chrome' };
    const style = getComputedStyle(chrome);
    return { pass: style.display !== 'none' && style.pointerEvents !== 'none',
      detail: `display=${style.display} pointerEvents=${style.pointerEvents}` };
  });
  await page.evaluate(() => {
    history.replaceState(null, '', '/watch?v=Shorts12345');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await check(page, S, 'resumes on watch and nativeizes the visible player, not the first DOM match', () => {
    const style = document.getElementById('wblock-tc-style');
    const selected = window.__wblockTubeDebug.getPlayer();
    const player = document.querySelector('#current-short');
    const video = player && player.querySelector('video');
    return { pass: !!style && style.disabled === false &&
      selected?.id === 'current-short' &&
      !!player && player.classList.contains('wblock-tc-native') &&
      !!video && video.controls === true &&
      !!player.querySelector('.wblock-tc-quality-button') &&
      !document.querySelector('#previous-short .wblock-tc-toolbar'),
      detail: `disabled=${style && style.disabled} selected=${selected?.id} controls=${video && video.controls}` };
  });
  await page.evaluate(() => {
    history.replaceState(null, '', '/shorts/Shorts12345');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await check(page, S, 'releases the player when returning to Shorts', () => {
    const style = document.getElementById('wblock-tc-style');
    const player = document.querySelector('#current-short');
    const video = player && player.querySelector('video');
    return { pass: !!style && style.disabled === true &&
      !!player && !player.classList.contains('wblock-tc-native') &&
      !player.hasAttribute('data-wblock-tc-cleaned') &&
      !document.querySelector('.wblock-tc-toolbar') &&
      !!video && !video.hasAttribute('controls'),
      detail: `disabled=${style && style.disabled} class=${player && player.className} controls=${video && video.hasAttribute('controls')}` };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 6: Tube Cleaner transforms before DOMContentLoaded ---------
// A <head> script creates the YouTube player. The document observer must install
// anti-flash CSS and nativeize the video in the same pre-paint mutation cycle.
{
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (pre-paint timing)', {
    fixture: FIXTURE_TUBE_EARLY_URL,
    readySignal: '#movie_player.wblock-tc-native',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'tube-cleaner-timing';

  await check(page, S, 'injects anti-flash CSS before DOMContentLoaded', () => {
    const t = window.__wblockEarlyTubeTiming;
    const pass = !!(t && t.styleAt > 0 && t.domContentLoadedAt > 0 && t.styleAt <= t.domContentLoadedAt);
    return { pass, detail: t ? `style=${t.styleAt.toFixed(1)}ms dcl=${t.domContentLoadedAt.toFixed(1)}ms` : 'no timing' };
  });

  await check(page, S, 'nativeizes before DOMContentLoaded', () => {
    const t = window.__wblockEarlyTubeTiming;
    const pass = !!(t && t.nativeAt > 0 && t.domContentLoadedAt > 0 && t.nativeAt <= t.domContentLoadedAt);
    return { pass, detail: t ? `native=${t.nativeAt.toFixed(1)}ms dcl=${t.domContentLoadedAt.toFixed(1)}ms` : 'no timing' };
  });

  await check(page, S, 'nativeizes within one frame of insertion', () => {
    const t = window.__wblockEarlyTubeTiming;
    const elapsed = t && t.nativeAt ? t.nativeAt - t.createdAt : Infinity;
    return { pass: elapsed >= 0 && elapsed < 50, detail: `latency=${Number.isFinite(elapsed) ? elapsed.toFixed(1) : 'n/a'}ms` };
  });

  await check(page, S, 'keeps YouTube chrome hidden', () => {
    const chrome = document.querySelector('#movie_player .ytp-chrome-bottom');
    return { pass: !!(chrome && getComputedStyle(chrome).display === 'none'),
      detail: chrome ? `display=${getComputedStyle(chrome).display}` : 'no chrome fixture' };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 5: Tube Cleaner resource lifecycle ------------------------
{
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (resource lifecycle)', {
    fixture: FIXTURE_URL,
    scriptSource: resourceCounterPatch + '\n' + userscript,
    readySignal: '.wblock-tc-toolbar',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'tube-cleaner-resources';
  await page.waitForTimeout(300);
  const baseline = await page.evaluate(() => ({ ...window.__wblockResourceCounters }));

  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const container = document.querySelector('#movie_player .html5-video-container');
      const oldVideo = container.querySelector('video');
      oldVideo.replaceWith(document.createElement('video'));
    });
    await page.waitForTimeout(80);
  }
  const after = await page.evaluate(() => ({ ...window.__wblockResourceCounters }));
  for (const key of ['listeners', 'intervals', 'mutationObservers', 'intersectionObservers']) {
    record(S, `${key} stay flat across video swaps`, after[key] === baseline[key],
      `baseline=${baseline[key]} after=${after[key]}`);
  }
  await check(page, S, 'replacement video remains native', () => {
    const v = document.querySelector('#movie_player video');
    return { pass: !!(v && v.controls && v.hasAttribute('controls')) };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 6: Player Cleaner on a custom (video.js) player ------------
// Verifies the ported controls guard: Player Cleaner enhances the existing
// <video> in place (opaque blob source) and must keep native controls on even
// though the custom player keeps stripping them.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (custom video.js player)', {
    fixture: FIXTURE_PLAYER_URL,
    scriptSource: playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });

  await check(page, 'player-cleaner', 'forces video.controls === true', () => {
    const v = document.querySelector('.video-js video');
    return { pass: !!(v && v.controls === true), detail: v ? `controls=${v.controls}` : 'no video' };
  });

  await check(page, 'player-cleaner', 'sets playsinline', () => {
    const v = document.querySelector('.video-js video');
    return { pass: !!(v && (v.playsInline || v.hasAttribute('playsinline'))) };
  });

  await check(page, 'player-cleaner', 'hides custom control overlay', () => {
    const bar = document.querySelector('.vjs-control-bar');
    return { pass: !!(bar && bar.style.display === 'none'), detail: bar ? `display=${bar.style.display}` : 'no bar' };
  });

  await check(page, 'player-cleaner', 'nativeizes MediaElement video in place', () => {
    const v = document.querySelector('#mediaelement-player video');
    return { pass: !!(v && v.controls && v.hasAttribute('data-test-mediaelement') &&
      v.hasAttribute('data-wblock-player-cleaner')) };
  });

  await check(page, 'player-cleaner', 'preserves MediaElement shell and hides its chrome', () => {
    const shell = document.querySelector('#mediaelement-player .mejs__inner');
    const chrome = document.querySelector('#mediaelement-player .mejs__controls');
    return { pass: !!(shell && chrome && chrome.style.display === 'none'),
      detail: `shell=${!!shell} chrome=${!!chrome} display=${chrome && chrome.style.display}` };
  });

  await page.waitForTimeout(4200); // let several fightControls rounds run
  await check(page, 'player-cleaner', 'native controls SURVIVE player turning them off', () => {
    const v = document.querySelector('.video-js video');
    if (!v) return { pass: false, detail: 'no video' };
    const hasAttr = v.hasAttribute('controls');
    return { pass: hasAttr, detail: `hasAttribute('controls')=${hasAttr} (getter=${v.controls})` };
  }, { timeout: 1500, interval: 500 });

  await check(page, 'player-cleaner', 'MediaElement lifecycle remains intact', () => ({
    pass: window.__wblockMediaElementLifecycleIntact === true,
    detail: `lifecycle=${window.__wblockMediaElementLifecycleIntact}`,
  }));

  await check(page, 'player-cleaner', 'nativeizes THEOplayer video and preserves its shell', () => {
    const v = document.querySelector('#theoplayer video');
    const ads = document.querySelector('#theoplayer .theo-ad-container');
    const chrome = document.querySelector('#theoplayer .theoplayer-controls');
    return { pass: !!(v && v.controls && v.hasAttribute('data-wblock-player-cleaner') && ads && chrome
      && chrome.style.display === 'none' && window.__wblockTheoLifecycleIntact === true),
      detail: `video=${!!v} controls=${v && v.controls} ads=${!!ads} chrome=${chrome && chrome.style.display} lifecycle=${window.__wblockTheoLifecycleIntact}` };
  });

  record('player-cleaner', 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Fox article audio host and media iframe -------------------
// Fox renders an audio-only stream through <video> beside a real media iframe.
// The audio host must not trigger Player Cleaner, and its iframe must remain usable.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Fox article video regression)', {
    fixture: FIXTURE_PLAYER_FOX_URL,
    scriptSource: playerUserscript,
    readySignal: '.mvpd-picker',
    viewport: { width: 800, height: 500 },
  });
  const S = 'player-cleaner-fox';

  await check(page, S, 'leaves declared audio-only video untouched', () => {
    const video = document.querySelector('#fox-audio-host');
    return { pass: !!(video && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video.hasAttribute('controls')), detail: video ? `controls=${video.controls} marked=${video.hasAttribute('data-wblock-player-cleaner')}` : 'no video' };
  });
  await check(page, S, 'preserves the playable MVPD iframe', () => {
    const iframe = document.querySelector('.mvpd-picker');
    const style = iframe && getComputedStyle(iframe);
    return { pass: !!(iframe && !iframe.hasAttribute('data-wblock-pc-hidden') &&
      style && style.display !== 'none' && style.visibility !== 'hidden'), detail: iframe ? `display=${style.display} visibility=${style.visibility}` : 'no iframe' };
  });
  await check(page, S, 'audio host still reaches readyState 4 and advances on Play', async () => {
    const video = window.__foxPlayVideo;
    const before = video && video.currentTime;
    if (video) await video.play();
    return { pass: !!(video && video.readyState === 4 && video.currentTime > before), detail: video ? `readyState=${video.readyState} before=${before} after=${video.currentTime}` : 'no video' };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 5: Player Cleaner clean-source replacement path ------------
// When the underlying media source is a clean http(s) URL, Player Cleaner keeps
// the original media element (and therefore its buffered state/poster/tracks),
// drops the custom chrome, and defends native controls.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (clean source replacement)', {
    fixture: FIXTURE_PLAYER_REPLACE_URL,
    scriptSource: playerPreferencesPrelude + '\n' + playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-replace';

  await check(page, S, 'keeps a single original <video>', () => {
    const c = document.getElementById('player-replace');
    const videos = c ? c.querySelectorAll('video') : [];
    const retained = videos.length === 1 && videos[0].hasAttribute('data-test-original');
    return { pass: retained, detail: `${videos.length} video(s), retained=${retained}` };
  });

  await check(page, S, 'resolves and retains the clean source', () => {
    const v = document.querySelector('#player-replace video');
    const source = v && (v.currentSrc || v.getAttribute('src') ||
      (v.querySelector('source') && v.querySelector('source').src));
    const ok = source === 'https://example.com/media/movie.mp4';
    return { pass: ok, detail: v ? `src=${source || ''}` : 'no video' };
  });

  await check(page, S, 'forces video.controls === true', () => {
    const v = document.querySelector('#player-replace video');
    return { pass: !!(v && v.controls === true), detail: v ? `controls=${v.controls}` : 'no video' };
  });

  await check(page, S, 'sets playsinline', () => {
    const v = document.querySelector('#player-replace video');
    return { pass: !!(v && (v.playsInline || v.hasAttribute('playsinline'))) };
  });

  await check(page, S, 'retains the poster attribute', () => {
    const v = document.querySelector('#player-replace video');
    const p = v ? v.getAttribute('poster') : null;
    return { pass: p === 'https://example.com/poster.jpg', detail: `poster=${p}` };
  });

  await check(page, S, 'retains the caption <track>', () => {
    const v = document.querySelector('#player-replace video');
    const t = v ? v.querySelector('track') : null;
    return { pass: !!t, detail: t ? `track src=${t.getAttribute('src')}` : 'no track' };
  });

  await page.evaluate(() => {
    const video = document.querySelector('#player-replace video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.dispatchEvent(new Event('durationchange'));
    video.dispatchEvent(new Event('play'));
  });
  await check(page, S, 'restores persistent playback and resume preferences', () => {
    const video = document.querySelector('#player-replace video');
    const english = Array.from(video.textTracks).find(track => track.language === 'en');
    return { pass: video.playbackRate === 1.5 && Math.abs(video.volume - 0.35) < 0.01 &&
        video.muted && video.currentTime === 42 && (!english || english.mode === 'showing'),
      detail: `rate=${video.playbackRate} volume=${video.volume} muted=${video.muted} time=${video.currentTime}` };
  });
  await check(page, S, 'publishes fallback system Now Playing metadata', () => {
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    return { pass: !!(metadata && metadata.title), detail: metadata ? `title=${metadata.title}` : 'no metadata' };
  });

  await check(page, S, 'removes custom control chrome', () => {
    const c = document.getElementById('player-replace');
    const bar = c ? c.querySelector('.vjs-control-bar') : null;
    const big = c ? c.querySelector('.vjs-big-play-button') : null;
    return { pass: !bar && !big, detail: `bar=${!!bar}, bigPlay=${!!big}` };
  });

  await check(page, S, 'marks container done + drops video-js class', () => {
    const c = document.getElementById('player-replace');
    const done = !!(c && c.hasAttribute('data-wblock-player-cleaner'));
    const declassed = !!(c && !c.classList.contains('video-js'));
    return { pass: done && declassed, detail: `done=${done}, declassed=${declassed}` };
  });

  await check(page, S, 'removes Video.js fluid padding without doubling the player box', () => {
    const c = document.getElementById('player-replace');
    const v = c && c.querySelector('video');
    if (!c || !v) return { pass: false, detail: 'missing player' };
    const cr = c.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    const style = getComputedStyle(c);
    const pass = !c.classList.contains('vjs-fluid') && parseFloat(style.paddingBottom) === 0 &&
      Math.abs(cr.height - vr.height) < 2;
    return { pass, detail: `class=${c.className} padding=${style.paddingBottom} heights=${cr.height}/${vr.height}` };
  });

  await check(page, S, 'overrides document.hidden (background playback)', () => {
    const desc = Object.getOwnPropertyDescriptor(document, 'hidden');
    return { pass: !!(desc && typeof desc.get === 'function' && document.hidden === false),
      detail: `hidden=${document.hidden}, overridden=${!!(desc && desc.get)}` };
  });

  await check(page, S, 'hooks auto-PiP on the clean video', () => {
    const v = document.querySelector('#player-replace video');
    return { pass: !!(v && v._wblockAutoPiPHooked === true) };
  });

  // Idempotency: recovery scans and the MutationObserver must never add a
  // second video.
  await page.waitForTimeout(2600);
  await check(page, S, 'stays a single video after rescans (idempotent)', () => {
    const c = document.getElementById('player-replace');
    const vids = c ? c.querySelectorAll('video').length : 0;
    return { pass: vids === 1, detail: `${vids} video(s) after rescans` };
  });

  await page.waitForTimeout(2000); // let several fightControls rounds run
  await check(page, S, 'native controls SURVIVE player turning them off', () => {
    const v = document.querySelector('#player-replace video');
    if (!v) return { pass: false, detail: 'no video' };
    const hasAttr = v.hasAttribute('controls');
    return { pass: hasAttr, detail: `hasAttribute('controls')=${hasAttr} (getter=${v.controls})` };
  }, { timeout: 1500, interval: 500 });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 6: Player Cleaner media source ownership ------------------
// Direct sources owned by the media element may be structurally cleaned.
// URLs exposed only through APIs or data attributes may belong to a player
// that is still initializing, so they must not authorize wrapper deletion.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (media source ownership)', {
    fixture: FIXTURE_PLAYER_DISCOVERY_URL,
    scriptSource: playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-source-ownership';

  const directCases = [
    ['p-src', 'https://example.com/a.mp4'],
    ['p-source-child', 'https://example.com/b.mp4'],
  ];
  await check(page, S, 'cleans players with element-owned direct sources', (cases) => {
    const bad = cases.filter(([id, expected]) => {
      const v = document.querySelector(`#${id} video`);
      const source = v && (v.currentSrc || v.getAttribute('src') ||
        (v.querySelector('source') && v.querySelector('source').src));
      return !(v && v._wblockCleaned && v.controls && source === expected);
    });
    return { pass: bad.length === 0, detail: bad.length ? `bad: ${bad.map(([id]) => id).join(',')}` : '2/2 cleaned' };
  }, { arg: directCases });

  const initializingCases = ['p-dom', 'p-videojs', 'p-jwplayer'];
  await check(page, S, 'does not apply external URL hints to source-less videos', (ids) => {
    const bad = ids.filter((id) => {
      const v = document.querySelector(`#${id} video`);
      return !v || v.currentSrc || v.getAttribute('src') || v._wblockCleaned;
    });
    return { pass: bad.length === 0, detail: bad.length ? `bad: ${bad.join(',')}` : '3/3 waiting for element source' };
  }, { arg: initializingCases });

  await check(page, S, 'preserves player setup DOM while videos are source-less', (ids) => {
    const bad = ids.filter((id) => !document.querySelector(`#${id} .setup-sentinel`));
    return { pass: bad.length === 0, detail: bad.length ? `missing: ${bad.join(',')}` : '3/3 setup sentinels retained' };
  }, { arg: initializingCases });

  await check(page, S, 'keeps opaque MSE pipelines enhanced in place', () => {
    const ids = ['p-poster', 'p-dash'];
    const bad = ids.filter((id) => {
      const v = document.querySelector(`#${id} video`);
      return !(v && v.src.startsWith('blob:') && v.controls && !v._wblockCleaned);
    });
    return { pass: bad.length === 0, detail: bad.length ? `bad: ${bad.join(',')}` : '2/2 blobs retained' };
  });

  await page.waitForTimeout(2600);
  await check(page, S, 'remains idempotent across recovery scans', () => {
    const ids = ['p-src', 'p-source-child', 'p-dom', 'p-videojs', 'p-jwplayer', 'p-poster', 'p-dash'];
    const bad = ids.filter((id) => document.querySelectorAll(`#${id} video`).length !== 1);
    return { pass: bad.length === 0, detail: bad.length ? `bad: ${bad.join(',')}` : '7/7 single-video' };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Player Cleaner: Archive.org-style shadow-root JW Player ------------
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (shadow-root JW Player)', {
    fixture: FIXTURE_PLAYER_SHADOW_URL,
    scriptSource: resourceCounterPatch + '\n' + playerUserscript,
    readySignal: 'test-play-av',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-shadow';

  await check(page, S, 'nativeizes shadow video before DOMContentLoaded', () => {
    const t = window.__wblockShadowTiming;
    const pass = !!(t && t.nativeAt > 0 && t.domContentLoadedAt > 0 && t.nativeAt <= t.domContentLoadedAt);
    return { pass, detail: t ? `native=${t.nativeAt.toFixed(1)}ms dcl=${t.domContentLoadedAt.toFixed(1)}ms` : 'no timing' };
  });

  await check(page, S, 'nativeizes shadow video within one frame', () => {
    const t = window.__wblockShadowTiming;
    const elapsed = t && t.nativeAt ? t.nativeAt - t.createdAt : Infinity;
    return { pass: elapsed >= 0 && elapsed < 50,
      detail: `latency=${Number.isFinite(elapsed) ? elapsed.toFixed(1) : 'n/a'}ms` };
  });

  await check(page, S, 'retains Archive-style media element and absolute source', () => {
    const root = document.querySelector('test-play-av').shadowRoot;
    const videos = root.querySelectorAll('video');
    const v = videos[0];
    const retained = videos.length === 1 && v.hasAttribute('data-test-original');
    return { pass: retained && v.src === 'https://example.com/download/archive/movie.mp4',
      detail: `count=${videos.length} retained=${retained} src=${v.src}` };
  });

  await check(page, S, 'forces native controls inside shadow root', () => {
    const v = document.querySelector('test-play-av').shadowRoot.querySelector('video');
    return { pass: !!(v && v.controls && v.hasAttribute('controls') &&
      v.hasAttribute('data-wblock-player-cleaner')) };
  });

  await check(page, S, 'preserves shadow component but hides JW chrome', () => {
    const root = document.querySelector('test-play-av').shadowRoot;
    const chrome = root.querySelector('.jw-controls');
    return { pass: !!(chrome && chrome.style.display === 'none'),
      detail: `present=${!!chrome} display=${chrome && chrome.style.display}` };
  });

  await page.waitForFunction(() => {
    const v = window.__wblockClosedPlayerRoot && window.__wblockClosedPlayerRoot.querySelector('video');
    return v && v.hasAttribute('data-wblock-player-cleaner');
  });
  await check(page, S, 'keeps the closed-shadow player host visible', () => {
    const frame = document.getElementById('closed-player-frame');
    const host = frame && frame.querySelector('test-closed-player');
    const v = window.__wblockClosedPlayerRoot && window.__wblockClosedPlayerRoot.querySelector('video');
    const chrome = window.__wblockClosedPlayerRoot && window.__wblockClosedPlayerRoot.querySelector('.controls');
    const visible = frame && host && getComputedStyle(frame).display !== 'none' &&
      getComputedStyle(host).display !== 'none' && !frame.hasAttribute('data-wblock-pc-hidden') &&
      !host.hasAttribute('data-wblock-pc-hidden');
    return { pass: !!(visible && v && v.controls && chrome && getComputedStyle(chrome).display === 'none'),
      detail: `visible=${!!visible} controls=${v && v.controls} chrome=${chrome && getComputedStyle(chrome).display}` };
  });

  await page.evaluate(() => {
    document.querySelector('test-play-av').shadowRoot.querySelector('video').removeAttribute('controls');
  });
  await check(page, S, 'shadow controls survive player removal attempts', () => {
    const v = document.querySelector('test-play-av').shadowRoot.querySelector('video');
    return { pass: !!(v && v.hasAttribute('controls')) };
  });

  const baseline = await page.evaluate(() => ({ ...window.__wblockResourceCounters }));
  await page.evaluate(() => {
    const host = document.querySelector('test-play-av');
    host.remove();
    setTimeout(() => document.body.appendChild(host), 50);
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ ...window.__wblockResourceCounters }));
  for (const key of ['listeners', 'intervals', 'mutationObservers', 'intersectionObservers']) {
    record(S, `${key} stay flat after shadow host reattachment`, after[key] === baseline[key],
      `baseline=${baseline[key]} after=${after[key]}`);
  }
  await check(page, S, 'reattached shadow video is native again', () => {
    const v = document.querySelector('test-play-av').shadowRoot.querySelector('video');
    return { pass: !!(v && v.controls && v.hasAttribute('data-wblock-player-cleaner')) };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Reddit shreddit-player)', {
    fixture: FIXTURE_PLAYER_REDDIT_URL,
    scriptSource: playerUserscript,
    readySignal: 'shreddit-player',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-reddit';

  await check(page, S, 'nativeizes the shadow video', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    return {
      pass: !!(video && video.controls && video.hasAttribute('data-wblock-player-cleaner')),
      detail: video ? `controls=${video.controls} done=${video.getAttribute('data-wblock-player-cleaner')}` : 'no video'
    };
  });

  await check(page, S, 'hides shreddit-media-ui without hiding the host', () => {
    const host = document.querySelector('shreddit-player');
    const ui = host && host.shadowRoot && host.shadowRoot.querySelector('shreddit-media-ui');
    const hostHidden = !!(host && (host.hasAttribute('data-wblock-pc-hidden') ||
      getComputedStyle(host).display === 'none'));
    const uiHidden = !!(ui && (ui.hasAttribute('data-wblock-pc-hidden') ||
      getComputedStyle(ui).display === 'none'));
    return {
      pass: !!(host && ui && !hostHidden && uiHidden),
      detail: `hostHidden=${hostHidden} uiHidden=${uiHidden}`
    };
  });

  await page.evaluate(() => {
    const host = document.querySelector('shreddit-player');
    const root = host.shadowRoot;
    const old = root.querySelector('shreddit-media-ui');
    const next = old.cloneNode(true);
    old.remove();
    root.appendChild(next);
  });

  await check(page, S, 're-hides a remounted shreddit-media-ui', () => {
    const host = document.querySelector('shreddit-player');
    const ui = host && host.shadowRoot && host.shadowRoot.querySelector('shreddit-media-ui');
    const uiHidden = !!(ui && (ui.hasAttribute('data-wblock-pc-hidden') ||
      getComputedStyle(ui).display === 'none'));
    return { pass: uiHidden, detail: ui ? `hidden=${uiHidden}` : 'no ui' };
  });

  await check(page, S, 'video click does not toggle Reddit playback', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    window.__redditToggleCount = 0;
    const paused = video.paused;
    video.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return {
      pass: window.__redditToggleCount === 0 && video.paused === paused,
      detail: `toggles=${window.__redditToggleCount} paused=${video.paused}`
    };
  });
  await check(page, S, 'video pointerup does not toggle Reddit playback', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    window.__redditToggleCount = 0;
    const paused = video.paused;
    video.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true, pointerType: 'touch' }));
    return {
      pass: window.__redditToggleCount === 0 && video.paused === paused,
      detail: `toggles=${window.__redditToggleCount} paused=${video.paused}`
    };
  });
  await check(page, S, 'video touchend does not toggle Reddit playback', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    window.__redditToggleCount = 0;
    const paused = video.paused;
    video.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true, composed: true }));
    return {
      pass: window.__redditToggleCount === 0 && video.paused === paused,
      detail: `toggles=${window.__redditToggleCount} paused=${video.paused}`
    };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Reddit iPhone)', {
    device: iphone,
    hasTouch: true,
    fixture: FIXTURE_PLAYER_REDDIT_URL,
    scriptSource: playerUserscript,
    readySignal: 'shreddit-player',
  });
  const S = 'player-cleaner-reddit-iphone';

  await check(page, S, 'nativeizes the iOS shadow video', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    return {
      pass: !!(video && video.controls && video.hasAttribute('data-wblock-player-cleaner')),
      detail: video ? `controls=${video.controls} done=${video.getAttribute('data-wblock-player-cleaner')}` : 'no video'
    };
  });

  await check(page, S, 'iOS touchend does not toggle Reddit playback', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    window.__redditToggleCount = 0;
    const paused = video.paused;
    video.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true, composed: true }));
    return {
      pass: window.__redditToggleCount === 0 && video.paused === paused,
      detail: `toggles=${window.__redditToggleCount} paused=${video.paused}`
    };
  });

  await page.evaluate(() => {
    const host = document.querySelector('shreddit-player');
    const video = host.shadowRoot.querySelector('video');
    video._wblockInNativeFullscreen = true;
    try {
      video.dispatchEvent(new Event('webkitbeginfullscreen', { bubbles: true, composed: true }));
    } catch (e) { /* WebKit may reject untrusted fullscreen events */ }
    window.__redditHostPark = { parent: host.parentNode, next: host.nextSibling, host };
    host.remove();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const { parent, next, host } = window.__redditHostPark;
    parent.insertBefore(host, next || null);
    const video = host.shadowRoot.querySelector('video');
    const root = host.shadowRoot;
    const old = root.querySelector('shreddit-media-ui');
    const nextUi = old.cloneNode(true);
    old.remove();
    root.appendChild(nextUi);
    video._wblockInNativeFullscreen = false;
    try {
      video.dispatchEvent(new Event('webkitendfullscreen', { bubbles: true, composed: true }));
    } catch (e) { /* WebKit may reject untrusted fullscreen events */ }
  });

  await check(page, S, 'keeps nativeize through iOS fullscreen detach', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    return {
      pass: !!(video && video.controls && video.getAttribute('data-wblock-player-cleaner') === '1'),
      detail: video ? `controls=${video.controls} done=${video.getAttribute('data-wblock-player-cleaner')}` : 'no video'
    };
  });

  await check(page, S, 're-hides Reddit chrome after fullscreen exit', () => {
    const host = document.querySelector('shreddit-player');
    const ui = host && host.shadowRoot && host.shadowRoot.querySelector('shreddit-media-ui');
    const uiHidden = !!(ui && (ui.hasAttribute('data-wblock-pc-hidden') ||
      getComputedStyle(ui).display === 'none'));
    return { pass: uiHidden, detail: ui ? `hidden=${uiHidden}` : 'no ui' };
  });

  await check(page, S, 'touchend still does not toggle after fullscreen', () => {
    const host = document.querySelector('shreddit-player');
    const video = host && host.shadowRoot && host.shadowRoot.querySelector('video');
    if (!video) return { pass: false, detail: 'no video' };
    window.__redditToggleCount = 0;
    const paused = video.paused;
    video.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true, composed: true }));
    return {
      pass: window.__redditToggleCount === 0 && video.paused === paused,
      detail: `toggles=${window.__redditToggleCount} paused=${video.paused}`
    };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (bare/custom players)', {
    fixture: FIXTURE_PLAYER_BARE_URL,
    scriptSource: playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-bare';
  const ATTR = 'data-wblock-player-cleaner';

  // Case 1: modern wrapper not in the recognized library list, opaque source.
  await check(page, S, 'enhances bare video in unrecognized wrapper (controls on)', () => {
    const v = document.querySelector('#bare-enhance video');
    const ok = !!(v && v.controls === true && v.getAttribute('data-wblock-player-cleaner') === '1');
    return { pass: ok, detail: v ? `controls=${v.controls} attr=${v.getAttribute('data-wblock-player-cleaner')}` : 'no video' };
  });

  await check(page, S, 'marks the bare container done', () => {
    const c = document.getElementById('bare-enhance');
    const ok = !!(c && c.getAttribute('data-wblock-player-cleaner') === '1');
    return { pass: ok, detail: c ? `attr=${c.getAttribute('data-wblock-player-cleaner')}` : 'no container' };
  });

  await check(page, S, 'hides positioned custom chrome in bare wrapper', () => {
    const bar = document.querySelector('#bare-enhance .custom-bar');
    return { pass: !!(bar && bar.style.display === 'none'), detail: bar ? `display=${bar.style.display}` : 'no bar' };
  });

  await check(page, S, 'bare enhanced video keeps its (opaque) source', () => {
    const v = document.querySelector('#bare-enhance video');
    const ok = !!(v && (v.src || '').indexOf('blob:') === 0);
    return { pass: ok, detail: v ? `src=${v.src}` : 'no video' };
  });

  await check(page, S, 'bare enhanced controls SURVIVE player turning them off', () => {
    const v = document.querySelector('#bare-enhance video');
    const ok = !!(v && v.controls === true);
    return { pass: ok, detail: v ? `controls=${v.controls}` : 'no video' };
  });

  // Case 2: bare video with a clean source -> enhanced in place, source kept.
  await check(page, S, 'enhances bare clean-source video (controls on, src kept)', () => {
    const v = document.querySelector('#bare-clean video');
    const ok = !!(v && v.controls === true && v.getAttribute('data-wblock-player-cleaner') === '1' && v.src === 'https://example.com/media/movie.mp4');
    return { pass: ok, detail: v ? `controls=${v.controls} src=${v.src}` : 'no video' };
  });

  // Case 3: ambient (autoplay+muted+loop) must be untouched. Gated on the
  // positive case being processed so "untouched" proves the script ran & skipped.
  await check(page, S, 'leaves ambient autoplay-muted video untouched', () => {
    const ev = document.querySelector('#bare-enhance video');
    const ran = !!(ev && ev.getAttribute('data-wblock-player-cleaner') === '1');
    const v = document.querySelector('#bare-ambient video');
    const ok = !!(ran && v && v.controls === false && !v.hasAttribute('data-wblock-player-cleaner'));
    return { pass: ok, detail: `scriptRan=${ran} controls=${v && v.controls} attr=${v && v.getAttribute('data-wblock-player-cleaner')}` };
  });

  // Case 4: already-native video untouched (gated the same way).
  await check(page, S, 'enhances srcObject-only video without structural cleanup', () => {
    const v = document.querySelector('#bare-srcobject video');
    const c = document.getElementById('bare-srcobject');
    const ok = !!(v && v.controls === true && v.getAttribute('data-wblock-player-cleaner') === '1' &&
      v.srcObject && v.readyState === 4 && c && c.querySelector('video') === v);
    return { pass: ok, detail: v ? `controls=${v.controls} attr=${v.getAttribute('data-wblock-player-cleaner')} src=${v.src} readyState=${v.readyState}` : 'no video' };
  });

  // Case 5: already-native video untouched (gated the same way).
  await check(page, S, 'leaves already-native video untouched', () => {
    const ev = document.querySelector('#bare-enhance video');
    const ran = !!(ev && ev.getAttribute('data-wblock-player-cleaner') === '1');
    const v = document.getElementById('bare-native');
    const ok = !!(ran && v && v.controls === true && !v.hasAttribute('data-wblock-player-cleaner'));
    return { pass: ok, detail: `scriptRan=${ran} controls=${v && v.controls} attr=${v && v.getAttribute('data-wblock-player-cleaner')}` };
  });

  // Idempotency across the boot rescans + observer.
  await page.waitForTimeout(2600);
  await check(page, S, 'no duplicate videos after rescans (idempotent)', () => {
    const counts = ['#bare-enhance', '#bare-clean', '#bare-ambient'].map(id => document.querySelectorAll(id + ' video').length);
    const nativeCount = document.querySelectorAll('#bare-native').length;
    const ok = counts.every(n => n === 1) && nativeCount === 1;
    return { pass: ok, detail: `counts=${counts.join(',')} native=${nativeCount}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner Nat Geo iPhone passthrough -------------------
// Nat Geo uses Disney's BAM ManagedMediaSource player. Player Cleaner must not
// touch its media element on iOS before the site attaches the source.
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Nat Geo iPhone passthrough)', {
    device: iphone,
    hasTouch: true,
    fixture: FIXTURE_PLAYER_ESPN_URL,
    scriptSource: playerUserscript,
    readySignal: '#espn-active',
    gotoURL: 'https://www.nationalgeographic.com/tv/episode/fixture/playlist/fixture',
    responseBody: readFileSync(join(__dirname, 'fixture-player-cleaner-espn.html'), 'utf8'),
  });
  const S = 'player-cleaner-natgeo-iphone';

  await check(page, S, 'leaves the Nat Geo BAM player untouched on iOS', () => {
    const video = document.getElementById('espn-active');
    const shell = document.querySelector('.WebPlayerContainer');
    const pass = !!(video && shell && shell.contains(video) && video.src.startsWith('blob:') &&
      !video.hasAttribute('data-wblock-player-cleaner') && !video._wblockEnhanced &&
      !video.disableRemotePlayback && !video.hasAttribute('disableremoteplayback') &&
      video.getAttribute('x-webkit-airplay') === null);
    return { pass, detail: video ? `src=${video.src} enhanced=${!!video._wblockEnhanced} remote=${video.disableRemotePlayback} airplay=${video.getAttribute('x-webkit-airplay')}` : 'no video' };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner ESPN/BAM multi-video player ------------------
// ESPN puts a hidden source-less <video> before its active MSE element and
// renders pointer-action UI outside the active video's immediate parent. The
// cleaner must select the sourced video and clean the complete player shell.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (ESPN/BAM player)', {
    fixture: FIXTURE_PLAYER_ESPN_URL,
    scriptSource: playerUserscript,
    readySignal: '#espn-active[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-espn';

  await check(page, S, 'selects the active sourced video instead of the placeholder', () => {
    const active = document.getElementById('espn-active');
    const placeholder = document.getElementById('espn-placeholder');
    const pass = !!(active && active.controls && active.getAttribute('data-wblock-player-cleaner') === '1' &&
      placeholder && !placeholder.hasAttribute('data-wblock-player-cleaner'));
    return { pass, detail: `active=${active?.getAttribute('data-wblock-player-cleaner')} placeholder=${placeholder?.getAttribute('data-wblock-player-cleaner')}` };
  });

  await check(page, S, 'keeps the active ESPN MSE pipeline in place', () => {
    const video = document.getElementById('espn-active');
    const pass = !!(video && video.src.startsWith('blob:') && !video._wblockCleaned);
    return { pass, detail: video ? `src=${video.src} cleaned=${!!video._wblockCleaned}` : 'no video' };
  });

  await check(page, S, 'hides ESPN UI outside the media-element container', () => {
    const ui = document.querySelector('espn-web-player-ui');
    return { pass: !!(ui && ui.style.display === 'none'), detail: ui ? `display=${ui.style.display}` : 'no UI' };
  });

  await check(page, S, 'hides local pointer-action chrome', () => {
    const chrome = document.querySelector('.local-pointer-actions');
    return { pass: !!(chrome && chrome.style.display === 'none'), detail: chrome ? `display=${chrome.style.display}` : 'no chrome' };
  });

  await page.waitForTimeout(1000);
  await check(page, S, 'keeps controls after ESPN removes the attribute', () => {
    const video = document.getElementById('espn-active');
    return { pass: !!(video && video.controls && video.hasAttribute('controls')),
      detail: video ? `controls=${video.controls} attr=${video.hasAttribute('controls')}` : 'no video' };
  }, { timeout: 2500, interval: 200 });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner PBS/GPB leftover chrome ----------------------
// player.pbs.org keeps expand/kebab chrome beside a blob MSE <video>. Host-page
// overlay cleanup is gated to PBS/GPB hosts, so the sibling overlay in this
// file-URL fixture must stay visible.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (PBS/GPB player)', {
    fixture: FIXTURE_PLAYER_PBS_URL,
    scriptSource: playerUserscript,
    readySignal: '#pbs-video[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-pbs';

  await check(page, S, 'forces native controls on the PBS video', () => {
    const video = document.getElementById('pbs-video');
    return { pass: !!(video && video.controls && video.getAttribute('data-wblock-player-cleaner') === '1'),
      detail: video ? `controls=${video.controls} attr=${video.getAttribute('data-wblock-player-cleaner')}` : 'no video' };
  });

  await check(page, S, 'keeps the PBS blob pipeline in place', () => {
    const video = document.getElementById('pbs-video');
    const pass = !!(video && video.src.startsWith('blob:') && !video._wblockCleaned);
    return { pass, detail: video ? `src=${video.src} cleaned=${!!video._wblockCleaned}` : 'no video' };
  });

  await check(page, S, 'hides leftover PBS video.js chrome', () => {
    const ids = ['.vjs-control-bar', '.vjs-big-play-button', '.vjs-pbs-top-icons', '.vjs-pbs-more'];
    const hidden = ids.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return `${sel}=missing`;
      const style = getComputedStyle(el);
      const ok = style.display === 'none' || style.visibility === 'hidden';
      return ok ? null : `${sel}=${style.display}/${style.visibility}/marked=${el.getAttribute('data-wblock-pc-hidden')}`;
    }).filter(Boolean);
    return { pass: hidden.length === 0, detail: hidden.join(' ') || 'all hidden' };
  });

  await check(page, S, 'leaves the host-page PBS overlay visible off PBS/GPB page hosts', () => {
    const iframe = document.getElementById('pbs-iframe');
    const overlay = document.querySelector('[class*="video_player_overlay"]');
    if (!iframe || !overlay) return { pass: false, detail: 'missing iframe or overlay' };
    const src = iframe.getAttribute('src') || '';
    const style = getComputedStyle(overlay);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
      !overlay.hasAttribute('data-wblock-pc-hidden');
    const pass = src === 'https://player.pbs.org/viralplayer/fixture/' && visible;
    return { pass, detail: `host=${location.hostname} src=${src} display=${style.display} marked=${overlay.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'keeps More/Share inside a protected in-player PBS wrapper', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const wrap = document.getElementById('pbs-protected-wrap');
    const more = document.getElementById('pbs-protected-more');
    const share = document.getElementById('pbs-protected-share');
    const pass = !!(visible(wrap) && visible(more) && visible(share));
    return { pass, detail: `wrap=${wrap && getComputedStyle(wrap).display} more=${more && getComputedStyle(more).display} share=${share && getComputedStyle(share).display} marked=${more && more.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'keeps the site header, title, Passport, error, ad, and wrap copy', () => {
    const header = document.querySelector('header');
    const title = document.getElementById('pbs-title');
    const passport = document.querySelector('[class*="passport_benefit"]');
    const error = document.getElementById('pbs-error');
    const preroll = document.getElementById('pbs-preroll');
    const copy = document.getElementById('pbs-wrap-copy');
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const pass = !!(visible(header) && visible(title) && visible(passport) &&
      visible(error) && visible(preroll) && visible(copy));
    return { pass, detail: `header=${header && getComputedStyle(header).display} title=${title && getComputedStyle(title).display} passport=${passport && getComputedStyle(passport).display} error=${error && getComputedStyle(error).display} preroll=${preroll && getComputedStyle(preroll).display} copy=${copy && getComputedStyle(copy).display}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner PBS iPhone preserved MSE ---------------------
// iOS must leave the PBS blob pipeline and site controls in charge, while still
// collapsing the oversized mobile shell and removing PBS-only leftover chrome.
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (PBS iPhone preserved MSE)', {
    device: iphone,
    hasTouch: true,
    fixture: FIXTURE_PLAYER_PBS_URL,
    scriptSource: playerUserscript,
    readySignal: '#pbs-video',
  });
  const S = 'player-cleaner-pbs-iphone';

  await check(page, S, 'keeps the PBS blob pipeline and site controls on iOS', () => {
    const video = document.getElementById('pbs-video');
    const shell = document.getElementById('player-videojs');
    const pass = !!(video && shell && video.src.startsWith('blob:') && shell.contains(video) &&
      !video.controls && !video._wblockEnhanced && video.disableRemotePlayback &&
      video.getAttribute('x-webkit-airplay') === 'deny');
    return { pass, detail: video ? 'blob=' + video.src.startsWith('blob:') +
      ' controls=' + video.controls + ' enhanced=' + !!video._wblockEnhanced +
      ' airplay=' + video.getAttribute('x-webkit-airplay') : 'no video' };
  });

  await check(page, S, 'collapses the oversized PBS mobile shell to the video', () => {
    const video = document.getElementById('pbs-video');
    const shell = document.getElementById('player-videojs');
    if (!video || !shell) return { pass: false, detail: 'missing video or shell' };
    const vr = video.getBoundingClientRect();
    const sr = shell.getBoundingClientRect();
    const bottomGap = Math.abs(sr.bottom - vr.bottom);
    const pass = bottomGap <= 1 && Math.abs(sr.height - vr.height) <= 1 && sr.height < 300;
    return { pass, detail: `shell=${sr.width.toFixed(1)}x${sr.height.toFixed(1)} video=${vr.width.toFixed(1)}x${vr.height.toFixed(1)} gap=${bottomGap.toFixed(1)}` };
  });

  await page.evaluate(() => {
    window.__pbsPaused = false;
    window.__pbsTapToggles = 0;
  });
  await page.locator('#pbs-video').tap({ position: { x: 40, y: 40 }, force: true });
  await check(page, S, 'leaves both PBS touch events to the site', () => ({
    pass: !window.__pbsPaused && window.__pbsTapToggles === 2,
    detail: `paused=${window.__pbsPaused} toggles=${window.__pbsTapToggles}`,
  }));

  await check(page, S, 'hides initial and remounted PBS chrome on iOS', () => {
    const selectors = ['.vjs-control-bar', '.vjs-pbs-top-icons', '#pbs-late-more'];
    const visible = selectors.filter((selector) => {
      const el = document.querySelector(selector);
      if (!el) return true;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    return { pass: visible.length === 0, detail: visible.join(' ') || 'all hidden' };
  }, { timeout: 2500, interval: 100 });

  await check(page, S, 'keeps protected PBS error and preroll UI visible', () => {
    const ids = ['pbs-error', 'pbs-preroll', 'pbs-protected-wrap'];
    const hidden = ids.filter((id) => {
      const el = document.getElementById(id);
      if (!el) return true;
      const style = getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden' || !!el.closest('[data-wblock-pc-hidden]');
    });
    return { pass: hidden.length === 0, detail: hidden.join(' ') || 'all visible' };
  });

  await page.screenshot({ path: join(__dirname, 'artifacts', 'player-cleaner-pbs-iphone.png'), fullPage: true });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner PBS host iframe only -------------------------
// video.gpb.org has no <video>; hidePbsHostChrome must still match the absolute
// and protocol-relative player.pbs.org viralplayer URLs and ignore lookalike,
// relative, and malformed hosts. Host cleanup is gated to PBS/GPB page hosts.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (PBS host iframe)', {
    fixture: pathToFileURL(FIXTURE_PLAYER_PBS_HOST).href,
    gotoURL: 'https://video.gpb.org/video/fixture/',
    responseBody: readFileSync(FIXTURE_PLAYER_PBS_HOST, 'utf8'),
    scriptSource: playerUserscript,
    readySignal: '#pbs-real-overlay[data-wblock-pc-hidden]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-pbs-host';

  await check(page, S, 'hides the absolute https://player.pbs.org host overlay', () => {
    const style = document.getElementById('pbs-real-overlay') &&
      getComputedStyle(document.getElementById('pbs-real-overlay'));
    const real = document.getElementById('pbs-real-overlay');
    const iframe = document.getElementById('pbs-real-iframe');
    const hidden = !!(style && (style.display === 'none' || style.visibility === 'hidden'));
    const pass = hidden &&
      iframe && iframe.getAttribute('src') === 'https://player.pbs.org/viralplayer/fixture/';
    return { pass, detail: `host=${location.hostname} real=${style && style.display} marked=${real && real.getAttribute('data-wblock-pc-hidden')} src=${iframe && iframe.getAttribute('src')}` };
  });

  await check(page, S, 'hides the protocol-relative //player.pbs.org host overlay', () => {
    const overlay = document.getElementById('pbs-protocol-overlay');
    const iframe = document.getElementById('pbs-protocol-iframe');
    const style = overlay && getComputedStyle(overlay);
    const hidden = !!(style && (style.display === 'none' || style.visibility === 'hidden'));
    const pass = hidden &&
      iframe && iframe.getAttribute('src') === '//player.pbs.org/viralplayer/fixture/';
    return { pass, detail: `overlay=${style && style.display} marked=${overlay && overlay.getAttribute('data-wblock-pc-hidden')} src=${iframe && iframe.getAttribute('src')}` };
  });

  await check(page, S, 'leaves the path-relative /viralplayer overlay visible on video.gpb.org', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const overlay = document.getElementById('pbs-path-overlay');
    const iframe = document.getElementById('pbs-path-iframe');
    const pass = visible(overlay) &&
      iframe && iframe.getAttribute('src') === '/viralplayer/fixture/';
    return { pass, detail: `overlay=${overlay && getComputedStyle(overlay).display} src=${iframe && iframe.getAttribute('src')}` };
  });

  await check(page, S, 'leaves the suffix lookalike host overlay visible', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const fake = document.getElementById('pbs-lookalike-overlay');
    const lookalike = document.getElementById('pbs-lookalike-iframe');
    const pass = visible(fake) &&
      lookalike && lookalike.getAttribute('src') === 'https://player.pbs.org.evil.example/viralplayer/fixture/';
    return { pass, detail: `fake=${fake && getComputedStyle(fake).display} src=${lookalike && lookalike.getAttribute('src')}` };
  });

  await check(page, S, 'leaves the malformed prefixed player.pbs.org overlay visible', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const overlay = document.getElementById('pbs-malformed-overlay');
    const iframe = document.getElementById('pbs-malformed-iframe');
    const pass = visible(overlay) &&
      iframe && iframe.getAttribute('src') === 'https://%zz//player.pbs.org/viralplayer/fixture/';
    return { pass, detail: `overlay=${overlay && getComputedStyle(overlay).display} src=${iframe && iframe.getAttribute('src')}` };
  });

  await check(page, S, 'keeps a host overlay visible when protected Passport UI is nested inside', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const overlay = document.getElementById('pbs-protected-overlay');
    const passport = document.getElementById('pbs-overlay-passport');
    const more = document.getElementById('pbs-protected-more');
    const share = document.getElementById('pbs-protected-share');
    const pass = visible(overlay) && visible(passport) && visible(more) && visible(share);
    return { pass, detail: `overlay=${overlay && getComputedStyle(overlay).display} passport=${passport && getComputedStyle(passport).display} more=${more && getComputedStyle(more).display} share=${share && getComputedStyle(share).display} marked=${more && more.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'leaves the malformed player.pbs.org:evil.example port overlay visible', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const overlay = document.getElementById('pbs-badport-overlay');
    const iframe = document.getElementById('pbs-badport-iframe');
    const pass = visible(overlay) &&
      iframe && iframe.getAttribute('src') === 'https://player.pbs.org:evil.example/viralplayer/fixture/';
    return { pass, detail: `overlay=${overlay && getComputedStyle(overlay).display} src=${iframe && iframe.getAttribute('src')}` };
  });

  await check(page, S, 'does not mark host-only pages as player-cleaned', () => {
    const pass = !document.querySelector('[data-wblock-player-cleaner]');
    return { pass, detail: `cleaned=${!!document.querySelector('[data-wblock-player-cleaner]')}` };
  });

  await check(page, S, 'keeps the host header and page Passport screen', () => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    };
    const header = document.querySelector('header');
    const passport = document.querySelector('body > .PassportBenefitScreen-module__fake__passport_benefit');
    const pass = !!(visible(header) && visible(passport));
    return { pass, detail: `header=${header && getComputedStyle(header).display} passport=${passport && getComputedStyle(passport).display}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner third-party player.pbs.org embed --------------
// A generic site that only embeds player.pbs.org must not lose its overlay.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (third-party PBS embed)', {
    fixture: pathToFileURL(FIXTURE_PLAYER_PBS_HOST).href,
    gotoURL: 'https://www.example.com/videos/fixture/',
    responseBody: readFileSync(FIXTURE_PLAYER_PBS_HOST, 'utf8'),
    scriptSource: playerUserscript,
    readySignal: '#pbs-real-overlay',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-pbs-third-party';

  await check(page, S, 'leaves the player.pbs.org overlay visible on a third-party host', () => {
    const overlay = document.getElementById('pbs-real-overlay');
    const iframe = document.getElementById('pbs-real-iframe');
    if (!overlay || !iframe) return { pass: false, detail: 'missing overlay or iframe' };
    const style = getComputedStyle(overlay);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
      !overlay.hasAttribute('data-wblock-pc-hidden');
    const pass = location.hostname === 'www.example.com' &&
      iframe.getAttribute('src') === 'https://player.pbs.org/viralplayer/fixture/' && visible;
    return { pass, detail: `host=${location.hostname} display=${style.display} marked=${overlay.getAttribute('data-wblock-pc-hidden')}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner must not blank YouTube embed iframes ---------
// A recognized custom player that also hosts a YouTube embed must not hide
// that iframe or the wrapper around it. That is the blank-embed failure mode.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (YouTube embed)', {
    fixture: pathToFileURL(FIXTURE_PLAYER_YOUTUBE_EMBED).href,
    scriptSource: playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-youtube-embed';

  await check(page, S, 'leaves the YouTube embed iframe visible', () => {
    const iframe = document.getElementById('yt-embed');
    const wrap = document.getElementById('yt-embed-wrap');
    if (!iframe || !wrap) return { pass: false, detail: 'missing embed' };
    const iframeStyle = getComputedStyle(iframe);
    const wrapStyle = getComputedStyle(wrap);
    const hidden = iframe.hasAttribute('data-wblock-pc-hidden') ||
      wrap.hasAttribute('data-wblock-pc-hidden') ||
      iframeStyle.display === 'none' || wrapStyle.display === 'none';
    return { pass: !hidden, detail: `iframe=${iframeStyle.display} wrap=${wrapStyle.display} marked=${iframe.getAttribute('data-wblock-pc-hidden')}/${wrap.getAttribute('data-wblock-pc-hidden')}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner unknown player (generic chrome hiding) --------
// A player whose wrapper class is NOT in Player Cleaner's known-library list.
// The container has position:relative, so the generic chrome hider treats it
// as a player shell and aggressively hides all non-video chrome.  This proves
// the approach works for any site without hardcoded selectors.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (unknown player, generic chrome hiding)', {
    fixture: FIXTURE_PLAYER_ARTDECO_URL,
    scriptSource: playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-artdeco';

  await check(page, S, 'forces video.controls === true', () => {
    const v = document.querySelector('.xq7-player-shell video');
    return { pass: !!(v && v.controls === true), detail: v ? `controls=${v.controls}` : 'no video' };
  });

  await check(page, S, 'marks video and container done', () => {
    const v = document.querySelector('.xq7-player-shell video');
    const c = document.querySelector('.xq7-player-shell');
    const ok = !!(v && v.getAttribute('data-wblock-player-cleaner') === '1' &&
      c && c.getAttribute('data-wblock-player-cleaner') === '1');
    return { pass: ok, detail: `video=${v && v.getAttribute('data-wblock-player-cleaner')} container=${c && c.getAttribute('data-wblock-player-cleaner')}` };
  });

  await check(page, S, 'hides unknown controls wrapper', () => {
    const el = document.querySelector('.xq7-controls-wrap');
    return { pass: !!(el && el.style.display === 'none'), detail: el ? `display=${el.style.display}` : 'no element' };
  });

  await check(page, S, 'hides unknown overlay', () => {
    const el = document.querySelector('.xq7-overlay');
    return { pass: !!(el && el.style.display === 'none'), detail: el ? `display=${el.style.display}` : 'no element' };
  });

  await check(page, S, 'hides unknown controls bar', () => {
    const el = document.querySelector('.xq7-controls-bar');
    return { pass: !!(el && el.style.display === 'none'), detail: el ? `display=${el.style.display}` : 'no element' };
  });

  await check(page, S, 'video click does not bubble to the player shell (no double-toggle)', () => {
    const v = document.querySelector('.xq7-player-shell video');
    if (!v) return { pass: false, detail: 'no video' };
    const before = window.__shellToggleCount || 0;
    const r = v.getBoundingClientRect();
    v.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const after = window.__shellToggleCount || 0;
    return { pass: after === before, detail: `shell toggles before=${before} after=${after}` };
  });

  await page.waitForTimeout(4200);
  await check(page, S, 'native controls SURVIVE player turning them off', () => {
    const v = document.querySelector('.xq7-player-shell video');
    if (!v) return { pass: false, detail: 'no video' };
    const hasAttr = v.hasAttribute('controls');
    return { pass: hasAttr, detail: `hasAttribute('controls')=${hasAttr} (getter=${v.controls})` };
  }, { timeout: 1500, interval: 500 });

  await check(page, S, 'hides outer-shell bar nested outside the inner positioned wrapper', () => {
    const bars = document.querySelectorAll('#xq7-nested > .xq7-late-bar');
    if (!bars.length) return { pass: false, detail: 'no bar' };
    const hidden = Array.from(bars).every(b => b.style.display === 'none');
    return { pass: hidden, detail: `bars=${bars.length} displays=${Array.from(bars).map(b => b.style.display || 'visible').join(',')}` };
  });

  await check(page, S, 're-hides a control bar remounted after the one-shot hide', () => {
    const bars = document.querySelectorAll('#xq7-nested > .xq7-late-bar');
    const hidden = bars.length === 1 && bars[0].style.display === 'none';
    return { pass: hidden, detail: `bars=${bars.length} display=${bars[0] && (bars[0].style.display || 'visible')}` };
  });

  await check(page, S, 'nested video keeps native controls', () => {
    const v = document.querySelector('#xq7-nested video');
    return { pass: !!(v && v.controls === true), detail: v ? `controls=${v.controls}` : 'no video' };
  });

  await check(page, S, 'hides !important design-system control bar', () => {
    const el = document.getElementById('xq7-important');
    if (!el) return { pass: false, detail: 'no element' };
    const cs = getComputedStyle(el);
    const pass = cs.display === 'none' || el.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass, detail: `display=${cs.display} attr=${el.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'hides portal/fixed chrome remounted outside the shell', () => {
    const el = document.getElementById('xq7-portal-bar');
    if (!el) return { pass: false, detail: 'no portal bar' };
    const cs = getComputedStyle(el);
    const pass = cs.display === 'none' || el.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass, detail: `display=${cs.display} attr=${el.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'hides static full-bleed cover sibling (LinkedIn end-card)', () => {
    const el = document.getElementById('xq7-static-cover');
    if (!el) return { pass: false, detail: 'no cover' };
    const cs = getComputedStyle(el);
    const pass = cs.display === 'none' || el.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass, detail: `display=${cs.display} attr=${el.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'static-cover video keeps native controls reachable', () => {
    const v = document.getElementById('xq7-cover-video');
    const cover = document.getElementById('xq7-static-cover');
    if (!v) return { pass: false, detail: 'no video' };
    const coverHidden = !cover || getComputedStyle(cover).display === 'none' ||
      cover.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass: !!(v.controls && coverHidden), detail: `controls=${v.controls} coverHidden=${coverHidden}` };
  });

  await check(page, S, 'hides static control bar sibling (LinkedIn controls)', () => {
    const el = document.getElementById('xq7-static-bar');
    if (!el) return { pass: false, detail: 'no bar' };
    const cs = getComputedStyle(el);
    const pass = cs.display === 'none' || el.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass, detail: `display=${cs.display} attr=${el.getAttribute('data-wblock-pc-hidden')}` };
  });

  await check(page, S, 'control-bar video keeps native controls reachable', () => {
    const v = document.getElementById('xq7-bar-video');
    const bar = document.getElementById('xq7-static-bar');
    if (!v) return { pass: false, detail: 'no video' };
    const barHidden = !bar || getComputedStyle(bar).display === 'none' ||
      bar.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass: !!(v.controls && barHidden), detail: `controls=${v.controls} barHidden=${barHidden}` };
  });

  await page.evaluate(() => {
    const video = document.getElementById('xq7-bar-video');
    const shell = video.closest('[class],div') || video.parentElement;
    const overlay = document.createElement('div');
    overlay.id = 'xq7-hover-chrome';
    overlay.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:36px;background:red;z-index:9';
    (shell || document.body).appendChild(overlay);
    video.dispatchEvent(new Event('mousemove'));
  });
  await page.waitForTimeout(50);
  await check(page, S, 're-hides leftover overlay chrome on hover', () => {
    const el = document.getElementById('xq7-hover-chrome');
    if (!el) return { pass: false, detail: 'no hover chrome' };
    const cs = getComputedStyle(el);
    const pass = cs.display === 'none' || el.getAttribute('data-wblock-pc-hidden') === '1';
    return { pass, detail: `display=${cs.display} attr=${el.getAttribute('data-wblock-pc-hidden')}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (source-less API hints)', {
    fixture: FIXTURE_PLAYER_RELATIVE_URL,
    scriptSource: playerUserscript,
    readySignal: '#rel-jw',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-source-less-hints';

  await page.waitForTimeout(100);
  await check(page, S, 'does not apply API/data URLs before the media element has a source', () => {
    const ids = ['rel-jw', 'rel-dom'];
    const bad = ids.filter((id) => {
      const v = document.querySelector(`#${id} video`);
      return !v || v.currentSrc || v.getAttribute('src') || v._wblockCleaned;
    });
    return { pass: bad.length === 0, detail: bad.length ? `bad: ${bad.join(',')}` : '2/2 source-less' };
  });

  await check(page, S, 'preserves source-less player setup DOM', () => {
    const ids = ['rel-jw', 'rel-dom'];
    const bad = ids.filter((id) => !document.querySelector(`#${id} .setup-sentinel`));
    return { pass: bad.length === 0, detail: bad.length ? `missing: ${bad.join(',')}` : '2/2 preserved' };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 8: Player Cleaner upgrade on loadedmetadata ----------------
// A Plyr-style player exposes only an opaque blob: src at first scan, so Player
// Cleaner can only enhance it in place. A blob: src that fires loadedmetadata
// is a live MediaSource / MSE pipeline — the cleaner must NOT upgrade it even
// if a mock player API later offers a direct URL. The pipeline is the page's
// primary source, and enhanceInPlace already gave native controls + hidden chrome.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (upgrade on loadedmetadata)', {
    fixture: FIXTURE_PLAYER_UPGRADE_URL,
    scriptSource: playerUserscript,
    readySignal: '#player-upgrade[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-upgrade';

  // First scan: opaque source -> enhanced in place, NOT replaced.
  await check(page, S, 'enhances (does not replace) the opaque video at first scan', () => {
    const v = document.querySelector('#player-upgrade video');
    if (!v) return { pass: false, detail: 'no video' };
    const enhanced = v.controls === true && v.hasAttribute('data-wblock-player-cleaner');
    const notReplaced = v.src.startsWith('blob:');
    return { pass: enhanced && notReplaced, detail: `controls=${v.controls} src=${v.src}` };
  });

  // Tag the original element, then wait until all boot recovery events have
  // passed before exposing a clean source only through the mocked player API.
  await page.waitForLoadState('load');
  await page.evaluate(() => {
    document.querySelector('#player-upgrade video').setAttribute('data-test-original', '1');
    window.jwplayer = function (id) {
      if (id !== 'player-upgrade') return null;
      return { getPlaylistItem: function () {
        return { file: 'https://example.com/media/movie.mp4' };
      } };
    };
  });
  await page.waitForTimeout(700);
  await check(page, S, 'API availability alone does not require polling', () => {
    const c = document.getElementById('player-upgrade');
    const v = c && c.querySelector('video');
    const custom = c && c.querySelector('.plyr__controls');
    return { pass: !!(v && v.src.startsWith('blob:') && custom),
      detail: v ? `src=${v.src} custom=${!!custom}` : 'no video' };
  });

  // Fire loadedmetadata -> a live MSE pipeline; the cleaner must NOT upgrade.
  await page.evaluate(() => {
    const v = document.querySelector('#player-upgrade video');
    v.dispatchEvent(new Event('loadedmetadata', { bubbles: false }));
  });

  await check(page, S, 'keeps the blob pipeline on loadedmetadata (no upgrade)', () => {
    const c = document.getElementById('player-upgrade');
    const v = c ? c.querySelector('video') : null;
    if (!v) return { pass: false, detail: 'no video' };
    const retained = v.hasAttribute('data-test-original');
    const blobKept = v.src.startsWith('blob:');
    return { pass: retained && blobKept, detail: `retained=${retained} src=${v.src}` };
  });

  await check(page, S, 'enhanced video has native controls + retained poster', () => {
    const v = document.querySelector('#player-upgrade video');
    const ok = !!(v && v.controls === true && v.getAttribute('poster') === 'https://example.com/poster.jpg');
    return { pass: ok, detail: v ? `controls=${v.controls} poster=${v.getAttribute('poster')}` : 'no video' };
  });

  await check(page, S, 'custom control chrome is hidden (not removed)', () => {
    const c = document.getElementById('player-upgrade');
    const bar = c ? c.querySelector('.plyr__controls') : null;
    const hidden = bar && getComputedStyle(bar).display === 'none';
    return { pass: hidden, detail: `plyr__controls present=${!!bar}${bar ? ' display=' + getComputedStyle(bar).display : ''}` };
  });

  await check(page, S, 'exactly one video after upgrade (idempotent)', () => {
    const c = document.getElementById('player-upgrade');
    const n = c ? c.querySelectorAll('video').length : 0;
    return { pass: n === 1, detail: `${n} video(s)` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 9: Player Cleaner transforms before DOMContentLoaded -------
// The player is created by a <head> script. A true document-start cleaner must
// observe and nativeize it at the mutation microtask checkpoint, before the
// parser reaches DOMContentLoaded and without a timer/debounce.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (pre-paint timing)', {
    fixture: FIXTURE_PLAYER_EARLY_URL,
    scriptSource: playerUserscript,
    readySignal: '#early-player[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-timing';

  await check(page, S, 'nativeizes before DOMContentLoaded', () => {
    const t = window.__wblockEarlyPlayerTiming;
    const pass = !!(t && t.nativeAt > 0 && t.domContentLoadedAt > 0 && t.nativeAt <= t.domContentLoadedAt);
    return { pass, detail: t ? `native=${t.nativeAt.toFixed(1)}ms dcl=${t.domContentLoadedAt.toFixed(1)}ms` : 'no timing' };
  });

  await check(page, S, 'nativeizes within one frame of insertion', () => {
    const t = window.__wblockEarlyPlayerTiming;
    const elapsed = t && t.nativeAt ? t.nativeAt - t.createdAt : Infinity;
    return { pass: elapsed >= 0 && elapsed < 50, detail: `latency=${Number.isFinite(elapsed) ? elapsed.toFixed(1) : 'n/a'}ms` };
  });

  await check(page, S, 'shows native controls with custom chrome removed', () => {
    const c = document.getElementById('early-player');
    const v = c && c.querySelector('video');
    const custom = c && c.querySelector('.vjs-control-bar');
    return { pass: !!(v && v.controls && !custom), detail: `controls=${!!(v && v.controls)} custom=${!!custom}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 10: Player Cleaner resource lifecycle ---------------------
// SPA/custom players replace their <video> nodes. Per-video listeners and
// observers must be released rather than accumulating for the page lifetime.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (resource lifecycle)', {
    fixture: FIXTURE_PLAYER_URL,
    scriptSource: resourceCounterPatch + '\n' + playerUserscript,
    readySignal: '[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-resources';
  await page.waitForTimeout(300);
  const baseline = await page.evaluate(() => ({ ...window.__wblockResourceCounters }));

  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const container = document.querySelector('.video-js');
      const oldVideo = container.querySelector('video');
      const video = document.createElement('video');
      video.src = 'blob:https://example.com/00000000-0000-0000-0000-000000000000';
      oldVideo.replaceWith(video);
    });
    await page.waitForTimeout(80);
  }
  const after = await page.evaluate(() => ({ ...window.__wblockResourceCounters }));
  for (const key of ['listeners', 'intervals', 'mutationObservers', 'intersectionObservers']) {
    record(S, `${key} stay flat across video swaps`, after[key] === baseline[key],
      `baseline=${baseline[key]} after=${after[key]}`);
  }
  await check(page, S, 'replacement video remains native', () => {
    const v = document.querySelector('.video-js video');
    return { pass: !!(v && v.controls && v.hasAttribute('controls')) };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 11: native visibility survives document shadowing ---------
// Both cleaners override document.hidden/visibilityState so page players keep
// running. Auto-PiP must still read the original prototype getters when the tab
// really hides, not its own forced-visible document properties.
for (const config of [
  { name: 'Tube Cleaner', key: 'tube-cleaner-visibility', fixture: FIXTURE_URL,
    source: visibilityPrelude + '\n' + userscript, selector: '#movie_player video', ready: '.wblock-tc-toolbar' },
  { name: 'Player Cleaner', key: 'player-cleaner-visibility', fixture: FIXTURE_PLAYER_URL,
    source: visibilityPrelude + '\n' + playerUserscript, selector: '.video-js video', ready: '[data-wblock-player-cleaner]' },
]) {
  const { browser, page, pageErrors } = await runScenario(`${config.name} (native visibility)`, {
    fixture: config.fixture,
    scriptSource: config.source,
    readySignal: config.ready,
    viewport: { width: 1280, height: 800 },
  });
  await page.evaluate((selector) => {
    const video = document.querySelector(selector);
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
    video.webkitSupportsPresentationMode = function (mode) {
      return mode === 'picture-in-picture';
    };
    video.webkitPresentationMode = 'inline';
    video.webkitSetPresentationMode = function (mode) {
      this.webkitPresentationMode = mode;
      window.__wblockPiPMode = mode;
    };
    window.__wblockPiPMode = 'inline';
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => false,
    });
    window.dispatchEvent(new Event('blur'));
  }, config.selector);
  await page.waitForTimeout(200);
  await check(page, config.key, 'does not enter PiP merely because the window loses focus', () => ({
    pass: window.__wblockPiPMode === 'inline',
    detail: `pip=${window.__wblockPiPMode}`,
  }));
  await page.evaluate(() => {
    window.__wblockNativeHidden = true;
    window.__wblockNativeVisibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await check(page, config.key, 'enters PiP from native hidden state while page sees visible', () => ({
    pass: document.hidden === false && document.visibilityState === 'visible' &&
      window.__wblockPiPMode === 'picture-in-picture',
    detail: `pageHidden=${document.hidden} pageState=${document.visibilityState} pip=${window.__wblockPiPMode}`,
  }));
  if (config.name === 'Tube Cleaner') {
    await page.evaluate((selector) => {
      const video = document.querySelector(selector);
      // End the cleaner-owned PiP session, then model the user entering PiP
      // manually from Safari's native controls.
      video.webkitPresentationMode = 'inline';
      video.dispatchEvent(new Event('webkitpresentationmodechanged'));
      video.webkitPresentationMode = 'picture-in-picture';
      video.dispatchEvent(new Event('webkitpresentationmodechanged'));
      window.__wblockPiPMode = 'picture-in-picture';
      window.__wblockNativeHidden = false;
      window.__wblockNativeVisibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    }, config.selector);
    await check(page, config.key, 'does not close PiP entered manually by the user', () => ({
      pass: window.__wblockPiPMode === 'picture-in-picture',
      detail: `pip=${window.__wblockPiPMode}`,
    }));
  }
  if (config.name === 'Tube Cleaner') {
    await page.evaluate((selector) => {
      const video = document.querySelector(selector);
      window.__wblockPausedOnHide = false;
      window.__wblockPageVisibilityHandlerRan = false;
      video.pause = function () { window.__wblockPausedOnHide = true; };
      document.addEventListener('visibilitychange', function pageVisibilityHandler() {
        window.__wblockPageVisibilityHandlerRan = true;
        video.pause();
      }, { once: true });
      window.__wblockNativeHidden = true;
      window.__wblockNativeVisibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    }, config.selector);
    await check(page, config.key, 'keeps page pause handlers out of hidden and pagehide transitions', () => ({
      pass: window.__wblockPausedOnHide === false && window.__wblockPageVisibilityHandlerRan === false &&
        document.hidden === false && document.visibilityState === 'visible' &&
        document.webkitHidden === false && document.webkitVisibilityState === 'visible',
      detail: `paused=${window.__wblockPausedOnHide} pageHandler=${window.__wblockPageVisibilityHandlerRan} hidden=${document.hidden} webkitHidden=${document.webkitHidden}`,
    }));
  } else {
    await page.evaluate((selector) => {
      const video = document.querySelector(selector);
      window.__wblockPausedOnHide = false;
      video.pause = function () { window.__wblockPausedOnHide = true; };
      window.dispatchEvent(new Event('pagehide'));
    }, config.selector);
    await check(page, config.key, 'pauses the video when the tab is closing', () => ({
      pass: window.__wblockPausedOnHide === true,
      detail: `paused=${window.__wblockPausedOnHide}`,
    }));
  }
  record(config.key, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: YouTube Music keeps its own player -----------------------
// YTM already supplies a complete responsive player and Media Session. Tube
// Cleaner should retain only the document-start background-playback guard, or
// WebKit controls create a second transport directly above YTM's controls.
{
  const musicFixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
    <style>
      body { margin: 0; background: #030303; color: white; }
      #movie_player { position: relative; width: 390px; height: 219px; }
      video { width: 100%; height: 100%; }
      #player-page { display: block; padding: 16px; }
    </style></head><body>
    <div id="movie_player" class="html5-video-player ytp-hide-controls">
      <div class="html5-video-container"><video playsinline></video></div>
    </div>
    <ytmusic-player-page id="player-page">
      <button id="ytmusic-play">Play</button>
      <button id="ytmusic-settings">Settings</button>
    </ytmusic-player-page>
    <script>
      const player = document.getElementById('movie_player');
      player.getAvailableQualityLevels = () => ['hd1080', 'hd720', 'medium'];
      player.getPlaybackQuality = () => 'medium';
      player.setPlaybackQualityRange = () => {};
      player.getVideoData = () => ({ video_id: 'dQw4w9WgXcQ', title: 'YTM-owned title', author: 'YTM-owned artist' });
    <\/script></body></html>`;
  const musicOwnedSession = `
    // WebKit's YouTube-specific caption bridge queries this API as soon as the
    // synthetic #movie_player appears. Real YTM supplies it on the player.
    HTMLElement.prototype.getOption = function () { return []; };
    HTMLElement.prototype.isSubtitlesOn = function () { return false; };
    HTMLElement.prototype.setOption = function () {};
    HTMLElement.prototype.loadModule = function () {};
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'YTM-owned title', artist: 'YTM-owned artist', album: 'YTM-owned album'
    });
    navigator.mediaSession.playbackState = 'playing';
  `;
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (YouTube Music light integration)', {
    gotoURL: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    responseBody: musicFixture,
    readySignal: '#player-page',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    scriptSource: visibilityPrelude + '\n' + mediaSessionPrelude + '\n' + musicOwnedSession + '\n' + userscript,
  });
  const S = 'tube-cleaner-youtube-music';
  await page.waitForTimeout(200);

  await check(page, S, 'leaves YouTube Music as the only player surface', () => {
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    const transport = document.getElementById('player-page');
    return {
      pass: !!(player && video && transport && !video.controls &&
        !player.classList.contains('wblock-tc-native') &&
        !player.hasAttribute('data-wblock-tc-cleaned') &&
        !document.querySelector('.wblock-tc-toolbar') &&
        !document.getElementById('wblock-tc-style') &&
        getComputedStyle(transport).display !== 'none'),
      detail: `native=${!!player?.classList.contains('wblock-tc-native')} controls=${!!video?.controls} toolbar=${!!document.querySelector('.wblock-tc-toolbar')} stock=${getComputedStyle(transport).display}`,
    };
  });

  await check(page, S, 'preserves YouTube Music Now Playing metadata', () => {
    const metadata = navigator.mediaSession.metadata;
    return {
      pass: metadata?.title === 'YTM-owned title' && metadata?.artist === 'YTM-owned artist' &&
        metadata?.album === 'YTM-owned album' && navigator.mediaSession.playbackState === 'playing',
      detail: `title=${metadata?.title} artist=${metadata?.artist} state=${navigator.mediaSession.playbackState}`,
    };
  });

  await page.evaluate(() => {
    const video = document.querySelector('#movie_player video');
    window.__wblockMusicPauseAttempted = false;
    video.pause = function () { window.__wblockMusicPauseAttempted = true; };
    document.addEventListener('visibilitychange', function () { video.pause(); }, { once: true });
    window.__wblockNativeHidden = true;
    window.__wblockNativeVisibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await check(page, S, 'keeps YouTube Music playing through screen and app switches', () => ({
    pass: window.__wblockMusicPauseAttempted === false && document.hidden === false &&
      document.visibilityState === 'visible' && document.webkitHidden === false &&
      document.webkitVisibilityState === 'visible',
    detail: `paused=${window.__wblockMusicPauseAttempted} hidden=${document.hidden} webkitHidden=${document.webkitHidden}`,
  }));

  await page.screenshot({ path: join(__dirname, 'artifacts', 'tube-cleaner-youtube-music.png'), fullPage: true });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: YouTube Music owns only the missing capabilities ---------
// The fixture mirrors the live player API observed on music.youtube.com: one
// persistent <video>, getPresentingPlayerType() 2 plus the ad-showing class
// during an ad break, ytcfg AUDIO_QUALITY as the audio rendition selector,
// and the Playback settings menu's MUSIC_WEB_AUDIO_QUALITY listbox.
{
  const musicFixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
    <script>
      window.__cfg = { AUDIO_QUALITY: 'AUDIO_QUALITY_MEDIUM' };
      window.ytcfg = { get: k => window.__cfg[k], set: function (k, v) { if (typeof k === 'object') Object.assign(window.__cfg, k); else window.__cfg[k] = v; } };
    <\/script>
    <style>
      body { margin: 0; background: #030303; color: white; }
      #movie_player { position: relative; width: 390px; height: 219px; }
      video { width: 100%; height: 100%; }
      ytmusic-player-bar { display: block; padding: 8px; }
    </style></head><body>
    <div id="movie_player" class="html5-video-player ytp-hide-controls ad-created ad-showing ad-interrupting playing-mode">
      <div class="html5-video-container"><video playsinline></video></div>
    </div>
    <ytmusic-player-bar slot="player-bar" role="toolbar">
      <div class="thumbnail-image-wrapper"><img class="image style-scope ytmusic-player-bar" src="https://yt3.googleusercontent.com/art=w60-h60-l90-rj"></div>
      <yt-formatted-string class="title style-scope ytmusic-player-bar">Break My Stride</yt-formatted-string>
      <yt-formatted-string class="byline style-scope ytmusic-player-bar complex-string"><a href="channel/UC1">Matthew Wilder</a> • <a href="browse/MPREb_1">I Don't Speak The Language</a> • <span>1983</span></yt-formatted-string>
    </ytmusic-player-bar>
    <div id="settings">
      <ytmusic-setting-single-option-menu-renderer id="aq">
        <tp-yt-paper-listbox>
          <tp-yt-paper-item id="aq-normal">Normal</tp-yt-paper-item>
          <tp-yt-paper-item id="aq-low">Low</tp-yt-paper-item>
        </tp-yt-paper-listbox>
      </ytmusic-setting-single-option-menu-renderer>
    </div>
    <script>
      const player = document.getElementById('movie_player');
      const video = player.querySelector('video');
      const state = window.__ytm = { presenting: 2, calls: [], track: { video_id: 'UhLDA4Wr2GU', title: 'Break My Stride', author: 'Matthew Wilder' }, album: "I Don't Speak The Language" };
      // Ad media: the same element carries the ad clip while the ad player presents.
      let duration = 30.061, currentTime = 1.2, paused = false, ended = false;
      Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
      Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
      Object.defineProperty(video, 'ended', { configurable: true, get: () => ended });
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => currentTime, set: v => {
        state.calls.push(['seek', v, state.presenting]);
        if (state.presenting === 2 && v >= duration) {
          // The ad player finishes its media and hands back to content at 0.
          state.presenting = 1; duration = 184; currentTime = 0;
          player.classList.remove('ad-showing', 'ad-interrupting');
          video.dispatchEvent(new Event('durationchange'));
          video.dispatchEvent(new Event('playing'));
        } else { currentTime = v; }
      }});
      video.play = () => { paused = false; video.dispatchEvent(new Event('play')); return Promise.resolve(); };
      video.pause = () => { paused = true; video.dispatchEvent(new Event('pause')); };
      player.getPresentingPlayerType = () => state.presenting;
      player.getVideoData = () => state.track;
      player.getPlayerResponse = () => ({ videoDetails: { videoId: state.track.video_id, title: state.track.title, author: state.track.author,
        thumbnail: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/art=w60-h60-l90-rj', width: 60, height: 60 }, { url: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj', width: 544, height: 544 }] } } });
      player.getCurrentTime = () => currentTime;
      player.playVideo = () => { state.calls.push(['playVideo']); video.play(); };
      player.pauseVideo = () => { state.calls.push(['pauseVideo']); video.pause(); };
      player.seekTo = t => { state.calls.push(['seekTo', t]); currentTime = t; };
      player.nextVideo = () => { state.calls.push(['nextVideo']); };
      player.previousVideo = () => { state.calls.push(['previousVideo']); };
      player.getOption = () => []; player.isSubtitlesOn = () => false; player.setOption = () => {}; player.loadModule = () => {};
      window.__ytmTick = () => { if (!paused && state.presenting === 1) currentTime += 1; video.dispatchEvent(new Event('timeupdate')); };
      window.__ytmNextTrack = () => {
        state.track = { video_id: 'lYBUbBu4W08', title: 'Second Song', author: 'Second Artist' };
        state.album = 'Second Album';
        document.querySelector('ytmusic-player-bar .title').textContent = 'Second Song';
        currentTime = 0; duration = 201;
        video.dispatchEvent(new Event('durationchange'));
        video.dispatchEvent(new Event('loadedmetadata'));
        document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      };
      const menu = document.getElementById('aq');
      menu.data = { itemId: 'MUSIC_WEB_AUDIO_QUALITY', items: [
        { settingMenuItemRenderer: { name: 'Normal', value: '2', updateServiceEndpoint: { setSettingEndpoint: { settingItemId: '304', intValue: '2', settingItemIdForClient: 'MUSIC_WEB_AUDIO_QUALITY' } } } },
        { settingMenuItemRenderer: { name: 'Low', value: '1', updateServiceEndpoint: { setSettingEndpoint: { settingItemId: '304', intValue: '1', settingItemIdForClient: 'MUSIC_WEB_AUDIO_QUALITY' } } } }
      ] };
      menu.selected = 0;
      // Polymer updates selected from the listbox after the click bubbles.
      menu.addEventListener('click', e => { const item = e.target.closest('tp-yt-paper-item'); if (item) menu.selected = item.id === 'aq-low' ? 1 : 0; });
    <\/script></body></html>`;
  const musicPrelude = `
    HTMLElement.prototype.getOption = function () { return []; };
    HTMLElement.prototype.isSubtitlesOn = function () { return false; };
    HTMLElement.prototype.setOption = function () {};
    HTMLElement.prototype.loadModule = function () {};
    try { localStorage.setItem('wblock.tubeCleaner.musicAudioQuality', 'AUDIO_QUALITY_LOW'); } catch (e) {}
  `;
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (YouTube Music ads, audio quality, Now Playing)', {
    gotoURL: 'https://music.youtube.com/watch?v=UhLDA4Wr2GU',
    responseBody: musicFixture,
    readySignal: 'ytmusic-player-bar',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    scriptSource: visibilityPrelude + '\n' + mediaSessionPrelude + '\n' + musicPrelude + '\n' + userscript,
  });
  const S = 'tube-cleaner-youtube-music-capabilities';

  await check(page, S, 'ends the presenting ad through its own media without touching content time', () => {
    const seeks = window.__ytm.calls.filter(c => c[0] === 'seek');
    const contentSeeks = seeks.filter(c => c[2] !== 2);
    return {
      pass: window.__ytm.presenting === 1 && seeks.length === 1 && seeks[0][1] >= 30 && contentSeeks.length === 0 &&
        !document.getElementById('movie_player').classList.contains('ad-showing') &&
        document.querySelector('#movie_player video').currentTime === 0,
      detail: `presenting=${window.__ytm.presenting} seeks=${JSON.stringify(seeks)} ct=${document.querySelector('#movie_player video').currentTime}`,
    };
  });

  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__ytmTick(); });
  await check(page, S, 'never seeks content playback after the ad', () => {
    const seeks = window.__ytm.calls.filter(c => c[0] === 'seek');
    return { pass: seeks.length === 1 && document.querySelector('#movie_player video').currentTime === 5,
      detail: `seeks=${seeks.length} ct=${document.querySelector('#movie_player video').currentTime}` };
  });

  await check(page, S, 'restores the stored audio quality into ytcfg before playback', () => ({
    pass: window.ytcfg.get('AUDIO_QUALITY') === 'AUDIO_QUALITY_LOW',
    detail: `AUDIO_QUALITY=${window.ytcfg.get('AUDIO_QUALITY')}`,
  }));

  await page.click('#aq-normal');
  await check(page, S, 'remembers a stock Audio quality pick and applies it client-side', () => ({
    pass: window.ytcfg.get('AUDIO_QUALITY') === 'AUDIO_QUALITY_MEDIUM' &&
      localStorage.getItem('wblock.tubeCleaner.musicAudioQuality') === 'AUDIO_QUALITY_MEDIUM',
    detail: `cfg=${window.ytcfg.get('AUDIO_QUALITY')} stored=${localStorage.getItem('wblock.tubeCleaner.musicAudioQuality')}`,
  }));
  await page.click('#aq-low');
  await check(page, S, 'follows a second pick back to Low', () => ({
    pass: window.ytcfg.get('AUDIO_QUALITY') === 'AUDIO_QUALITY_LOW' &&
      localStorage.getItem('wblock.tubeCleaner.musicAudioQuality') === 'AUDIO_QUALITY_LOW',
    detail: `cfg=${window.ytcfg.get('AUDIO_QUALITY')}`,
  }));

  await check(page, S, 'publishes Now Playing from player data when the site has not', () => {
    const m = navigator.mediaSession.metadata;
    const art = m && m.artwork || [];
    return {
      pass: !!m && m.title === 'Break My Stride' && m.artist === 'Matthew Wilder' && m.album === "I Don't Speak The Language" &&
        art.length === 2 && /w544-h544/.test(art[1].src) && navigator.mediaSession.playbackState === 'playing' &&
        window.__wblockMediaSessionState.positions.length > 0,
      detail: `title=${m && m.title} album=${m && m.album} art=${art.length} state=${navigator.mediaSession.playbackState} positions=${window.__wblockMediaSessionState.positions.length}`,
    };
  });

  await check(page, S, 'keeps stock lock-screen semantics through the player API', () => {
    const h = window.__wblockMediaSessionState.handlers;
    const before = window.__ytm.calls.length;
    h.pause(); h.nexttrack(); h.previoustrack(); h.play();
    const names = window.__ytm.calls.slice(before).map(c => c[0]);
    return { pass: JSON.stringify(names) === JSON.stringify(['pauseVideo', 'nextVideo', 'previousVideo', 'playVideo']), detail: names.join(',') };
  });

  await page.evaluate(() => { window.__wblockMediaSessionState.handlers.pause(); });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await check(page, S, 'leaves an intentional pause paused', () => ({
    pass: document.querySelector('#movie_player video').paused === true && navigator.mediaSession.playbackState === 'paused' &&
      window.__ytm.calls.filter(c => c[0] === 'playVideo').length === 1,
    detail: `paused=${document.querySelector('#movie_player video').paused} state=${navigator.mediaSession.playbackState}`,
  }));
  await page.evaluate(() => { window.__wblockMediaSessionState.handlers.play(); });

  await page.evaluate(() => window.__ytmNextTrack());
  await check(page, S, 'updates Now Playing on a track change in the same video element', () => {
    const m = navigator.mediaSession.metadata;
    return { pass: !!m && m.title === 'Second Song' && m.artist === 'Second Artist', detail: `title=${m && m.title} artist=${m && m.artist}` };
  });

  await page.evaluate(() => {
    // The site publishes its own metadata for the current track: Tube Cleaner must stand down.
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Second Song', artist: 'Site Artist', album: 'Site Album' });
    window.__wblockMediaSessionState.positions.length = 0;
    for (let i = 0; i < 3; i++) window.__ytmTick();
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 700)));
  await check(page, S, 'defers to metadata the site publishes itself', () => {
    const m = navigator.mediaSession.metadata;
    return { pass: !!m && m.artist === 'Site Artist' && window.__wblockMediaSessionState.positions.length === 0,
      detail: `artist=${m && m.artist} positions=${window.__wblockMediaSessionState.positions.length}` };
  });

  await page.evaluate(() => {
    // Player replacement: YTM tears down #movie_player and inserts a new one with a fresh <video>.
    const old = document.getElementById('movie_player');
    const fresh = old.cloneNode(false);
    fresh.className = 'html5-video-player ytp-hide-controls playing-mode';
    fresh.innerHTML = '<div class="html5-video-container"><video playsinline></video></div>';
    const v = fresh.querySelector('video');
    Object.defineProperty(v, 'duration', { configurable: true, get: () => 150 });
    Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => 3, set: () => {} });
    fresh.getPresentingPlayerType = () => 1;
    fresh.getVideoData = () => ({ video_id: 'QAo_Ycocl1E', title: 'Replaced Player Song', author: 'Third Artist' });
    fresh.getPlayerResponse = () => ({ videoDetails: { thumbnail: { thumbnails: [] } } });
    fresh.getCurrentTime = () => 3;
    fresh.playVideo = () => { window.__ytm.calls.push(['fresh.playVideo']); };
    fresh.pauseVideo = () => {};
    fresh.getOption = () => []; fresh.isSubtitlesOn = () => false; fresh.setOption = () => {}; fresh.loadModule = () => {};
    navigator.mediaSession.metadata = null;
    old.replaceWith(fresh);
    v.dispatchEvent(new Event('loadedmetadata'));
  });
  await check(page, S, 'rebinds to a replaced player and republishes missing metadata', () => {
    const m = navigator.mediaSession.metadata;
    const art = m && m.artwork || [];
    window.__wblockMediaSessionState.handlers.play();
    return { pass: !!m && m.title === 'Replaced Player Song' && art.length === 1 && /art=w60/.test(art[0].src) &&
      window.__ytm.calls.some(c => c[0] === 'fresh.playVideo') &&
      !document.querySelector('.wblock-tc-native, .wblock-tc-toolbar') && !document.querySelector('#movie_player video').controls,
      detail: `title=${m && m.title} art=${art.length} fresh=${window.__ytm.calls.some(c => c[0] === 'fresh.playVideo')}` };
  });

  await page.screenshot({ path: join(__dirname, 'artifacts', 'tube-cleaner-youtube-music-capabilities.png'), fullPage: true });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}


// ---- Scenario 12: production injector starts before <html> exists -------
// Playwright init scripts run at Safari's true document_start: readyState is
// "loading" and document.documentElement is null. The production injector must
// start native lookup immediately, wait only for the parser to create <html>,
// then execute a page-world document-start payload before the page's first
// <head> script—not defer the whole engine until DOMContentLoaded.
{
  console.log('\n=== Scenario: Userscript injector (true document-start) ===');
  const S = 'injector-document-start';
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const earlyPayload = `window.__wblockEarlyPayload = {
    readyState: document.readyState,
    hasDocumentElement: !!document.documentElement,
    hasBody: !!document.body,
    time: performance.now()
  };`;
  const descriptor = {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Document Start Probe',
    namespace: 'com.skula.wblock.tests',
    version: '1.0.0',
    description: '',
    runAt: 'document-start',
    noframes: false,
    injectInto: 'page',
    content: earlyPayload,
    resourceNames: [],
    storageSnapshot: {},
  };
  const mockBridge = `
    globalThis.browser = {
      runtime: {
        onMessage: { addListener: function () {} },
        sendMessage: function (message) {
          if (message && message.action === 'getUserScripts') {
            return Promise.resolve({ userScripts: [${JSON.stringify(descriptor)}] });
          }
          return Promise.resolve({});
        }
      }
    };
  `;
  await page.addInitScript(mockBridge + '\n' + injectorSource);

  const fixture = `<!doctype html><html><head><script>
    window.__firstHeadScript = {
      readyState: document.readyState,
      sawPayload: !!window.__wblockEarlyPayload,
      time: performance.now()
    };
  <\/script></head><body>document-start probe</body></html>`;
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(fixture), { waitUntil: 'load' });

  const state = await page.evaluate(() => ({
    payload: window.__wblockEarlyPayload || null,
    head: window.__firstHeadScript || null,
  }));
  const early = !!(state.payload && state.head &&
    state.payload.readyState === 'loading' &&
    state.payload.hasDocumentElement === true &&
    state.payload.hasBody === false &&
    state.head.sawPayload === true &&
    state.payload.time <= state.head.time);
  record(S, 'executes document-start payload before first page script', early,
    state.payload && state.head
      ? `payload=${state.payload.time.toFixed(1)}ms head=${state.head.time.toFixed(1)}ms state=${state.payload.readyState}`
      : `payload=${!!state.payload} head=${!!state.head}`);
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario 13: cleaner frame policy -----------------------------------
// Tube Cleaner remains top-frame-only, while Player Cleaner must reach a
// third-party Plyr-style frame (with its YouTube exclusions still intact).
{
  console.log('\n=== Scenario: Userscript injector (embed safety) ===');
  const S = 'injector-embed-safety';
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const descriptors = [{
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Tube Cleaner',
    namespace: 'com.skula.wblock.tests',
    version: '1.0.0',
    description: '',
    runAt: 'document-start',
    noframes: true,
    injectInto: 'page',
    content: 'window.__wblockTubeFrameProbe = (window.__wblockTubeFrameProbe || 0) + 1;',
    resourceNames: [],
    storageSnapshot: {},
  }, {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Player Cleaner',
    namespace: 'com.skula.wblock.tests',
    version: '1.0.0',
    description: '',
    runAt: 'document-start',
    noframes: false,
    injectInto: 'page',
    content: 'window.__wblockPlayerFrameProbe = (window.__wblockPlayerFrameProbe || 0) + 1;',
    resourceNames: [],
    storageSnapshot: {},
  }];
  const mockBridge = `
    globalThis.browser = {
      runtime: {
        onMessage: { addListener: function () {} },
        sendMessage: function (message) {
          if (message && message.action === 'getUserScripts') {
            return Promise.resolve({ userScripts: ${JSON.stringify(descriptors)} });
          }
          return Promise.resolve({});
        }
      }
    };
  `;
  await page.addInitScript(mockBridge + '\n' + injectorSource);
  const iframe = '<!doctype html><html><body>embed</body></html>';
  const document = '<!doctype html><html><body><iframe src="data:text/html;charset=utf-8,' +
    encodeURIComponent(iframe) + '"></iframe></body></html>';
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(document), { waitUntil: 'load' });
  await page.waitForTimeout(100);

  const embedFrame = page.frames().find(frame => frame !== page.mainFrame());
  const topTubeRuns = await page.evaluate(() => window.__wblockTubeFrameProbe || 0);
  const topPlayerRuns = await page.evaluate(() => window.__wblockPlayerFrameProbe || 0);
  const embedTubeRuns = embedFrame
    ? await embedFrame.evaluate(() => window.__wblockTubeFrameProbe || 0)
    : -1;
  const embedPlayerRuns = embedFrame
    ? await embedFrame.evaluate(() => window.__wblockPlayerFrameProbe || 0)
    : -1;
  record(S, 'Tube Cleaner runs in the top-level document', topTubeRuns === 1, `runs=${topTubeRuns}`);
  record(S, 'Tube Cleaner stays out of embedded frames', embedTubeRuns === 0, `runs=${embedTubeRuns}`);
  record(S, 'Player Cleaner runs in the top-level document', topPlayerRuns === 1, `runs=${topPlayerRuns}`);
  record(S, 'Player Cleaner runs in an embedded frame', embedPlayerRuns === 1, `runs=${embedPlayerRuns}`);
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Tube Cleaner ignores YouTube hover-preview players ----------
{
  const { browser, page, pageErrors } = await runScenario('Tube Cleaner (hover preview)', {
    fixture: FIXTURE_URL,
    viewport: { width: 1280, height: 800 },
    scriptSource: userscript,
  });
  const S = 'tube-cleaner-hover-preview';
  await page.evaluate(() => {
    const preview = document.createElement('ytd-video-preview');
    preview.id = 'video-preview';
    preview.innerHTML = '<div id="preview-player" class="html5-video-player playing-mode"><video></video><div class="ytp-chrome-bottom"></div></div>';
    document.body.appendChild(preview);
    const video = preview.querySelector('video');
    video.src = 'blob:https://www.youtube.com/preview';
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await page.waitForTimeout(200);
  await check(page, S, 'leaves hover-preview players un-nativeized', () => {
    const preview = document.querySelector('ytd-video-preview .html5-video-player');
    const previewVideo = preview && preview.querySelector('video');
    const watch = document.getElementById('movie_player');
    return {
      pass: !!(preview && !preview.classList.contains('wblock-tc-native') &&
        previewVideo && !previewVideo.controls &&
        watch && watch.classList.contains('wblock-tc-native')),
      detail: `previewNative=${!!(preview && preview.classList.contains('wblock-tc-native'))} previewControls=${!!(previewVideo && previewVideo.controls)} watchNative=${!!(watch && watch.classList.contains('wblock-tc-native'))}`,
    };
  });
  await check(page, S, 'keeps hover-to-play preview hosts visible', () => {
    const host = document.querySelector('ytd-video-preview');
    const player = document.getElementById('preview-player');
    if (!host || !player) return { pass: false, detail: 'missing preview' };
    const hostStyle = getComputedStyle(host);
    const playerStyle = getComputedStyle(player);
    return {
      pass: hostStyle.display !== 'none' && playerStyle.display !== 'none',
      detail: `host=${hostStyle.display} player=${playerStyle.display}`,
    };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Tube Cleaner YouTube embed iframe injection -----------------
// Embed frames are a poster + YouTube play button. Nativeizing them hides
// that chrome and leaves a blank box, so Tube Cleaner must stay out.
{
  console.log('\n=== Scenario: Tube Cleaner YouTube embed iframe ===');
  const S = 'tube-cleaner-embed-iframe';
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const descriptors = [{
    id: '00000000-0000-0000-0000-000000000012',
    name: 'Tube Cleaner',
    namespace: 'com.skula.wblock.tests',
    version: '1.0.0',
    description: '',
    runAt: 'document-start',
    noframes: false,
    injectInto: 'page',
    matches: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
      'https://m.youtube.com/*',
      'https://music.youtube.com/*',
      'https://www.youtube-nocookie.com/*',
      'https://youtube-nocookie.com/*',
    ],
    content: userscript,
    resourceNames: [],
    storageSnapshot: {},
  }];
  const mockBridge = `
    globalThis.browser = {
      runtime: {
        onMessage: { addListener: function () {} },
        sendMessage: function (message) {
          if (message && message.action === 'getUserScripts') {
            return Promise.resolve({ userScripts: ${JSON.stringify(descriptors)} });
          }
          return Promise.resolve({});
        }
      }
    };
  `;
  await page.addInitScript(mockBridge + '\n' + injectorSource);
  await page.route('https://www.youtube-nocookie.com/embed/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: readFileSync(join(__dirname, 'fixture.html'), 'utf8'),
    });
  });
  await page.route('https://example.com/host-with-embed', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><iframe src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"></iframe></body></html>',
    });
  });
  await page.goto('https://example.com/host-with-embed', { waitUntil: 'load' });
  const embedFrame = page.frames().find(frame => /youtube-nocookie\.com/.test(frame.url()));
  if (!embedFrame) {
    record(S, 'found the YouTube embed frame', false, 'no youtube-nocookie frame');
  } else {
    await embedFrame.waitForTimeout(400);
    const leftAlone = await embedFrame.evaluate(() => {
      const player = document.getElementById('movie_player');
      const play = player && player.querySelector('.ytp-large-play-button, .ytp-chrome-bottom');
      const playStyle = play ? getComputedStyle(play) : null;
      return {
        player: !!player,
        native: !!(player && player.classList.contains('wblock-tc-native')),
        toolbar: !!document.querySelector('.wblock-tc-toolbar'),
        style: !!document.getElementById('wblock-tc-style'),
        chromeVisible: !!(play && playStyle && playStyle.display !== 'none'),
      };
    });
    record(S, 'leaves a youtube-nocookie embed iframe to YouTube',
      !!(leftAlone.player && !leftAlone.native && !leftAlone.toolbar && !leftAlone.style && leftAlone.chromeVisible),
      `player=${leftAlone.player} native=${leftAlone.native} toolbar=${leftAlone.toolbar} style=${leftAlone.style} chrome=${leftAlone.chromeVisible}`);
  }
  const unexpected = pageErrors.filter(message => !/getOption is not a function/.test(message));
  record(S, 'no unexpected page errors', unexpected.length === 0, unexpected.join(' | '));
  await browser.close();
}

// ---- Scenario: cached JW Player initialization race ---------------------
// On warm loads the player API can expose a fallback URL before the <video>
// owns a source. Player Cleaner must not use that hint to empty the wrapper;
// JW's controls setup still needs its mount node before attaching the MSE blob.
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (cached JW initialization)', {
    fixture: FIXTURE_PLAYER_JW_INIT_RACE_URL,
    scriptSource: playerUserscript,
    readySignal: '#cached-jw-player',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-jw-init-race';

  async function checkInitialization(label) {
    await page.waitForFunction(() => window.__jwInitRace &&
      (window.__jwInitRace.finished || window.__jwInitRace.error), null, { timeout: 5000 });

    await check(page, S, `${label}: JW controls setup completes`, () => {
      const state = window.__jwInitRace;
      const mount = document.querySelector('#cached-jw-player [data-setup-mount]');
      const controls = mount && mount.querySelector('[data-jw-controls-ready]');
      return { pass: !!(state && state.finished && !state.error && controls),
        detail: state ? `finished=${state.finished} error=${state.error || 'none'}` : 'no state' };
    });

    await check(page, S, `${label}: retains the attached MSE video in place`, () => {
      const v = document.querySelector('#cached-jw-player video');
      return { pass: !!(v && v.src.startsWith('blob:') && v.controls && !v._wblockCleaned),
        detail: v ? `src=${v.src} cleaned=${!!v._wblockCleaned}` : 'no video' };
    });
  }

  await checkInitialization('first load');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await checkInitialization('cached reload');

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Player Cleaner keeps live MSE/blob pipelines intact ------
// Regression guard for the cnn / ms.now "player errors loading the video"
// report: a blob: src means a MediaSource pipeline the page owns, whether or
// not metadata has loaded, so the cleaner must never tear it out of the DOM
// or re-source it. The rule is platform-agnostic (based on source type, not
// user agent or readyState), exercised on both a mobile and a desktop
// profile. Clean (http) sources still get normal structural cleanup.
{
  const blobCases = ['p-dom', 'p-videojs', 'p-jwplayer'];
  const cleanCases = [
    ['p-src', 'https://example.com/a.mp4'],
    ['p-source-child', 'https://example.com/b.mp4'],
  ];

  for (const [deviceKey, label] of [
    ['iPhone 13', 'mobile'],
    [null, 'desktop'],
  ]) {
    const device = deviceKey ? devices[deviceKey] : null;
    const { browser, page, pageErrors } = await runScenario(
      'Player Cleaner (live blob preservation)',
      {
        device,
        fixture: FIXTURE_PLAYER_LIVE_BLOB_URL,
        hasTouch: !!deviceKey,
        scriptSource: playerUserscript,
        readySignal: '[data-wblock-player-cleaner]',
      }
    );
    const S = 'player-cleaner-live-blob-' + label;

    await check(page, S, label === 'mobile'
      ? 'leaves live blob-source players to the site on iOS'
      : 'enhances live blob-source players in place (controls on, blob kept)', ({ mobile, ids }) => {
      const bad = ids.filter((id) => {
        const v = document.getElementById(id).querySelector('video');
        if (!v || (v.src || '').indexOf('blob:') !== 0 || v._wblockCleaned) return true;
        return mobile ? !!v.controls || !!v._wblockEnhanced : !v.controls;
      });
      return { pass: bad.length === 0, detail: bad.length ? 'bad: ' + bad.join(',') : (mobile ? '3/3 blobs left to the site' : '3/3 blob retained + controls') };
    }, { arg: { mobile: label === 'mobile', ids: blobCases } });

    await check(page, S, 'does not structurally clean live blob-source players', (blobCases) => {
      const cleaned = blobCases.filter((id) => {
        const v = document.getElementById(id).querySelector('video');
        return !!(v && v._wblockCleaned);
      });
      return { pass: cleaned.length === 0, detail: cleaned.length ? `cleaned: ${cleaned.join(',')}` : '0/3 cleaned (pipeline preserved)' };
    }, { arg: blobCases });

    await check(page, S, 'still cleans direct http-source players', (cleanCases) => {
      const bad = cleanCases.filter(([id, expected]) => {
        const v = document.getElementById(id).querySelector('video');
        const source = v && (v.currentSrc || v.getAttribute('src') ||
          (v.querySelector('source') && v.querySelector('source').src));
        return !(v && v._wblockCleaned && v.controls === true && source === expected);
      });
      return { pass: bad.length === 0, detail: bad.length ? `bad: ${bad.map(([id]) => id).join(',')}` : '2/2 cleaned' };
    }, { arg: cleanCases });

    // iOS WebKit only loads ManagedMediaSource attachments while remote
    // playback stays disabled, so the cleaner must never strip the site's
    // disableremoteplayback from blob/MSE players (the CNN/Fox iOS infinite
    // load). Direct http(s) sources still get AirPlay restored, desktop only.
    await check(page, S, 'preserves disableremoteplayback on blob/MSE players', (blobCases) => {
      const stripped = blobCases.filter((id) => {
        const v = document.getElementById(id).querySelector('video');
        return !(v && v.hasAttribute('disableremoteplayback'));
      });
      return { pass: stripped.length === 0, detail: stripped.length ? `stripped: ${stripped.join(',')}` : 'attribute kept on 3/3' };
    }, { arg: blobCases });

    await check(page, S, label === 'mobile'
      ? 'leaves the direct-source remote-playback flag alone on iOS'
      : 'restores AirPlay for direct-source players on desktop', (mobile) => {
      const v = document.getElementById('p-src').querySelector('video');
      const has = !!(v && v.hasAttribute('disableremoteplayback'));
      return { pass: mobile ? has : !has, detail: `disableremoteplayback=${has}` };
    }, { arg: label === 'mobile' });

    // A player re-initializing for its next clip re-asserts the attribute just
    // before reloading; the controls guard must not strip it back off.
    await page.evaluate((blobCases) => {
      blobCases.forEach((id) => {
        const v = document.getElementById(id).querySelector('video');
        v.removeAttribute('disableremoteplayback');
        v.setAttribute('disableremoteplayback', '');
      });
    }, blobCases);
    await page.waitForTimeout(250);
    await check(page, S, 'keeps a re-asserted disableremoteplayback through the controls guard', (blobCases) => {
      const stripped = blobCases.filter((id) => {
        const v = document.getElementById(id).querySelector('video');
        return !(v && v.hasAttribute('disableremoteplayback'));
      });
      return { pass: stripped.length === 0, detail: stripped.length ? `stripped: ${stripped.join(',')}` : 'guard left the attribute alone' };
    }, { arg: blobCases });

    record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await browser.close();
  }
}

// ---- Scenario: delayed AMP/FAVE startup handshake ------------------------
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (delayed player startup)', {
    fixture: FIXTURE_PLAYER_HANDSHAKE_URL,
    scriptSource: playerUserscript,
    viewport: { width: 900, height: 820 },
  });
  const S = 'player-cleaner-startup-handshake';

  await page.waitForTimeout(250);
  await check(page, S, 'leaves AMP/FAVE custom controls in charge during source startup', () => {
    const videos = [document.getElementById('amp-video'), document.getElementById('fave-video')];
    const chrome = [document.querySelector('.amp-pause-overlay'), document.querySelector('.fave-controls')];
    const pass = videos.every(v => v && !v.controls && !v.hasAttribute('data-wblock-player-cleaner')) &&
      chrome.every(el => el && getComputedStyle(el).display !== 'none');
    return { pass, detail: `controls=${videos.map(v => v && v.controls)} done=${videos.map(v => v && v.getAttribute('data-wblock-player-cleaner'))}` };
  });

  await page.evaluate(() => window.__startHandshakePlayers());
  await check(page, S, 'leaves AMP ad chrome clickable while FAVE nativeizes', () => {
    const amp = document.getElementById('amp-video');
    const fave = document.getElementById('fave-video');
    const skip = document.querySelector('.amp-skip-ad');
    const pass = amp && !amp.controls && !amp.hasAttribute('data-wblock-player-cleaner') &&
      fave && fave.controls && fave.getAttribute('data-wblock-player-cleaner') === '1' &&
      skip && getComputedStyle(skip).display !== 'none' && !skip.closest('[data-wblock-pc-hidden]');
    return { pass, detail: `amp=${amp && amp.controls}/${amp && amp.getAttribute('data-wblock-player-cleaner')} fave=${fave && fave.controls} skip=${skip && getComputedStyle(skip).display}` };
  });

  await page.evaluate(() => window.__finishAMPAd());
  await check(page, S, 'nativeizes AMP after the preroll ends', () => {
    const amp = document.getElementById('amp-video');
    return { pass: !!(amp && amp.controls && amp.getAttribute('data-wblock-player-cleaner') === '1'),
      detail: `controls=${amp && amp.controls} done=${amp && amp.getAttribute('data-wblock-player-cleaner')}` };
  });

  await page.evaluate(() => window.__remountAMPChrome());
  await check(page, S, 'keeps MSE sources and hides remounted AMP chrome roots', () => {
    const amp = document.getElementById('amp-video');
    const fave = document.getElementById('fave-video');
    const sources = window.__wblockHandshakeSources || [];
    const ampRoots = [document.querySelector('.amp-react'), document.querySelector('.amp-overlays')];
    const faveControls = document.querySelector('.fave-controls');
    const hidden = ampRoots.every(el => el && el.hasAttribute('data-wblock-pc-hidden') &&
      getComputedStyle(el).display === 'none') && faveControls &&
      getComputedStyle(faveControls).display === 'none';
    const sourceKept = amp && fave && amp.src === sources[0] && fave.src === sources[1] &&
      !amp._wblockCleaned && !fave._wblockCleaned;
    return { pass: hidden && sourceKept, detail: `hidden=${hidden} sourceKept=${sourceKept}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: iOS opaque MSE gets native controls without replacement ------
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (iOS opaque MSE)', {
    device: iphone,
    hasTouch: true,
    gotoURL: 'https://www.foxnews.com/video/fixture',
    responseBody: readFileSync(join(__dirname, 'fixture-player-cleaner-handshake.html'), 'utf8'),
    scriptSource: playerUserscript,
  });
  const S = 'player-cleaner-ios-opaque-mse';

  await page.evaluate(() => {
    const fave = document.getElementById('fave-video');
    Object.defineProperty(fave, 'paused', { configurable: true, get: () => false });
    fave.dispatchEvent(new Event('playing'));
  });
  await page.waitForTimeout(250);
  await check(page, S, 'locks FAVE remote playback without nativeizing the MSE player', () => {
    const video = document.getElementById('fave-video');
    const wrapper = document.querySelector('.fave-player-container');
    const siteControls = document.querySelector('.fave-controls');
    const source = (window.__wblockHandshakeSources || [])[1];
    const chromeVisible = !!(siteControls && getComputedStyle(siteControls).display !== 'none' &&
      !siteControls.hasAttribute('data-wblock-pc-hidden') && !siteControls.closest('[data-wblock-pc-hidden]'));
    const pass = video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video._wblockEnhanced && video.src === source && wrapper && wrapper.contains(video) && chromeVisible &&
      video.disableRemotePlayback && video.getAttribute('x-webkit-airplay') === 'deny';
    return { pass, detail: video ? 'controls=' + video.controls + ' enhanced=' + !!video._wblockEnhanced +
      ' sourceKept=' + (video.src === source) + ' wrapperKept=' + !!(wrapper && wrapper.contains(video)) +
      ' chromeVisible=' + chromeVisible + ' airplay=' + video.getAttribute('x-webkit-airplay') : 'no video' };
  });

  await page.evaluate(() => window.__startHandshakePlayers());
  await check(page, S, 'leaves AMP preroll chrome clickable on iOS', () => {
    const amp = document.getElementById('amp-video');
    const skip = document.querySelector('.amp-skip-ad');
    const pass = amp && !amp.controls && !amp.hasAttribute('data-wblock-player-cleaner') &&
      skip && getComputedStyle(skip).display !== 'none' && !skip.closest('[data-wblock-pc-hidden]');
    return { pass, detail: `amp=${amp && amp.controls}/${amp && amp.getAttribute('data-wblock-player-cleaner')} skip=${skip && getComputedStyle(skip).display}` };
  });

  await page.evaluate(() => {
    const amp = document.getElementById('amp-video');
    Object.defineProperty(amp, 'paused', { configurable: true, get: () => false });
    window.__finishAMPAd();
  });
  await page.waitForTimeout(250);
  await check(page, S, 'leaves AMP in charge after preroll without replacing its MSE source', () => {
    const amp = document.getElementById('amp-video');
    const source = (window.__wblockHandshakeSources || [])[0];
    const pass = !!(amp && !amp.controls && !amp.hasAttribute('data-wblock-player-cleaner') &&
      !amp._wblockEnhanced && amp.src === source &&
      amp.disableRemotePlayback && amp.getAttribute('x-webkit-airplay') === 'deny');
    return { pass, detail: `controls=${amp && amp.controls} enhanced=${!!(amp && amp._wblockEnhanced)} sourceKept=${amp && amp.src === source} airplay=${amp && amp.getAttribute('x-webkit-airplay')}` };
  });

  await check(page, S, 'keeps the ManagedMediaSource remote-playback restriction on iOS', () => {
    const amp = document.getElementById('amp-video');
    const fave = document.getElementById('fave-video');
    const pass = !!(amp && amp.hasAttribute('disableremoteplayback') && amp.disableRemotePlayback &&
      fave && fave.hasAttribute('disableremoteplayback') && fave.disableRemotePlayback);
    return { pass, detail: `amp=${!!(amp && amp.hasAttribute('disableremoteplayback'))} fave=${!!(fave && fave.hasAttribute('disableremoteplayback'))}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: iOS FAVE srcObject ManagedMediaSource (cnn) -----------------
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (iOS srcObject MMS)', {
    device: iphone,
    hasTouch: true,
    gotoURL: 'https://www.cnn.com/2026/08/14/politics/video/fixture-srcobject-mms',
    responseBody: readFileSync(join(__dirname, 'fixture-player-cleaner-srcobject.html'), 'utf8'),
    scriptSource: playerUserscript,
    readySignal: '#fave-shell',
  });
  const S = 'player-cleaner-ios-srcobject-mms';

  await page.waitForTimeout(250);
  await check(page, S, 'locks remote playback on the handshake video before any source attaches', () => {
    const video = document.getElementById('content-video');
    const play = document.getElementById('play-button');
    const visible = el => el && getComputedStyle(el).display !== 'none' &&
      !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    const pass = !!(video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      video.disableRemotePlayback && video.hasAttribute('disableremoteplayback') &&
      video.getAttribute('x-webkit-airplay') === 'deny' && visible(play));
    return { pass, detail: `controls=${video && video.controls} done=${video && video.getAttribute('data-wblock-player-cleaner')} drp=${video && video.disableRemotePlayback}/${video && video.hasAttribute('disableremoteplayback')} airplay=${video && video.getAttribute('x-webkit-airplay')} play=${play && getComputedStyle(play).display}` };
  });

  await page.evaluate(() => window.__startEmptyHandshake());
  await page.waitForTimeout(250);
  await check(page, S, 'does not nativeize a sourceless playing handshake', () => {
    const video = document.getElementById('content-video');
    const play = document.getElementById('play-button');
    const visible = el => el && getComputedStyle(el).display !== 'none' &&
      !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    const pass = !!(video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video.srcObject && video.getAttribute('x-webkit-airplay') === 'deny' && visible(play));
    return { pass, detail: `controls=${video && video.controls} done=${video && video.getAttribute('data-wblock-player-cleaner')} srcObject=${video && !!video.srcObject} airplay=${video && video.getAttribute('x-webkit-airplay')} play=${play && getComputedStyle(play).display}` };
  });

  await page.evaluate(() => window.__attachManagedSource());
  await page.waitForTimeout(250);
  await check(page, S, 'keeps the site player after srcObject attaches without lifting the MMS lock', () => {
    const video = document.getElementById('content-video');
    const wrapper = document.querySelector('.pui-wrapper');
    const play = document.getElementById('play-button');
    const visible = el => el && getComputedStyle(el).display !== 'none' &&
      !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    const pass = !!(video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video._wblockCleaned && video.srcObject &&
      video.disableRemotePlayback && video.hasAttribute('disableremoteplayback') &&
      video.getAttribute('x-webkit-airplay') === 'deny' &&
      visible(wrapper) && visible(play));
    return { pass, detail: video ? `controls=${video.controls} cleaned=${!!video._wblockCleaned} srcObject=${!!video.srcObject} drp=${video.disableRemotePlayback}/${video.hasAttribute('disableremoteplayback')} airplay=${video.getAttribute('x-webkit-airplay')} chrome=${wrapper && getComputedStyle(wrapper).display}` : 'no video' };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Bolt autoplay-unlock primer pool (cnn vertical video) -------
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Bolt unlock primer pool)', {
    device: iphone,
    hasTouch: true,
    gotoURL: 'https://www.cnn.com/2026/08/14/politics/video/fixture-digvid-vrtc',
    responseBody: readFileSync(join(__dirname, 'fixture-player-cleaner-primer.html'), 'utf8'),
    scriptSource: playerUserscript,
    readySignal: '#fave-shell',
  });
  const S = 'player-cleaner-bolt-primer';

  await page.evaluate(() => window.__primeUnlockPool());
  await page.waitForTimeout(250);
  await check(page, S, 'ignores the data: unlock primer and keeps the play UI usable', () => {
    const primer = document.getElementById('primer-video');
    const play = document.getElementById('play-button');
    const wrapper = document.querySelector('.pui-wrapper');
    const visible = el => el && getComputedStyle(el).display !== 'none' &&
      !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    const pass = !!(primer && !primer.controls && !primer.hasAttribute('data-wblock-player-cleaner') &&
      !primer._wblockEnhanced && visible(play) && visible(wrapper));
    return { pass, detail: `primer=${primer && primer.controls}/${primer && primer.getAttribute('data-wblock-player-cleaner')} play=${play && getComputedStyle(play).display} wrapper=${wrapper && getComputedStyle(wrapper).display}` };
  });

  await page.evaluate(() => window.__attachContentSource());
  await page.waitForTimeout(250);
  await check(page, S, 'leaves the content video to the site player once its blob attaches', () => {
    const content = document.getElementById('content-video');
    const source = window.__wblockPrimerContentSource;
    const pass = !!(content && !content.controls && !content.hasAttribute('data-wblock-player-cleaner') &&
      !content._wblockEnhanced && !content._wblockCleaned && content.src === source &&
      content.hasAttribute('disableremoteplayback') && content.disableRemotePlayback &&
      content.getAttribute('x-webkit-airplay') === 'deny');
    return { pass, detail: content ? `controls=${content.controls} enhanced=${!!content._wblockEnhanced} sourceKept=${content.src === source} drp=${content.disableRemotePlayback} airplay=${content.getAttribute('x-webkit-airplay')}` : 'no video' };
  });

  await check(page, S, 'keeps Bolt chrome and the pooled sibling video usable', () => {
    const wrapper = document.querySelector('.pui-wrapper');
    const primer = document.getElementById('primer-video');
    const play = document.getElementById('play-button');
    const visible = el => el && getComputedStyle(el).display !== 'none' &&
      !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    const primerUsable = !!(primer && !primer.hasAttribute('data-wblock-pc-hidden') &&
      getComputedStyle(primer).display !== 'none');
    return { pass: visible(wrapper) && visible(play) && primerUsable, detail: `chrome=${wrapper && getComputedStyle(wrapper).display} play=${play && getComputedStyle(play).display} primer=${primer && getComputedStyle(primer).display} marked=${!!(primer && primer.hasAttribute('data-wblock-pc-hidden'))}` };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: iOS video.js / Media Chrome native URL promotion ----------
// videojs.org feeds an MSE blob while React/video.js still know the HLS or
// MP4 URL. iOS cannot nativeize that blob, but Safari can play the URL
// directly. Handshake players and blobs with no discoverable URL stay put.
{
  const iphone = devices['iPhone 13'];
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (iOS video.js native promote)', {
    device: iphone,
    hasTouch: true,
    fixture: FIXTURE_PLAYER_VIDEOJS_IOS_URL,
    scriptSource: playerUserscript,
    readySignal: '#hero-video[data-wblock-player-cleaner]',
  });
  const S = 'player-cleaner-ios-videojs';

  await check(page, S, 'promotes the Media Chrome HLS URL and nativeizes on iOS', () => {
    const video = document.getElementById('hero-video');
    const controls = document.getElementById('hero-controls');
    const src = video && (video.currentSrc || video.src);
    const chromeHidden = !!(controls && (getComputedStyle(controls).display === 'none' ||
      controls.hasAttribute('data-wblock-pc-hidden') || controls.closest('[data-wblock-pc-hidden]')));
    const pass = !!(video && video.controls && video.hasAttribute('data-wblock-player-cleaner') &&
      video._wblockEnhanced && !video._wblockCleaned &&
      src === 'https://stream.mux.com/demo.m3u8' && chromeHidden);
    return { pass, detail: video ? 'src=' + src + ' controls=' + video.controls + ' enhanced=' + !!video._wblockEnhanced + ' cleaned=' + !!video._wblockCleaned + ' chrome=' + (controls && getComputedStyle(controls).display) : 'no video' };
  });

  await check(page, S, 'leaves an iOS blob without a native URL to the site', () => {
    const video = document.getElementById('opaque-video');
    const controls = document.getElementById('opaque-controls');
    const chromeVisible = !!(controls && getComputedStyle(controls).display !== 'none' &&
      !controls.hasAttribute('data-wblock-pc-hidden') && !controls.closest('[data-wblock-pc-hidden]'));
    const pass = !!(video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video._wblockEnhanced && (video.currentSrc || video.src || '').indexOf('blob:') === 0 &&
      video.disableRemotePlayback && video.getAttribute('x-webkit-airplay') === 'deny' && chromeVisible);
    return { pass, detail: video ? 'controls=' + video.controls + ' enhanced=' + !!video._wblockEnhanced + ' src=' + (video.currentSrc || video.src) + ' airplay=' + video.getAttribute('x-webkit-airplay') + ' chrome=' + (controls && getComputedStyle(controls).display) : 'no video' };
  });

  await check(page, S, 'does not promote a handshake player even when React exposes HLS', () => {
    const video = document.getElementById('fave-video');
    const controls = document.getElementById('fave-controls');
    const chromeVisible = !!(controls && getComputedStyle(controls).display !== 'none' &&
      !controls.hasAttribute('data-wblock-pc-hidden') && !controls.closest('[data-wblock-pc-hidden]'));
    const pass = !!(video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video._wblockEnhanced && (video.currentSrc || video.src || '').indexOf('blob:') === 0 &&
      video.disableRemotePlayback && chromeVisible);
    return { pass, detail: video ? 'controls=' + video.controls + ' enhanced=' + !!video._wblockEnhanced + ' src=' + (video.currentSrc || video.src) + ' chrome=' + (controls && getComputedStyle(controls).display) : 'no video' };
  });

  await check(page, S, 'does not replace a blob with a classic video.js API fallback', () => {
    const video = document.getElementById('classic-video');
    const controls = document.getElementById('classic-controls');
    const chromeVisible = !!(controls && getComputedStyle(controls).display !== 'none' &&
      !controls.hasAttribute('data-wblock-pc-hidden') && !controls.closest('[data-wblock-pc-hidden]'));
    const pass = !!(video && !video.controls && !video.hasAttribute('data-wblock-player-cleaner') &&
      !video._wblockEnhanced && (video.currentSrc || video.src || '').indexOf('blob:') === 0 && chromeVisible);
    return { pass, detail: video ? 'controls=' + video.controls + ' enhanced=' + !!video._wblockEnhanced + ' src=' + (video.currentSrc || video.src) : 'no video' };
  });

  await page.waitForFunction(() => {
    const video = document.getElementById('reload-video');
    return !!(video && (video._wblockIOSNativeRetries || 0) >= 1 &&
      (video.currentSrc || video.src) === 'https://stream.mux.com/reload.m3u8');
  }, { timeout: 5000 }).catch(() => {});
  await check(page, S, 'reasserts the native URL when a cached-reload player re-attaches its blob', () => {
    const video = document.getElementById('reload-video');
    const src = video && (video.currentSrc || video.src);
    const pass = !!(video && src === 'https://stream.mux.com/reload.m3u8' &&
      video._wblockIOSNativeSrc === src && (video._wblockIOSNativeRetries || 0) >= 1);
    return { pass, detail: video ? 'src=' + src + ' retries=' + (video._wblockIOSNativeRetries || 0) : 'no video' };
  });

  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: in-chat video + messenger composer (Discord geometry) -----
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Discord composer)', {
    fixture: FIXTURE_PLAYER_DISCORD_URL,
    scriptSource: playerUserscript,
    readySignal: '#chat-video[data-wblock-player-cleaner]',
    viewport: { width: 1280, height: 800 },
  });
  const S = 'player-cleaner-discord';
  await check(page, S, 'enhances the in-chat attachment with native controls', () => {
    const v = document.getElementById('chat-video');
    return {
      pass: !!(v && v.controls && v.hasAttribute('data-wblock-player-cleaner')),
      detail: v ? `controls=${v.controls} done=${v.getAttribute('data-wblock-player-cleaner')}` : 'no chat video',
    };
  });
  await check(page, S, 'hides custom player overlay chrome', () => {
    const overlay = document.getElementById('player-overlay');
    const bar = document.getElementById('player-bar');
    const hidden = el => el && (getComputedStyle(el).display === 'none' || el.hasAttribute('data-wblock-pc-hidden'));
    return {
      pass: !!(hidden(overlay) && hidden(bar)),
      detail: `overlay=${overlay && getComputedStyle(overlay).display} bar=${bar && getComputedStyle(bar).display}`,
    };
  });
  await check(page, S, 'keeps the overlapping message composer visible', () => {
    const field = document.getElementById('message-field');
    const composer = document.getElementById('composer');
    const visible = el => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const unmarked = el => el && !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    return {
      pass: !!(visible(field) && visible(composer) && unmarked(field) && unmarked(composer)),
      detail: `field=${field && getComputedStyle(field).display}/${getComputedStyle(field).visibility} composer=${composer && getComputedStyle(composer).display}/${getComputedStyle(composer).visibility}`,
    };
  });
  await check(page, S, 'leaves the WebRTC call tile untouched', () => {
    const v = document.getElementById('call-video');
    return {
      pass: !!(v && !v.controls && !v.hasAttribute('data-wblock-player-cleaner') && !v._wblockEnhanced),
      detail: v ? `controls=${v.controls} done=${v.getAttribute('data-wblock-player-cleaner')} enhanced=${!!v._wblockEnhanced}` : 'no call video',
    };
  });
  await check(page, S, 'keeps the call-side composer visible', () => {
    const field = document.getElementById('call-message-field');
    const composer = document.getElementById('call-composer');
    const visible = el => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const unmarked = el => el && !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    return {
      pass: !!(visible(field) && visible(composer) && unmarked(field) && unmarked(composer)),
      detail: `field=${field && getComputedStyle(field).display} composer=${composer && getComputedStyle(composer).display}`,
    };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Scenario: Twitch persistent-player shell boundary -------------------
{
  const { browser, page, pageErrors } = await runScenario('Player Cleaner (Twitch shell boundary)', {
    fixture: FIXTURE_PLAYER_TWITCH_URL,
    gotoURL: 'https://www.twitch.tv/videos/fixture',
    responseBody: readFileSync(join(__dirname, 'fixture-player-cleaner-twitch.html'), 'utf8'),
    scriptSource: playerUserscript,
    readySignal: '#twitch-video[data-wblock-player-cleaner]',
    viewport: { width: 900, height: 700 },
  });
  const S = 'player-cleaner-twitch';
  await check(page, S, 'preserves the stream and native controls', () => {
    const v = document.getElementById('twitch-video');
    return { pass: !!(v && v.controls && v.srcObject && !v._wblockCleaned), detail: v ? `controls=${v.controls} srcObject=${!!v.srcObject} cleaned=${!!v._wblockCleaned}` : 'no video' };
  });
  await check(page, S, 'hides player chrome but preserves page content', () => {
    const chrome = document.getElementById('twitch-controls');
    const content = document.getElementById('page-content');
    const about = document.getElementById('stream-about');
    const visible = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    const unmarked = el => !el.hasAttribute('data-wblock-pc-hidden') && !el.closest('[data-wblock-pc-hidden]');
    return { pass: !!(chrome && getComputedStyle(chrome).display === 'none' && content && visible(content) && about && visible(about) && unmarked(content) && unmarked(about)), detail: `chrome=${getComputedStyle(chrome).display} content=${getComputedStyle(content).display}/${getComputedStyle(content).visibility} about=${getComputedStyle(about).display}/${getComputedStyle(about).visibility} marked=${!unmarked(content) || !unmarked(about)}` };
  });
  record(S, 'no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

// ---- Summary -------------------------------------------------------------
console.log('\n================ SUMMARY ================');
const byScenario = {};
for (const r of results) {
  byScenario[r.scenario] ??= { pass: 0, fail: 0 };
  byScenario[r.scenario][r.pass ? 'pass' : 'fail']++;
}
let totalPass = 0, totalFail = 0;
for (const [s, c] of Object.entries(byScenario)) {
  console.log(`  ${s}: ${c.pass} passed, ${c.fail} failed`);
  totalPass += c.pass; totalFail += c.fail;
}
console.log(`\n  TOTAL: ${totalPass} passed, ${totalFail} failed`);
if (totalFail > 0) {
  console.log('\n  FAILING CHECKS:');
  for (const r of results.filter(r => !r.pass)) {
    console.log(`   - [${r.scenario}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
}
process.exit(totalFail > 0 ? 1 : 0);
