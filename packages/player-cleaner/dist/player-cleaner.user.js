// ==UserScript==
// @name         Player Cleaner
// @namespace    com.skula.wblock
// @version      0.1.57
// @description  Gives custom web players native controls, auto PiP, background playback, restored subtitle and chapter tracks, Now Playing metadata, and remembered playback preferences.
// @description:de  Bietet Web-Playern native Steuerelemente, Auto-PiP, Hintergrundwiedergabe, wiederhergestellte Untertitel und Kapitel, Now-Playing-Metadaten und gespeicherte Wiedergabeeinstellungen.
// @description:es  Añade a los reproductores web controles nativos, PiP automático, reproducción en segundo plano, subtítulos y capítulos restaurados, metadatos Now Playing y preferencias recordadas.
// @description:fr  Ajoute aux lecteurs web les commandes natives, le PiP automatique, la lecture en arrière-plan, les sous-titres et chapitres restaurés, les métadonnées À l’écoute et les préférences mémorisées.
// @description:it  Aggiunge ai player web controlli nativi, PiP automatico, riproduzione in background, sottotitoli e capitoli ripristinati, metadati Now Playing e preferenze memorizzate.
// @description:pt-BR  Adiciona aos players web controles nativos, PiP automático, reprodução em segundo plano, legendas e capítulos restaurados, metadados Reproduzindo Agora e preferências lembradas.
// @description:ja  Webプレーヤーにネイティブコントロール、自動PiP、バックグラウンド再生、字幕とチャプターの復元、再生中メタデータ、記憶される再生設定を追加します。
// @description:ko  웹 플레이어에 네이티브 컨트롤, 자동 PIP, 백그라운드 재생, 자막과 챕터 복원, Now Playing 메타데이터 및 재생 환경설정 저장을 추가합니다.
// @description:ru  Добавляет веб-плеерам нативные элементы управления, авто-PiP, фоновое воспроизведение, восстановленные субтитры и главы, метаданные «Исполняется» и сохранение настроек.
// @description:zh-Hans  为网页播放器添加原生控件、自动画中画、后台播放、恢复的字幕和章节、正在播放元数据以及记忆的播放偏好。
// @author       wBlock
// @homepageURL  https://github.com/0xCUB3/wBlock-userscripts
// @match        http://*/*
// @match        https://*/*
// @exclude      https://www.youtube.com/*
// @exclude      https://youtube.com/*
// @exclude      https://m.youtube.com/*
// @exclude      https://music.youtube.com/*
// @exclude      https://www.youtube-nocookie.com/*
// @exclude      https://youtube-nocookie.com/*
// @exclude      /^https?:\/\/([^\/]*\.)?amazon\.[a-z.]+(:\d+)?\//
// @exclude      /^https?:\/\/([^\/]*\.)?(x|twitter)\.com(:\d+)?\//
// @exclude      https://drive.google.com/*
// @exclude      https://docs.google.com/*
// @exclude      https://youtube.googleapis.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/player-cleaner/dist/player-cleaner.user.js
// @updateURL    https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/player-cleaner/dist/player-cleaner.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Player Cleaner
    //
    // Gives the <video> inside a custom web player Safari's native controls,
    // then hides the site's own chrome painted over it. The media element and
    // its pipeline are never replaced: the site keeps feeding it, Player
    // Cleaner only changes what is drawn on top and which controls answer.
    //
    // One rule covers every player: inside the player's box, everything that
    // is not the video or one of its ancestors is chrome. Overlays mounted
    // elsewhere (portals) are found by hit-testing the video's pixels.
    // ------------------------------------------------------------------

    var host = location.hostname;
    var IS_IOS = /iP(?:hone|ad|od)/i.test(navigator.platform || '') ||
        /iP(?:hone|ad|od)/i.test(navigator.userAgent || '') ||
        (/Mac/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1);

    // Sites whose players break under any media-element change are
    // excluded in the metadata (Amazon, X, Google Drive). On iOS only,
    // Nat Geo's BAM player stays black.
    if (IS_IOS && /(^|\.)nationalgeographic\.com$/i.test(host)) { return; }

    var ATTR_DONE = 'data-wblock-player-cleaner';
    var HIDDEN_ATTR = 'data-wblock-pc-hidden';
    var PREFERENCES_KEY = 'wblock.playerCleaner.preferences';
    var RESUME_KEY = 'wblock.playerCleaner.resume';
    var AUTO_PIP_KEY = 'wblock.playerCleaner.autoPiP';

    // Wrappers of common player libraries. Inside one of these every non-video
    // element is chrome; elsewhere only positioned overlays are.
    var PLAYER_SELECTOR = [
        '.video-js', '.theoplayer-container', '.bitmovinplayer-container',
        '.jwplayer', '.jw-wrapper', '.plyr', '.flowplayer', '.fp-player',
        '.mejs-container', '.mejs__container', '.clappr', '[data-clappr-player]',
        '.fluid_video_wrapper', 'mux-player', 'media-controller', 'media-theme',
        'media-theme-youtube', '.media-player', '.media-default-skin', '.media-skin',
        '.WebPlayerContainer', '.mw-tmh-player', '[data-mw-tmh]',
        '[data-a-target="video-player"]', 'shreddit-player', '.amp-player',
        '.fave-player-container', '.vjs-pbs', '#player-videojs'
    ].join(',');

    // Players that attach their media during their own play gesture (CNN
    // FAVE, Fox AMP). Touching them before playback starts resets startup.
    var HANDSHAKE_SELECTOR = '.amp-player,.fave-player-container';

    // UI that must stay usable even inside a player: ads with their skip
    // buttons, error screens, and paywall prompts.
    var PROTECTED_SELECTOR = '[class*="preroll"],[class*="ima-ad"],[class*="ad-container"],' +
        '[class*="ads-container"],.amp-ad,.amp-ads,.fw-ad,.theo-ad,.theo-ads,.vjs-error-display,' +
        '[class*="vjs-error"],[class*="passport_benefit"],[class*="PassportBenefit"]';

    var features = { autoPictureInPicture: true, backgroundPlayback: true };
    if (typeof __wblockPlayerCleanerFeatures === 'object' && __wblockPlayerCleanerFeatures) {
        for (var featureName in features) {
            if (typeof __wblockPlayerCleanerFeatures[featureName] === 'boolean') {
                features[featureName] = __wblockPlayerCleanerFeatures[featureName];
            }
        }
    }

    function log() {
        if (window.__wblockPlayerCleanerDebug) {
            try { console.log.apply(console, ['[Player Cleaner]'].concat([].slice.call(arguments))); } catch (e) { /* ignore */ }
        }
    }

    function attempt(fn) { try { return fn(); } catch (e) { return undefined; } }

    // ------------------------------------------------------------------
    // Per-video state
    //
    // Everything attached to a media element lives in one record, dropped as
    // a whole on release. _wblockEnhanced and _wblockAutoPiPHooked mirror it
    // onto the element as a read-only debug surface.
    // ------------------------------------------------------------------

    var states = new WeakMap();
    var enhanced = [];

    function stateOf(video) {
        var state = states.get(video);
        if (!state) { state = { hooks: {}, cleanups: [] }; states.set(video, state); }
        return state;
    }

    function once(video, key) {
        var hooks = stateOf(video).hooks;
        if (hooks[key]) { return false; }
        hooks[key] = true;
        return true;
    }

    function onCleanup(video, fn) { stateOf(video).cleanups.push(fn); }

    function listen(video, target, type, fn, options) {
        target.addEventListener(type, fn, options);
        onCleanup(video, function () { target.removeEventListener(type, fn, options); });
    }

    function release(video) {
        var state = states.get(video);
        if (state) { state.cleanups.forEach(function (fn) { attempt(fn); }); }
        states.delete(video);
        video._wblockEnhanced = false;
        video._wblockAutoPiPHooked = false;
        var index = enhanced.indexOf(video);
        if (index !== -1) { enhanced.splice(index, 1); }
        attempt(function () { video.removeAttribute(ATTR_DONE); });
    }

    // ------------------------------------------------------------------
    // Shadow-aware DOM helpers
    // ------------------------------------------------------------------

    // The parent in the flat tree: a slotted node renders inside its slot, so
    // the shadow elements around that slot are its ancestors too.
    function parentOf(node) {
        return node && (node.assignedSlot || node.parentNode || node.host) || null;
    }

    function contains(ancestor, node) {
        for (var current = node; current; current = parentOf(current)) {
            if (current === ancestor) { return true; }
        }
        return false;
    }

    function related(a, b) { return contains(a, b) || contains(b, a); }

    function closest(node, selector) {
        for (var el = node; el; el = parentOf(el)) {
            if (el.nodeType === 1 && attempt(function () { return el.matches(selector); })) { return el; }
        }
        return null;
    }

    function positioned(el) {
        var position = attempt(function () { return getComputedStyle(el).position; });
        return position && position !== 'static';
    }

    // Absolute, fixed and sticky elements paint over others; relative ones
    // stay in flow and only establish a positioning context.
    function overlay(el) {
        return /^(absolute|fixed|sticky)$/.test(attempt(function () { return getComputedStyle(el).position; }) || '');
    }

    function rectOf(el) { return attempt(function () { return el.getBoundingClientRect(); }); }

    // ------------------------------------------------------------------
    // Background playback and visibility
    // ------------------------------------------------------------------

    // Captured before the document properties are shadowed below.
    var nativeHidden = (function () {
        for (var proto = document; proto; proto = Object.getPrototypeOf(proto)) {
            var descriptor = Object.getOwnPropertyDescriptor(proto, 'hidden');
            if (descriptor && descriptor.get) { return descriptor.get; }
        }
        return null;
    })();
    var reallyHidden = false;

    function updateVisibility() {
        reallyHidden = nativeHidden ? !!nativeHidden.call(document) : document.hidden;
    }
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);

    function backgroundPlaybackOn() { return features.backgroundPlayback && loadPreferences().backgroundPlayback !== false; }

    function enableBackgroundPlayback() {
        if (!backgroundPlaybackOn()) { return; }
        attempt(function () { Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } }); });
        attempt(function () { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } }); });
    }

    // ------------------------------------------------------------------
    // Auto Picture-in-Picture
    // ------------------------------------------------------------------

    var autoPiPEnabled = features.autoPictureInPicture &&
        attempt(function () { return localStorage.getItem(AUTO_PIP_KEY); }) !== '0';

    function inPiP(video) {
        return document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
    }

    function requestPiP(video, onRefused) {
        return !!attempt(function () {
            if (video.webkitSupportsPresentationMode && video.webkitSetPresentationMode) {
                video.webkitSetPresentationMode('picture-in-picture');
                return true;
            }
            if (video.requestPictureInPicture) {
                video.requestPictureInPicture().catch(onRefused);
                return true;
            }
            return false;
        });
    }

    function leavePiP(video) {
        attempt(function () {
            if (video.webkitSupportsPresentationMode && video.webkitSetPresentationMode) {
                video.webkitSetPresentationMode('inline');
            } else if (document.exitPictureInPicture) {
                document.exitPictureInPicture().catch(function () {});
            }
        });
    }

    // When to enter or leave PiP: the reducer Tube Cleaner ships too, proven
    // and held to tests/rules/auto-pip.rule.mjs. It only closes PiP it opened
    // itself, so PiP the user entered stays open on return.
    // @gdp-begin autoPiPStep
    function autoPiPStep(config, state, event) {
        var op = event.op;
        var wantsIn = op === 'hide' && event.hideAllowed || op === 'blur' && config.blurEnters && event.hideAllowed ||
            op === 'scrollOut' && event.autoAllowed;
        var wantsOut = op === 'show' && event.focused || op === 'focus' && !event.hidden && event.focused ||
            op === 'scrollIn' && event.autoAllowed;
        var entering = wantsIn && event.playing && !event.inPiP;
        var leaving = wantsOut && state.ours && event.inPiP;
        // PiP that ended on its own (closed, or a refused request) is no
        // longer ours to close.
        var forget = op === 'left' || wantsOut && state.ours && !event.inPiP;
        return { ours: entering ? true : leaving || forget ? false : state.ours, enter: entering, exit: leaving };
    }
    // @gdp-end

    function setupAutoPiP(video) {
        if (!once(video, 'autoPiP')) { return; }
        video._wblockAutoPiPHooked = true;
        // Window focus alone cannot tell whether another window covers
        // Safari, so blur never enters PiP; tab hiding and scrolling do.
        var state = { ours: false, enter: false, exit: false };
        function send(op) {
            state = autoPiPStep({ blurEnters: false }, state, {
                op: op, autoAllowed: autoPiPEnabled, hideAllowed: autoPiPEnabled && !resumesInBackground(),
                playing: !video.paused && !video.ended, focused: document.hasFocus(), hidden: reallyHidden, inPiP: inPiP(video)
            });
            if (state.enter && !requestPiP(video, function () { send('left'); })) { send('left'); }
            if (state.exit) { leavePiP(video); }
        }
        listen(video, document, 'visibilitychange', function () { send(reallyHidden ? 'hide' : 'show'); });
        listen(video, window, 'focus', function () { send('focus'); });
        listen(video, video, 'webkitpresentationmodechanged', function () {
            if (video.webkitPresentationMode !== 'picture-in-picture') { send('left'); }
        });
        listen(video, video, 'leavepictureinpicture', function () { send('left'); });
        listen(video, window, 'pagehide', function (event) {
            if (event && event.persisted) { return; }
            attempt(function () { video.pause(); });
            if (inPiP(video)) { leavePiP(video); }
        });
        if (typeof IntersectionObserver === 'undefined') { return; }
        var observer = new IntersectionObserver(function (entries) {
            send(entries[entries.length - 1].isIntersecting ? 'scrollIn' : 'scrollOut');
        }, { threshold: 0.1 });
        observer.observe(video);
        onCleanup(video, function () { observer.disconnect(); });
    }

    // ------------------------------------------------------------------
    // Background resume (iOS)
    //
    // When Safari goes to the background, WebKit pauses a playing video with
    // sound once, just before the page reports hidden. With Background
    // Playback on, an enhanced video is played again at the hide (or on a
    // pause that lands just after it) and keeps playing in the background.
    // A pause the site made, one right after a tap or key, a Media Session
    // pause or stop, the end of the video and a pause long after hiding (the
    // lock screen's) are never undone, and nothing resumes while visible.
    // Hide-time auto PiP only takes over once WebKit refuses that play().
    //
    // Videos left to the site (ManagedMediaSource players, skipped site
    // players) get the same resume once they play, with no other changes and
    // no PiP. Decorative loops are left alone.
    //
    // backgroundResumeStep is the reducer Tube Cleaner ships too, proven and
    // held to tests/rules/background-resume.rule.mjs.
    // ------------------------------------------------------------------

    // @gdp-begin backgroundResumeStep
    function backgroundResumeStep(config, state, event) {
        var op = event.op, t = event.t;
        var system = op === 'pause' && config.enabled && !event.ended && !(t < state.pageAt + config.callGrace) &&
            !(t < state.inputAt + config.inputGrace) && !state.intent;
        var holding = system && !state.hidden;
        var clears = op === 'hide' || op === 'show' || op === 'play' || op === 'command' || op === 'input' || op === 'pageCall';
        return {
            hidden: op === 'hide' ? true : op === 'show' ? false : state.hidden,
            hiddenAt: op === 'hide' ? t : state.hiddenAt,
            pageAt: op === 'pageCall' ? t : state.pageAt,
            inputAt: op === 'input' ? t : state.inputAt,
            intent: op === 'command' ? true : op === 'play' ? false : state.intent,
            held: op === 'pause' ? holding : clears ? false : state.held,
            heldAt: holding ? t : state.heldAt,
            resume: system && state.hidden && t <= state.hiddenAt + config.window ||
                op === 'hide' && config.enabled && state.held && !state.intent && t <= state.heldAt + config.lead
        };
    }
    // @gdp-end

    var BACKGROUND_RESUME = { enabled: true, callGrace: 100, inputGrace: 1000, lead: 1200, window: 1000 };
    var pagePauseListeners = [];
    var pauseIntentListeners = [];
    var backgroundResumeRefused = false;

    function resumesInBackground() { return IS_IOS && backgroundPlaybackOn() && !backgroundResumeRefused; }

    function notify(listeners, value) {
        listeners.slice().forEach(function (listener) { attempt(function () { listener(value); }); });
    }

    // Player Cleaner's own play() and pause() calls are the user's: they lift
    // the native holds below, and a play counts like a tap on the controls.
    var ownPlay = false;
    function playOwn(video) {
        video._wblockPauseHeld = false;
        video._wblockTappedAt = performance.now();
        ownPlay = true;
        try { return video.play(); } finally { ownPlay = false; }
    }

    function pauseOwn(video) {
        video._wblockPlayHeldUntil = -Infinity;
        video.pause();
    }

    // The site's play() and pause() calls and every Media Session pause or
    // stop handler (the site's and Player Cleaner's own) are reported before
    // they run. A site play() refused by a native pause hold rejects the way
    // play() does when a pause interrupts it; a site pause() refused by a
    // native play hold does nothing.
    attempt(function () {
        var nativePause = HTMLMediaElement.prototype.pause;
        if (nativePause._wblockPlayerCleaner) { return; }
        var pause = function () {
            if (performance.now() < this._wblockPlayHeldUntil) { log('keeping a native play the site tried to undo'); return; }
            this._wblockPagePauseAt = performance.now();
            notify(pagePauseListeners, this);
            return nativePause.apply(this, arguments);
        };
        pause._wblockPlayerCleaner = true;
        HTMLMediaElement.prototype.pause = pause;
        var nativePlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            if (this._wblockPauseHeld) {
                log('keeping a native pause the site tried to undo');
                return Promise.reject(new DOMException('play() was interrupted by a native pause', 'AbortError'));
            }
            if (!ownPlay) { this._wblockPagePlayAt = performance.now(); }
            return nativePlay.apply(this, arguments);
        };
    });
    if (IS_IOS) {
        attempt(function () {
            var setActionHandler = MediaSession.prototype.setActionHandler;
            if (setActionHandler._wblockPlayerCleaner) { return; }
            var patched = function (action, handler) {
                var inner = handler;
                if ((action === 'pause' || action === 'stop') && typeof inner === 'function') {
                    handler = function () { notify(pauseIntentListeners, action); return inner.apply(this, arguments); };
                }
                return setActionHandler.call(this, action, handler);
            };
            patched._wblockPlayerCleaner = true;
            MediaSession.prototype.setActionHandler = patched;
        });
    }

    // Controlled players keep their own play state and answer a pause they
    // did not make with play(): NYT's Betamax restarts within milliseconds, so
    // the native pause button did nothing. A pause the site did not call holds
    // the video until it plays, gets a new source, or the user acts anywhere
    // else on the page (the site's own play button, a playlist). Captured, so
    // the hold is set before the site's own pause listeners on the element.
    //
    // The same players pause a play they did not start: with Betamax's own
    // play button hidden, the native one did nothing on NYT articles. A play
    // right after a tap on the video that the site did not call holds until a
    // moment after playback starts, against the site's pause() only. When the
    // site swaps the source during the hold (Betamax falls back from an AV1
    // stream the device cannot decode), the play is repeated on the new
    // source, a few times per tap at most.
    function setupPauseHold(video) {
        if (!once(video, 'pauseHold')) { return; }
        var recent = function (at, grace) { return performance.now() < (at || -Infinity) + grace; };
        var unhold = function () { video._wblockPauseHeld = false; };
        var unholdBoth = function () { unhold(); video._wblockPlayHeldUntil = -Infinity; };
        listen(video, video, 'pause', function () {
            video._wblockPlayHeldUntil = -Infinity;
            video._wblockPauseHeld = !video.ended && !recent(video._wblockPagePauseAt, BACKGROUND_RESUME.callGrace);
        }, true);
        listen(video, video, 'play', function () {
            unhold();
            video._wblockPlayHeldUntil = recent(video._wblockTappedAt, BACKGROUND_RESUME.inputGrace) &&
                !recent(video._wblockPagePlayAt, BACKGROUND_RESUME.callGrace) ? Infinity : -Infinity;
        }, true);
        listen(video, video, 'playing', function () {
            if (video._wblockPlayHeldUntil === Infinity) { video._wblockPlayHeldUntil = performance.now() + BACKGROUND_RESUME.inputGrace; }
        }, true);
        var replays = 0, pending = false;
        listen(video, video, 'emptied', function () {
            pending = performance.now() < video._wblockPlayHeldUntil && replays < 3;
            unholdBoth();
        });
        listen(video, video, 'loadstart', function () {
            unholdBoth();
            if (!pending) { return; }
            pending = false;
            replays++;
            log('repeating a native play on the swapped source');
            playOwn(video).catch(function () {});
        });
        ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (type) {
            listen(video, window, type, function (event) {
                if ((event.composedPath ? event.composedPath() : [event.target]).indexOf(video) === -1) { unholdBoth(); }
                else { video._wblockTappedAt = performance.now(); replays = 0; }
            }, true);
        });
        onCleanup(video, unholdBoth);
    }

    function setupBackgroundResume(video) {
        if (!IS_IOS || !backgroundPlaybackOn() || !once(video, 'backgroundResume')) { return; }
        var state = { hidden: reallyHidden, hiddenAt: 0, pageAt: 0, inputAt: 0, intent: false, held: false, heldAt: 0, resume: false };
        function send(op) {
            state = backgroundResumeStep(BACKGROUND_RESUME, state, { op: op, t: Math.round(performance.now()), ended: video.ended });
            if (!state.resume) { return; }
            log('resuming playback WebKit paused for the background');
            var request = attempt(function () { return playOwn(video); });
            if (request && request.catch) { request.catch(function () { log('background resume refused'); backgroundResumeRefused = true; }); }
        }
        function subscribe(list, fn) {
            list.push(fn);
            onCleanup(video, function () { var index = list.indexOf(fn); if (index !== -1) { list.splice(index, 1); } });
        }
        // Not pointerdown or touchstart: the home swipe can begin on the page
        // and ends in touchcancel, while a tap on the controls ends in these.
        ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (name) {
            listen(video, window, name, function () { send('input'); }, true);
        });
        listen(video, document, 'visibilitychange', function () { send(reallyHidden ? 'hide' : 'show'); });
        listen(video, video, 'pause', function () { send('pause'); });
        listen(video, video, 'playing', function () { send('play'); });
        subscribe(pagePauseListeners, function (element) { if (element === video) { send('pageCall'); } });
        subscribe(pauseIntentListeners, function () { send('command'); });
    }

    // ------------------------------------------------------------------
    // Playback preferences and resume position
    // ------------------------------------------------------------------

    function loadPreferences() {
        // Null media values keep the site's own state until the user first
        // changes that control in a cleaned player.
        var preferences = { playbackRate: null, volume: null, muted: null, subtitleLanguage: null, backgroundPlayback: true };
        var saved = attempt(function () { return JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}'); }) || {};
        for (var key in saved) { if (key in preferences) { preferences[key] = saved[key]; } }
        return preferences;
    }

    function savePreference(key, value) {
        attempt(function () {
            var preferences = loadPreferences();
            preferences[key] = value;
            localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
        });
    }

    function resumeIdentity(video) {
        var page = location.origin + location.pathname + location.search;
        var canonical = document.querySelector('link[rel="canonical"]');
        if (canonical && canonical.href) { page = canonical.href; }
        // Tell several players on one page apart without keeping expiring CDN
        // tokens. Opaque MSE streams fall back to the page itself.
        var source = directSource(video);
        if (!source) { return page; }
        var url = new URL(source);
        return page + '|' + url.origin + url.pathname;
    }

    function subtitleTracks(video) {
        return [].filter.call(video.textTracks || [], function (track) {
            return track.kind === 'subtitles' || track.kind === 'captions';
        });
    }

    // Caption preference decisions: pure functions proven and held to
    // tests/rules/captions.rule.mjs. WebKit turns on a <track default> by
    // itself, sometimes repeatedly while it loads; that is the page's choice,
    // not the user's, and so is a default track switching on right after it
    // appears. Keep them self-contained; the test evaluates their source.
    // @gdp-begin captionChoiceStep
    function captionChoiceStep(config, state, event) {
        var change = event.op === 'change';
        var automatic = change && event.showing === 'default' && !(event.active && state.seenAt + config.settle < event.t);
        var saves = change && !automatic;
        return {
            seenAt: event.op === 'tracks' ? event.t : state.seenAt,
            revert: automatic,
            save: saves,
            saveOff: saves && event.showing === 'none',
            savedLang: saves && event.showing !== 'none' ? event.lang : 0
        };
    }
    // @gdp-end

    // Without a saved preference the page decides; otherwise only the saved
    // language shows.
    // @gdp-begin subtitleModeFor
    function subtitleModeFor(event) {
        return { touch: event.known, show: event.known && !event.off && event.prefLang === event.trackLang };
    }
    // @gdp-end

    function setupPreferences(video) {
        if (!once(video, 'preferences')) { return; }
        var preferences = loadPreferences();
        var applying = true;
        if (preferences.playbackRate > 0) { video.playbackRate = Math.max(0.25, Math.min(4, preferences.playbackRate)); }
        if (typeof preferences.volume === 'number') { video.volume = Math.max(0, Math.min(1, preferences.volume)); }
        if (typeof preferences.muted === 'boolean') { video.muted = preferences.muted; }
        setTimeout(function () { applying = false; }, 0);

        function applySubtitles() {
            var language = loadPreferences().subtitleLanguage;
            subtitleTracks(video).forEach(function (track) {
                var mode = subtitleModeFor({ known: language !== null, off: !language, prefLang: language, trackLang: track.language });
                if (mode.touch) { attempt(function () { track.mode = mode.show ? 'showing' : 'disabled'; }); }
            });
        }

        var identity = null, restored = false, lastSave = 0;
        function syncIdentity() {
            var next = resumeIdentity(video);
            if (next !== identity) { identity = next; restored = false; lastSave = 0; }
        }
        function restore() {
            syncIdentity();
            applySubtitles();
            if (restored || !isFinite(video.duration) || video.duration < 60) { return; }
            restored = true;
            var entries = attempt(function () { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'); }) || {};
            var position = Number(entries[identity] || 0);
            if (position > 10 && position < video.duration - 15) { video.currentTime = position; }
        }
        function save(force) {
            syncIdentity();
            var now = Date.now();
            if (!force && now - lastSave < 5000) { return; }
            lastSave = now;
            attempt(function () {
                var entries = JSON.parse(localStorage.getItem(RESUME_KEY) || '{}');
                if (video.ended || video.currentTime >= video.duration - 10) { delete entries[identity]; }
                else if (video.currentTime > 10 && isFinite(video.duration) && video.duration >= 60) { entries[identity] = Math.floor(video.currentTime); }
                var keys = Object.keys(entries);
                while (keys.length > 50) { delete entries[keys.shift()]; }
                localStorage.setItem(RESUME_KEY, JSON.stringify(entries));
            });
        }

        var captions = { seenAt: Date.now(), revert: false, save: false, saveOff: false, savedLang: 0 };
        function sendCaptions(op, showing) {
            var isDefault = !!showing && [].some.call(video.querySelectorAll('track[default]'), function (el) { return el.track === showing; });
            var activation = navigator.userActivation;
            captions = captionChoiceStep({ settle: 3000 }, captions, {
                op: op, t: Date.now(), showing: !showing ? 'none' : isDefault ? 'default' : 'other',
                lang: showing ? showing.language || '' : '', active: !!(activation && activation.isActive)
            });
            if (captions.revert) { applySubtitles(); }
            else if (captions.save) { savePreference('subtitleLanguage', captions.saveOff ? '' : captions.savedLang); }
        }
        function onTrackChange() {
            sendCaptions('change', subtitleTracks(video).filter(function (track) { return track.mode === 'showing'; })[0]);
        }

        listen(video, video, 'loadedmetadata', restore);
        listen(video, video, 'durationchange', restore);
        listen(video, video, 'ratechange', function () { if (!applying) { savePreference('playbackRate', video.playbackRate); } });
        listen(video, video, 'volumechange', function () {
            if (applying) { return; }
            savePreference('volume', video.volume);
            savePreference('muted', video.muted);
        });
        listen(video, video, 'timeupdate', function () { save(false); });
        listen(video, video, 'pause', function () { save(true); });
        listen(video, video, 'ended', function () { save(true); });
        if (video.textTracks) {
            listen(video, video.textTracks, 'addtrack', function () { sendCaptions('tracks', null); });
            listen(video, video.textTracks, 'change', onTrackChange);
        }
        onCleanup(video, function () { save(true); });
        restore();
    }

    // ------------------------------------------------------------------
    // Sidecar subtitle and chapter tracks
    // ------------------------------------------------------------------

    function absoluteUrl(value) {
        if (typeof value !== 'string' || !value.trim()) { return null; }
        var url = attempt(function () { return new URL(value.trim(), document.baseURI).href; });
        return url && /^https?:\/\//i.test(url) ? url : null;
    }

    // Sidecar files often carry the language only in their name
    // (Reddit's wh_ben_en.vtt, subs.de.vtt).
    function languageFromUrl(url) {
        var match = attempt(function () { return new URL(url).pathname.match(/[._-]([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(?:vtt|srt)$/i); });
        return match ? match[1] : '';
    }

    function languageName(language) {
        if (!language) { return ''; }
        return attempt(function () { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(language); }) || language;
    }

    function addTrack(video, definition) {
        if (!definition) { return; }
        var url = absoluteUrl(definition.src || definition.file || definition.url);
        var kind = String(definition.kind || 'subtitles').toLowerCase();
        if (kind === 'captions') { kind = 'subtitles'; }
        if (!url || ['subtitles', 'chapters', 'descriptions'].indexOf(kind) === -1) { return; }
        var exists = [].some.call(video.querySelectorAll('track'), function (el) {
            return el.src === url || el.getAttribute('data-wblock-src') === url;
        });
        if (exists) { return; }
        var language = definition.srclang || definition.language || languageFromUrl(url);
        var track = document.createElement('track');
        track.kind = kind;
        track.setAttribute('data-wblock-src', url);
        track.label = definition.label || definition.name || languageName(language) || kind;
        if (language) { track.srclang = language; }
        if (definition.default) { track.default = true; }
        video.appendChild(track);
        // WebKit refuses a cross-origin <track> unless the video is in CORS
        // mode, and switching the video would refetch (and can break) the
        // media itself. Fetch the cues instead and hand over a same-origin blob.
        var crossOrigin = /^https?:$/.test(location.protocol) && !video.hasAttribute('crossorigin') &&
            new URL(url).origin !== location.origin;
        if (!crossOrigin) { track.src = url; return; }
        fetch(url, { mode: 'cors', credentials: 'omit' })
            .then(function (response) { if (!response.ok) { throw new Error(); } return response.text(); })
            .then(function (text) { track.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' })); })
            .catch(function () { track.src = url; });
    }

    function harvestTracks(container, video) {
        var add = function (definition) { addTrack(video, definition); };
        attempt(function () {
            [].forEach.call(container.querySelectorAll('track[src]'), function (el) {
                if (el.parentNode !== video) { add({ src: el.src, kind: el.kind, label: el.label, srclang: el.srclang, default: el.default }); }
            });
        });
        [container, video].forEach(function (el) {
            var value = el.getAttribute && (el.getAttribute('data-subtitles') || el.getAttribute('data-captions') ||
                el.getAttribute('data-tracks') || el.getAttribute('caption-url'));
            if (!value) { return; }
            var parsed = /^[\[{]/.test(value) ? attempt(function () { return JSON.parse(value); }) : { src: value };
            [].concat(parsed || []).forEach(add);
        });
        attempt(function () {
            var jw = window.jwplayer && window.jwplayer(container.id || container);
            if (jw && jw.getCaptions) { [].concat(jw.getCaptions() || []).forEach(add); }
            var item = jw && jw.getPlaylistItem && jw.getPlaylistItem();
            [].concat(item && item.tracks || []).forEach(add);
        });
        attempt(function () {
            var players = window.videojs && window.videojs.getPlayers ? window.videojs.getPlayers() : {};
            for (var id in players) {
                var player = players[id];
                var el = player && player.el && player.el();
                if (!el || !related(el, container)) { continue; }
                var source = player.currentSource && player.currentSource();
                [].concat(source && source.tracks || player.options_ && player.options_.tracks || []).forEach(add);
                var remote = player.remoteTextTracks && player.remoteTextTracks();
                for (var r = 0; remote && r < remote.length; r++) { add(remote[r]); }
            }
        });
    }

    function setupTracks(container, video) {
        harvestTracks(container, video);
        if (video.textTracks && once(video, 'tracks')) {
            listen(video, video.textTracks, 'addtrack', function () { harvestTracks(container, video); });
        }
    }

    // ------------------------------------------------------------------
    // Keyboard shortcuts
    // ------------------------------------------------------------------

    function showToast(video, text) {
        var parent = video.parentNode || document.body;
        var toast = parent.querySelector && parent.querySelector('.wblock-pc-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'wblock-pc-toast';
            toast.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);' +
                'background:rgba(0,0,0,.85);color:#fff;padding:6px 14px;border-radius:16px;' +
                'font:600 13px -apple-system,system-ui,sans-serif;pointer-events:none;z-index:2147483647';
            parent.appendChild(toast);
        }
        toast.textContent = text;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { toast.remove(); }, 1200);
    }

    function isEditing(el) {
        if (!el) { return false; }
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) { return true; }
        return !!(el.shadowRoot && isEditing(el.shadowRoot.activeElement));
    }

    function setRate(video, rate) {
        rate = Math.max(0.25, Math.min(4, Math.round(rate * 100) / 100));
        video.playbackRate = rate;
        savePreference('playbackRate', rate);
        showToast(video, rate.toFixed(2) + 'x');
    }

    function seek(video, time) {
        video.currentTime = Math.max(0, Math.min(video.duration || Infinity, time));
    }

    function setupShortcuts(container, video) {
        if (!once(video, 'shortcuts')) { return; }
        // YouTube's layout: [ ] or < > speed, = reset, f fullscreen, p PiP,
        // m mute, k play, j l and arrows seek, 0-9 jump to that tenth, and
        // , . step one frame while paused.
        listen(video, container, 'keydown', function (event) {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) { return; }
            if (isEditing(document.activeElement)) { return; }
            var key = event.key;
            var handled = true;
            if (key === '[' || key === '{' || key === '<') { setRate(video, video.playbackRate - 0.25); }
            else if (key === ']' || key === '}' || key === '>') { setRate(video, video.playbackRate + 0.25); }
            else if (key === '=' || key === '+') { setRate(video, 1); }
            else if (/^[0-9]$/.test(key) && video.duration > 0 && isFinite(video.duration)) { video.currentTime = video.duration * Number(key) / 10; }
            else if ((key === ',' || key === '.') && video.paused) { seek(video, video.currentTime + (key === '.' ? 1 : -1) / 30); }
            else if (key === 'j' || key === 'J' || key === 'ArrowLeft') { seek(video, video.currentTime - 5); showToast(video, '-5s'); }
            else if (key === 'l' || key === 'L' || key === 'ArrowRight') { seek(video, video.currentTime + 5); showToast(video, '+5s'); }
            else if (key === 'k' || key === 'K') { if (video.paused) { playOwn(video).catch(function () {}); } else { pauseOwn(video); } }
            else if (key === 'm' || key === 'M') { video.muted = !video.muted; showToast(video, video.muted ? 'Muted' : 'Unmuted'); }
            else if (key === 'p' || key === 'P') { if (inPiP(video)) { leavePiP(video); } else { requestPiP(video, function () {}); } }
            else if (key === 'f' || key === 'F') { toggleFullscreen(video); }
            else { handled = false; }
            if (handled) { event.preventDefault(); }
        }, true);
    }

    function toggleFullscreen(video) {
        attempt(function () {
            if (document.fullscreenElement === video || document.webkitFullscreenElement === video) {
                (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            } else {
                (video.requestFullscreen || video.webkitRequestFullscreen || video.webkitEnterFullscreen).call(video);
            }
        });
    }

    // ------------------------------------------------------------------
    // Now Playing
    // ------------------------------------------------------------------

    var mediaSessionOwner = null;

    function meta(name) {
        var el = document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]');
        return el && el.content || '';
    }

    // Feed pages carry many players under one page title. When the player
    // host describes its own item (Reddit), Now Playing names that item.
    function nowPlaying(container, video) {
        var player = closest(video, 'shreddit-player,shreddit-player-2') || container;
        var attr = function (name) { return player && player.getAttribute && player.getAttribute(name) || ''; };
        var subreddit = attr('subreddit-name');
        var data = {
            title: attr('post-title') || meta('og:title') || document.title || host,
            artist: subreddit ? 'r/' + subreddit : meta('og:site_name') || host
        };
        var artwork = video.poster || absoluteUrl(attr('poster')) || meta('og:image');
        if (artwork) { data.artwork = [{ src: artwork }]; }
        return data;
    }

    function clearMediaSession(video) {
        var state = stateOf(video);
        (state.mediaActions || []).forEach(function (action) {
            attempt(function () { navigator.mediaSession.setActionHandler(action, null); });
        });
        if (state.mediaMetadata && navigator.mediaSession.metadata === state.mediaMetadata) {
            navigator.mediaSession.metadata = null;
        }
        state.mediaActions = state.mediaMetadata = null;
    }

    function setupMediaSession(container, video) {
        if (!navigator.mediaSession || typeof MediaMetadata === 'undefined' || !once(video, 'mediaSession')) { return; }
        function activate() {
            if (mediaSessionOwner && mediaSessionOwner !== video) { clearMediaSession(mediaSessionOwner); }
            mediaSessionOwner = video;
            var state = stateOf(video);
            attempt(function () {
                state.mediaMetadata = new MediaMetadata(nowPlaying(container, video));
                navigator.mediaSession.metadata = state.mediaMetadata;
            });
            var actions = {
                play: function () { playOwn(video).catch(function () {}); },
                pause: function () { pauseOwn(video); },
                seekbackward: function (d) { seek(video, video.currentTime - (d.seekOffset || 10)); },
                seekforward: function (d) { seek(video, video.currentTime + (d.seekOffset || 10)); },
                seekto: function (d) { if (isFinite(d.seekTime)) { video.currentTime = d.seekTime; } }
            };
            attempt(function () {
                var jw = window.jwplayer && window.jwplayer(container.id || container);
                var playlist = jw && jw.getPlaylist && jw.getPlaylist();
                if (playlist && playlist.length > 1) {
                    actions.previoustrack = function () { jw.playlistItem(Math.max(0, jw.getPlaylistIndex() - 1)); };
                    actions.nexttrack = function () { jw.playlistItem(Math.min(playlist.length - 1, jw.getPlaylistIndex() + 1)); };
                }
            });
            state.mediaActions = Object.keys(actions);
            for (var action in actions) {
                attempt(function () { navigator.mediaSession.setActionHandler(action, actions[action]); });
            }
        }
        function updatePosition() {
            if (mediaSessionOwner !== video || !navigator.mediaSession.setPositionState) { return; }
            if (!(isFinite(video.duration) && video.duration > 0)) { return; }
            attempt(function () {
                navigator.mediaSession.setPositionState({ duration: video.duration, playbackRate: video.playbackRate || 1,
                    position: Math.max(0, Math.min(video.currentTime, video.duration)) });
            });
        }
        listen(video, video, 'play', activate);
        listen(video, video, 'timeupdate', updatePosition);
        listen(video, video, 'ratechange', updatePosition);
        onCleanup(video, function () {
            if (mediaSessionOwner === video) { mediaSessionOwner = null; clearMediaSession(video); }
        });
        if (!video.paused) { activate(); }
    }

    // ------------------------------------------------------------------
    // Media source state
    // ------------------------------------------------------------------

    function isPlayable(url) {
        // Safari cannot play DASH manifests natively.
        return !!url && /^https?:\/\//i.test(url) && !/\.mpd(?:$|[?#])/i.test(url);
    }

    // The http(s) file the element itself plays, if any.
    function directSource(video) {
        if (isPlayable(video.currentSrc)) { return video.currentSrc; }
        if (isPlayable(video.src)) { return video.src; }
        var sources = video.getElementsByTagName('source');
        for (var i = 0; i < sources.length; i++) {
            if (/dash/i.test(sources[i].type)) { continue; }
            var url = absoluteUrl(sources[i].getAttribute('src'));
            if (isPlayable(url)) { return url; }
        }
        return null;
    }

    // On iOS a declared <source> only counts once the browser selected it:
    // players often list a fallback file and then attach an MSE blob.
    function playsDirect(video) {
        if (!IS_IOS) { return !!directSource(video); }
        return isPlayable(video.currentSrc) ||
            !video.currentSrc && isPlayable(absoluteUrl(video.getAttribute('src')));
    }

    // A MediaSource / ManagedMediaSource pipeline the page owns.
    function isOpaque(video) {
        if (video._wblockIOSNativeSrc && video.src === video._wblockIOSNativeSrc) { return false; }
        return !!video.srcObject || /^blob:/.test(video.currentSrc || '') || /^blob:/.test(video.src || '');
    }

    function hasSource(video) {
        return !!(video.srcObject || video.currentSrc || video.getAttribute('src') ||
            [].some.call(video.getElementsByTagName('source'), function (s) { return s.getAttribute('src'); }));
    }

    // CNN's Bolt primes pooled elements with a short data: clip to unlock
    // later playback. That primer is never the content.
    function isPrimer(video) {
        return !video.srcObject && /^data:/.test(video.currentSrc || video.src || '');
    }

    function isLiveStream(video) {
        var stream = video.srcObject;
        return !!stream && (typeof MediaStream !== 'undefined' && stream instanceof MediaStream ||
            typeof stream.getTracks === 'function');
    }

    function isDeclaredAudio(video) {
        var types = [].map.call(video.getElementsByTagName('source'), function (s) { return (s.type || '').toLowerCase(); });
        return types.some(function (t) { return t.indexOf('audio/') === 0; }) &&
            !types.some(function (t) { return t.indexOf('video/') === 0; });
    }

    // A looping clip without controls that plays no sound is a GIF stand-in
    // (chat and feed GIFs, a splash animation), not a player. Until metadata
    // says whether it has sound, wait. With no track info, a short muted
    // loop counts. Unmuting it (a site sound button) makes it a player.
    function isDecorative(video) {
        if (video._wblockChosen || video.controls || !video.loop) { return false; }
        if (video.readyState < 1) { return true; }
        var audible = video.audioTracks ? video.audioTracks.length > 0 : video.mozHasAudio;
        if (typeof audible === 'boolean') { return !audible; }
        return video.muted && video.duration <= 30;
    }

    // ------------------------------------------------------------------
    // iOS: native playback of the site's own stream
    //
    // iOS WebKit rejects a ManagedMediaSource attachment once native controls
    // are on, so an MSE player is left to the site unless the real HLS/MP4 URL
    // can be found and played directly.
    // ------------------------------------------------------------------

    var MEDIA_PATH = /\.(m3u8|mp4|m4v|mov|webm)$/i;

    function mediaUrl(values) {
        for (var i = 0; i < values.length; i++) {
            var value = values[i];
            if (Array.isArray(value)) { value = mediaUrl(value); }
            else if (value && typeof value === 'object') { value = value.src || value.href || value.url || value.file || value.full_url; }
            var url = absoluteUrl(value);
            if (isPlayable(url) && MEDIA_PATH.test(new URL(url).pathname)) { return url; }
        }
        return null;
    }

    // Hearst lists progressive MP4 renditions; take the tallest.
    function tallestRendition(list) {
        var best = null, bestHeight = -1;
        [].concat(list || []).forEach(function (item) {
            var url = mediaUrl([item]);
            var height = url && +(url.match(/(\d{3,4})p(?=[_.\/-])/) || [0, 0])[1];
            if (url && height > bestHeight) { best = url; bestHeight = height; }
        });
        return best;
    }

    // React components (video.js v10, Media Chrome, Hearst) keep the real URL
    // in props while the element only has a blob.
    function reactSource(el) {
        if (!el) { return null; }
        var fiber = null;
        var keys = Object.keys(el);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('__reactProps') === 0) {
                var direct = mediaUrl([el[keys[i]] && el[keys[i]].src, el[keys[i]]]);
                if (direct) { return direct; }
            }
            if (!fiber && /^__react(Fiber|InternalInstance)/.test(keys[i])) { fiber = el[keys[i]]; }
        }
        for (var depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
            var props = fiber.memoizedProps || fiber.pendingProps;
            var found = mediaUrl([fiber.memoizedProps, fiber.pendingProps]) ||
                props && (mediaUrl([props.src, props.source, props.hls, props.file, props.sources]) ||
                    tallestRendition(props.video && props.video.transcodings));
            if (found) { return found; }
        }
        return null;
    }

    // Web components (Reddit's <shreddit-player>) keep the HLS URL on the
    // host's src attribute while the shadow <video> gets an MSE blob.
    function hostSource(video, container) {
        for (var el = parentOf(video); el && el.nodeType !== 9; el = parentOf(el)) {
            if (el.nodeType === 1 && el.tagName.indexOf('-') !== -1) {
                var url = mediaUrl([el.getAttribute('src')]);
                if (url) { return url; }
            }
            if (el === container) { break; }
        }
        return null;
    }

    function setNativeSource(video, url) {
        // One assignment, no empty-src detach: that intermediate load fires
        // emptied/error into the site player, which then rebuilds itself.
        attempt(function () { video.pause(); });
        if (video.srcObject) { video.srcObject = null; }
        [].slice.call(video.getElementsByTagName('source')).forEach(function (s) { s.remove(); });
        video.src = url;
        video._wblockIOSNativeSrc = url;
        attempt(function () { video.load(); });
    }

    // Every return of the site's blob comes back through consider (on
    // loadstart): a cached reload finishing its setup after the swap, or a
    // feed (Reddit) reattaching a post it unloaded. Re-promote a few times,
    // then let a site that keeps attaching its own pipeline have the element.
    function promoteNativeSource(video, container) {
        if (!IS_IOS || closest(video, HANDSHAKE_SELECTOR) || !isOpaque(video) && (playsDirect(video) || !hasSource(video))) { return false; }
        var url = hostSource(video, container) || reactSource(video) || reactSource(container);
        if (!url) { return false; }
        if (video._wblockIOSNativeSrc) {
            if ((video._wblockIOSNativeRetries || 0) >= 4) { return false; }
            video._wblockIOSNativeRetries = (video._wblockIOSNativeRetries || 0) + 1;
            log('reasserting native source', url);
        }
        setNativeSource(video, url);
        return true;
    }

    // ------------------------------------------------------------------
    // Native controls
    // ------------------------------------------------------------------

    // Custom players set disableRemotePlayback to hide the AirPlay picker
    // they cannot style. Lift it for a direct file, but never on iOS: there a
    // ManagedMediaSource attachment only loads while remote playback stays
    // denied, and an element without a direct file may still get one.
    function applyRemotePlaybackPolicy(video) {
        if (IS_IOS) {
            if (!directSource(video) || isOpaque(video) || closest(video, HANDSHAKE_SELECTOR)) {
                if (!video.disableRemotePlayback) { video.disableRemotePlayback = true; }
                if (!video.hasAttribute('disableremoteplayback')) { video.setAttribute('disableremoteplayback', ''); }
                if (video.getAttribute('x-webkit-airplay') !== 'deny') { video.setAttribute('x-webkit-airplay', 'deny'); }
            }
        } else if (directSource(video) && !isOpaque(video) && video.hasAttribute('disableremoteplayback')) {
            video.removeAttribute('disableremoteplayback');
            video.disableRemotePlayback = false;
        }
    }

    function restoreNativeControls(video) {
        applyRemotePlaybackPolicy(video);
        if (!video.hasAttribute('controls')) { video.setAttribute('controls', ''); }
        // THEOplayer pins pointer-events:none on the video so its overlay
        // owns every hit, which leaves native controls painted but dead.
        if (attempt(function () { return getComputedStyle(video).pointerEvents; }) === 'none') {
            video.style.setProperty('pointer-events', 'auto', 'important');
        }
    }

    function enableNativeControls(video) {
        if (!once(video, 'controls')) { return; }
        // Lock remote playback before controls exist: WebKit builds the
        // AirPlay picker from this write.
        restoreNativeControls(video);
        video.controls = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.removeAttribute('disablepictureinpicture');
        video.disablePictureInPicture = false;
        video.removeAttribute('disabled');
        // Custom players keep stripping these attributes; restore them at the
        // pre-paint microtask checkpoint. Shadowing the controls property
        // itself would break WebKit's native controls.
        var observer = new MutationObserver(function () { restoreNativeControls(video); });
        observer.observe(video, { attributes: true, attributeFilter: ['controls', 'disableremoteplayback', 'x-webkit-airplay', 'style'] });
        onCleanup(video, function () { observer.disconnect(); });
        // Native control hits must not reach the site's tap-to-toggle, or it
        // undoes the native button. Clicks are stopped while capturing at the
        // video, ahead of the element's own listeners: Reddit's feed player
        // toggles from a click listener on the video itself and replays a
        // pause with its volume reset. The native controls act on pointer
        // and touch events, so those are only stopped as they bubble out.
        ['click', 'dblclick'].forEach(function (type) {
            listen(video, video, type, function (event) { event.stopImmediatePropagation(); }, true);
        });
        ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(function (type) {
            listen(video, video, type, function (event) { event.stopPropagation(); });
        });
    }

    // ------------------------------------------------------------------
    // Chrome hiding
    // ------------------------------------------------------------------

    function ensureHideStyle() {
        if (document.getElementById('wblock-pc-hide')) { return; }
        var style = document.createElement('style');
        style.id = 'wblock-pc-hide';
        style.textContent = '[' + HIDDEN_ATTR + ']{display:none!important;visibility:hidden!important;pointer-events:none!important}';
        (document.head || document.documentElement).appendChild(style);
    }

    function isTextEditing(el) {
        if (el.tagName === 'TEXTAREA' || /^(textbox|searchbox)$/i.test(el.getAttribute('role') || '')) { return true; }
        if (el.isContentEditable && String(el.getAttribute('contenteditable')).toLowerCase() !== 'false') { return true; }
        return el.tagName === 'INPUT' && /^(|text|search|email|url|password|tel)$/i.test(el.getAttribute('type') || '');
    }

    // Elements that must never be hidden as chrome, together with their
    // subtree: other media, embeds, text fields (Discord's composer), and
    // ad, error and paywall UI. A header or nav protects page chrome, but
    // not when it is the region holding the whole player (videojs.org).
    function isProtected(el, video) {
        var tag = el.tagName;
        if (/^(VIDEO|AUDIO|IFRAME|SOURCE|TRACK|STYLE|LINK|SCRIPT|SLOT|META|TEMPLATE)$/.test(tag)) { return true; }
        var region = closest(el, 'header,nav,[role="banner"],[role="navigation"]');
        if (region && !contains(region, video)) { return true; }
        if (isTextEditing(el) || closest(el, PROTECTED_SELECTOR) || el.querySelector('video,iframe')) { return true; }
        var inner = el.querySelectorAll('textarea,input,[contenteditable],[role="textbox"],[role="searchbox"],' + PROTECTED_SELECTOR);
        return [].some.call(inner, function (node) {
            return node.matches(PROTECTED_SELECTOR) ? node.offsetWidth > 0 && node.offsetHeight > 0 : isTextEditing(node);
        });
    }

    var hidingFor = null;

    function hide(el) {
        if (hidingFor && hidingFor.hidden.indexOf(el) === -1) { hidingFor.hidden.push(el); }
        if (el.getAttribute(HIDDEN_ATTR) === '1' && el.style.display === 'none') { return; }
        ensureHideStyle();
        el.setAttribute(HIDDEN_ATTR, '1');
        // Inline !important as well: design systems re-assert display with
        // their own !important rules.
        el.style.setProperty('display', 'none', 'important');
    }

    function isHidden(node) { return !!closest(node, '[' + HIDDEN_ATTR + ']'); }

    // The player's own box: a library wrapper, else the nearest positioned
    // ancestor (custom players hang their chrome off a positioning context),
    // else the parent.
    function containerOf(video) {
        var known = closest(parentOf(video), PLAYER_SELECTOR);
        if (known) {
            // Climb to the outermost wrapper of the same player.
            for (var outer = closest(parentOf(known), PLAYER_SELECTOR); outer; outer = closest(parentOf(outer), PLAYER_SELECTOR)) {
                var box = rectOf(outer), inner = rectOf(known);
                if (!box || !inner || box.height > inner.height * 1.6 + 160) { break; }
                known = outer;
            }
            return known;
        }
        for (var el = parentOf(video); el && el.nodeType !== 9 && el !== document.body && el !== document.documentElement; el = parentOf(el)) {
            if (el.nodeType === 1 && positioned(el)) { return el; }
        }
        return video.parentElement || parentOf(video);
    }

    // The outermost ancestor still bounded by the video's size. A control bar
    // pinned to the player's edge can sit there, outside the container. The
    // size bound stops before post text and reactions in a feed card.
    function shellOf(video) {
        var vr = rectOf(video);
        var shell = parentOf(video);
        if (!vr || vr.width < 2 || vr.height < 2) { return shell; }
        for (var el = shell; el && el.nodeType !== 9 && el !== document.body && el !== document.documentElement; el = parentOf(el)) {
            if (el.nodeType === 1 && !playerSized(el, vr)) { break; }
            shell = el;
        }
        return shell;
    }

    function playerSized(el, vr) {
        var r = vr && rectOf(el);
        return !!r && r.height <= vr.height * 1.7 + 160 && r.width <= vr.width * 1.35 + 48;
    }

    function overlaps(r, vr) {
        var x = Math.min(r.right, vr.right + 8) - Math.max(r.left, vr.left - 8);
        var y = Math.min(r.bottom, vr.bottom + 72) - Math.max(r.top, vr.top - 8);
        return x >= 4 && y >= 4;
    }

    // Is `el` chrome drawn over the video? Positioned overlays that sit on
    // the video count. In-flow elements count only when they hold controls
    // and little text, and cover the video (LinkedIn's end card) or form a
    // bar across its top or bottom (LinkedIn controls); page text that
    // happens to overlap a hero video never does. Page-sized boxes never count.
    function coversVideo(el, vr) {
        var r = rectOf(el);
        if (!r || r.width < 2 || r.height < 2 || !overlaps(r, vr)) { return false; }
        if (r.height > vr.height * 1.55 + 48 && r.width > vr.width * 0.85) { return false; }
        if (r.width > innerWidth * 0.9 && r.height > innerHeight * 0.45 && !(r.width <= vr.width * 1.2 + 8 && r.height <= vr.height * 1.2 + 8)) { return false; }
        if (overlay(el)) { return true; }
        if (!el.querySelector('button,[role="button"],[role="slider"],input') ||
            (el.textContent || '').trim().length > 80) { return false; }
        var ix = Math.min(r.right, vr.right) - Math.max(r.left, vr.left);
        var iy = Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top);
        if (ix < 4 || iy < 4) { return false; }
        if (ix * iy >= vr.width * vr.height * 0.55) { return true; }
        var middle = (r.top + r.bottom) / 2;
        return r.height <= vr.height * 0.4 + 24 && ix >= vr.width * 0.5 &&
            (middle >= vr.bottom - vr.height * 0.4 || middle <= vr.top + vr.height * 0.4);
    }

    // Walk a subtree hiding chrome. `everything` hides every element that is
    // not an ancestor of the video (inside a known or positioned player box);
    // otherwise only elements drawn over the video are hidden. A hidden
    // element hides its subtree, so the walk stops there.
    function sweep(root, video, vr, everything) {
        var kids = root.children || [];
        for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (el === video) { continue; }
            if (el.hasAttribute(HIDDEN_ATTR)) { hide(el); continue; }
            var ancestor = contains(el, video);
            if (!ancestor) {
                if (isProtected(el, video)) { continue; }
                if (everything) { hide(el); continue; }
                // Fixed elements are not part of the player box; like portals
                // they count only when they sit on the video.
                var fixed = attempt(function () { return getComputedStyle(el).position; }) === 'fixed';
                if (vr && coversVideo(el, vr) && (!fixed || mostlyInside(el, vr))) { hide(el); continue; }
                if (fixed) { continue; }
            }
            sweep(el, video, vr, everything);
            // Another component's shadow tree (a menu, a sheet) is its own
            // business unless it belongs to the player itself.
            if (el.shadowRoot && (everything || ancestor)) { sweep(el.shadowRoot, video, vr, everything); }
        }
    }

    // Overlays mounted outside the player (portals, fixed bars) are found by
    // what is painted on top of the video's pixels.
    function hitTest(video, vr) {
        if (vr.bottom < 0 || vr.right < 0 || vr.top > innerHeight || vr.left > innerWidth) { return; }
        var points = [[0.5, 0.5], [0.06, 0.1], [0.94, 0.1], [0.5, 0.06], [0.5, 0.94], [0.06, 0.94], [0.94, 0.94]];
        points.forEach(function (p) {
            var x = vr.left + vr.width * p[0], y = vr.top + vr.height * p[1];
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) { return; }
            var stack = attempt(function () { return document.elementsFromPoint(x, y); }) || [];
            // A point the video doesn't paint (cut off by a scroller) holds
            // page UI next to it, such as a pager below search results.
            if (!stack.some(function (hit) { return hit === video || !!hit.shadowRoot && contains(hit.shadowRoot, video); })) { return; }
            for (var i = 0; i < stack.length && stack[i] !== video; i++) {
                var hit = stack[i];
                // WebKit often reports a shadow host instead of the overlay
                // inside it; sweep that shadow tree for overlays instead.
                if (contains(hit, video)) {
                    if (hit.shadowRoot) { sweep(hit.shadowRoot, video, vr, false); }
                    break;
                }
                if (hit === document.body || hit === document.documentElement || isProtected(hit, video)) { continue; }
                if (coversVideo(hit, vr) && (inPlayerBox(hit, video, vr) || mostlyInside(hit, vr))) { hide(hit); }
            }
        });
        // Portals live at body level; check those boxes geometrically too.
        [].forEach.call(document.body ? document.body.children : [], function (top) {
            if (contains(top, video) || isProtected(top, video)) { return; }
            if (overlay(top) && coversVideo(top, vr) && mostlyInside(top, vr)) { hide(top); }
        });
    }

    // In-flow chrome shares a player-sized box with the video. Page content
    // scrolling over a parallax hero only meets it at the page level.
    function inPlayerBox(el, video, vr) {
        var common = parentOf(el);
        while (common && !contains(common, video)) { common = parentOf(common); }
        if (!common || common === document.body || common === document.documentElement || common.nodeType === 9) { return false; }
        var r = rectOf(common);
        return !!r && r.height <= vr.height * 1.55 + 48;
    }

    // Detached chrome (portals, fixed bars) sits on the video. A site's own
    // fixed UI (bottom sheets, banners) only overlaps it in passing.
    function mostlyInside(el, vr) {
        var r = rectOf(el);
        if (!r) { return false; }
        var ix = Math.max(0, Math.min(r.right, vr.right) - Math.max(r.left, vr.left));
        var iy = Math.max(0, Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top));
        return ix * iy >= r.width * r.height * 0.6;
    }

    // Native controls sit on the video element's own bottom edge. Players
    // often clip a taller video to a shorter box (videojs.org: a 16:9 video
    // with object-fit: cover in a 2:1 box), which cuts that edge off. Fit
    // the element to the visible box; object-fit keeps the picture the same.
    function fitToClip(video, vr) {
        var container = containerOf(video);
        var clip = null;
        for (var el = parentOf(video); el && el.nodeType === 1; el = parentOf(el)) {
            var overflow = attempt(function () { return getComputedStyle(el).overflowY; });
            // Only a player box that crops, never a scroll container.
            if (overflow === 'hidden' || overflow === 'clip') { clip = el; break; }
            if (el === container) { break; }
        }
        var cr = clip && rectOf(clip);
        if (!cr || cr.height < vr.height * 0.5 || vr.top < cr.top - 1 || vr.bottom <= cr.bottom + 1) { return; }
        video.style.setProperty('height', clip === parentOf(video) ? '100%' : cr.height + 'px', 'important');
        video.style.setProperty('max-height', cr.height + 'px', 'important');
    }

    // Inline players can leave html/body locked by a stale fullscreen class.
    function releaseScrollLock(video) {
        if (video._wblockInNativeFullscreen || document.fullscreenElement || document.webkitFullscreenElement) { return; }
        [document.documentElement, document.body].forEach(function (el) {
            if (!el || !/fullscreen/i.test(el.className || '')) { return; }
            el.className.split(/\s+/).forEach(function (name) {
                if (/fullscreen|no-?scroll/i.test(name)) { el.classList.remove(name); }
            });
            if (el.style.overflow === 'hidden') { el.style.removeProperty('overflow'); }
            if (el.style.position === 'fixed') { el.style.removeProperty('position'); }
        });
    }

    // Is the player currently showing an ad? Its chrome (Skip Ad) must stay.
    function adShowing(video) {
        var shell = closest(video, PLAYER_SELECTOR);
        if (!shell) { return false; }
        if (/\b(amp-ads?|ad-showing|vjs-ad-playing)\b/.test(shell.className || '')) { return true; }
        return [].some.call(shell.querySelectorAll('.amp-ads,.amp-ad,.fw-ad,[class*="amp-ad-"],button,[role="button"]'), function (el) {
            var visible = el.offsetWidth > 8 && el.offsetHeight > 8 && getComputedStyle(el).visibility !== 'hidden';
            return visible && (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button' ||
                /skip\s*ad/i.test(el.textContent + ' ' + (el.getAttribute('aria-label') || '')));
        });
    }

    function hideChrome(video) {
        if (!video.isConnected || adShowing(video)) { return; }
        var state = stateOf(video);
        state.hidden = state.hidden || [];
        hidingFor = state;
        try { hideChromeNow(video); } finally { hidingFor = null; }
        adoptPoster(video, state.hidden);
    }

    // Custom players paint their poster as an image in a cover over the
    // video. With the cover hidden an unloaded video is a blank box, so the
    // largest picture in the hidden chrome becomes the native poster.
    function adoptPoster(video, hidden) {
        if (video.poster || video.readyState || !video.paused) { return; }
        var best = null;
        var check = function (el) {
            if (el.shadowRoot) { each(el.shadowRoot); }
            if (el.tagName === 'IMG' && el.currentSrc && el.naturalWidth >= 160 && el.naturalHeight >= 90 &&
                (!best || el.naturalWidth > best.naturalWidth)) { best = el; }
        };
        var each = function (root) { [].forEach.call(root.querySelectorAll('*'), check); };
        hidden.forEach(function (el) { attempt(function () { check(el); each(el); }); });
        if (best) { video.poster = best.currentSrc; }
    }

    function hideChromeNow(video) {
        var container = containerOf(video);
        var vr = rectOf(video);
        if (vr && (vr.width < 2 || vr.height < 2)) { vr = null; }
        // A positioned ancestor is the player's box only at the player's size.
        // An unrendered video can resolve to a sticky <main> (washingtonpost.com).
        var everything = !!(container.matches && container.matches(PLAYER_SELECTOR)) ||
            positioned(container) && playerSized(container, vr);
        if (container.nodeType === 1 || container.nodeType === 11) { sweep(container, video, vr, everything); }
        if (container.shadowRoot) { sweep(container.shadowRoot, video, vr, everything); }
        if (!vr) { return; }
        fitToClip(video, vr);
        vr = rectOf(video);
        // Siblings of the video's ancestors up to the size-bounded shell,
        // outside the container already swept.
        var shell = shellOf(video);
        for (var el = video; el && el !== shell; el = parentOf(el)) {
            var parent = parentOf(el);
            if (!parent || parent.nodeType === 9) { break; }
            [].forEach.call(parent.children || [], function (sibling) {
                if (sibling !== el && !contains(container, sibling)) { sweep({ children: [sibling] }, video, vr, false); }
            });
        }
        hitTest(video, vr);
    }

    // ------------------------------------------------------------------
    // Chrome passes
    //
    // Players repaint or remount their chrome after the first hide. Each
    // enhanced video gets a pass, coalesced to one per frame so it still lands
    // before paint, but only from its own signals: media events, mutations in
    // its own box or shadow root, entering the viewport, and portals mounted
    // at body level. Unrelated page churn never runs the layout-reading hide.
    // ------------------------------------------------------------------

    var viewportObserver = null;

    function requestPass(video) {
        var state = states.get(video);
        if (!state || !state.hooks.watch || state.queued) { return; }
        state.queued = true;
        requestAnimationFrame(function () {
            state.queued = false;
            if (!states.has(video) || !video.isConnected) { return; }
            hideChrome(video);
            releaseScrollLock(video);
            watchBox(video);
        });
    }

    // Observe the nodes that can hold this player's chrome. The shell depends
    // on layout, so it is re-resolved after every pass.
    function watchBox(video) {
        var state = stateOf(video);
        var roots = [];
        [video.getRootNode && video.getRootNode(), containerOf(video), shellOf(video)].forEach(function (node) {
            if (node && (node.nodeType === 1 || node.nodeType === 11) && node !== video && roots.indexOf(node) === -1) { roots.push(node); }
        });
        var previous = state.watched || [];
        if (previous.length === roots.length && roots.every(function (n) { return previous.indexOf(n) !== -1; })) { return; }
        state.watched = roots;
        state.boxObserver.disconnect();
        roots.forEach(function (root) {
            state.boxObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        });
    }

    function watchChrome(video) {
        if (!once(video, 'watch')) { return; }
        var state = stateOf(video);
        var timers = [];
        var pass = function () { requestPass(video); };
        // LinkedIn's "Watch again" cover lands a few hundred ms after `ended`.
        var passSoon = function () {
            pass();
            timers.forEach(clearTimeout);
            timers = [50, 200, 500].map(function (ms) { return setTimeout(pass, ms); });
        };
        var exitFullscreen = function () {
            // Presentation changes fire on the way into fullscreen as well.
            if (video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen') { video._wblockInNativeFullscreen = true; return; }
            video._wblockInNativeFullscreen = false;
            if (!video.isConnected) { return; }
            restoreNativeControls(video);
            hideChrome(video);
            passSoon();
        };
        state.boxObserver = new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var record = records[i];
                var nodes = record.type === 'childList' ? record.addedNodes : [record.target];
                for (var j = 0; j < nodes.length; j++) {
                    if (nodes[j].nodeType === 1 && nodes[j] !== video && !isHidden(nodes[j])) { pass(); return; }
                }
            }
        });
        ['play', 'pause', 'ended'].forEach(function (type) { listen(video, video, type, passSoon); });
        ['seeking', 'loadeddata', 'mouseenter', 'mousemove'].forEach(function (type) { listen(video, video, type, pass); });
        listen(video, video, 'webkitbeginfullscreen', function () { video._wblockInNativeFullscreen = true; });
        listen(video, video, 'webkitendfullscreen', exitFullscreen);
        listen(video, video, 'webkitpresentationmodechanged', exitFullscreen);
        listen(video, document, 'fullscreenchange', exitFullscreen);
        listen(video, document, 'webkitfullscreenchange', exitFullscreen);
        listen(video, window, 'resize', passSoon);
        onCleanup(video, function () { state.boxObserver.disconnect(); timers.forEach(clearTimeout); });
        if (typeof IntersectionObserver !== 'undefined') {
            viewportObserver = viewportObserver || new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) { if (entry.isIntersecting) { requestPass(entry.target); } });
            });
            viewportObserver.observe(video);
            onCleanup(video, function () { viewportObserver.unobserve(video); });
        }
        watchBox(video);
    }

    // ------------------------------------------------------------------
    // Deciding what to do with a video
    // ------------------------------------------------------------------

    function enhance(container, video) {
        if (video._wblockEnhanced) { requestPass(video); return; }
        video._wblockEnhanced = true;
        enhanced.push(video);
        video.setAttribute(ATTR_DONE, '1');
        if (container.setAttribute) { container.setAttribute(ATTR_DONE, '1'); }
        enableBackgroundPlayback();
        enableNativeControls(video);
        setupPauseHold(video);
        setupTracks(container, video);
        setupAutoPiP(video);
        setupBackgroundResume(video);
        setupPreferences(video);
        setupMediaSession(container, video);
        setupShortcuts(container, video);
        hideChrome(video);
        watchChrome(video);
    }

    // Leave an iOS MSE player to the site, with remote playback locked so
    // its ManagedMediaSource attachment is accepted.
    function leaveToSite(video) {
        applyRemotePlaybackPolicy(video);
    }

    // iOS: an enhanced player that switched to an MSE blob must get its own
    // controls back, or WebKit refuses the ManagedMediaSource attachment.
    function handBack(video) {
        log('handing an MSE player back to the site');
        var hidden = stateOf(video).hidden || [];
        release(video);
        hidden.forEach(function (el) {
            el.removeAttribute(HIDDEN_ATTR);
            el.style.removeProperty('display');
        });
        video.controls = false;
        video.removeAttribute('controls');
        leaveToSite(video);
    }

    // An item of a snapping feed or carousel (NYT's vertical video feed): the
    // video fills a scroll-snap container whose close and next buttons are the
    // site's navigation, not player chrome. Left to the site.
    function inSnapFeed(video) {
        var vr = rectOf(video);
        if (!vr || vr.width < 2 || vr.height < 2) { return false; }
        for (var el = parentOf(video); el && el.nodeType !== 9 && (el.nodeType !== 1 || playerSized(el, vr)); el = parentOf(el)) {
            if (el.nodeType === 1 && (attempt(function () { return getComputedStyle(el).scrollSnapType; }) || 'none') !== 'none') { return true; }
        }
        return false;
    }

    function consider(video) {
        if (!video || video.tagName !== 'VIDEO' || !video.isConnected) { return; }
        if (video._wblockEnhanced) {
            if (IS_IOS && isOpaque(video)) {
                if (!promoteNativeSource(video, containerOf(video))) { handBack(video); }
                return;
            }
            requestPass(video);
            return;
        }
        if (isPrimer(video) || isDeclaredAudio(video) || isLiveStream(video) || isDecorative(video)) { return; }
        var container = containerOf(video);
        var known = !!closest(parentOf(video), PLAYER_SELECTOR);
        var handshake = !!closest(video, HANDSHAKE_SELECTOR);

        // A <source> the player just added is chosen by resource selection
        // a task later; until then currentSrc is empty and on iOS the video
        // looks sourceless. Taking over now would replace the site's choice:
        // WELT's Bitmovin <source> carries the livestream's session, which a
        // promoted bare URL drops. loadstart brings the video back.
        if (!video.srcObject && !video.currentSrc && !video.getAttribute('src') && video.querySelector('source[src]')) {
            if (IS_IOS) { leaveToSite(video); }
            return;
        }
        if (IS_IOS && (isOpaque(video) || !playsDirect(video)) && !promoteNativeSource(video, container)) {
            // An MSE pipeline (even with an http <source> fallback in the
            // markup, plyr.io) or no direct file yet, and nothing native to
            // promote: the element carries a ManagedMediaSource pipeline.
            leaveToSite(video);
            return;
        }
        // A bare <source> without src means the player attaches media later
        // (Paramount locks remote playback first).
        if (!hasSource(video) && (known || !video.querySelector('source'))) { return; }
        // FAVE and AMP attach media inside their own play dispatch, and AMP's
        // preroll keeps Skip Ad in sibling chrome. Wait for real playback.
        if (handshake && (!(stateOf(video).started || !video.paused && video.readyState >= 2) || adShowing(video))) { return; }
        if (!known) {
            // Bare videos: wait for parsing so autoplay/muted/layout signals
            // are complete, and skip ambient, preview, and already-native ones
            // unless the user picked the video.
            if (document.readyState === 'loading' || video.controls) { return; }
            if (!video._wblockChosen && (video.autoplay && video.muted ||
                video.offsetWidth > 0 && video.offsetHeight > 0 && video.offsetWidth < 160 && video.offsetHeight < 120)) { return; }
        }
        if (inSnapFeed(video)) { return; }
        log('enhancing', container.className || container.tagName);
        enhance(container, video);
    }

    // A player usually holds one content video plus placeholders or pooled
    // primers; consider the one with a real source first.
    function videosUnder(root) {
        if (!root || !root.querySelectorAll) { return []; }
        var list = root.nodeType === 1 && root.tagName === 'VIDEO' ? [root] : [].slice.call(root.querySelectorAll('video'));
        var player = root.nodeType === 1 ? closest(root, PLAYER_SELECTOR) : null;
        if (player && player !== root) { list = list.concat([].slice.call(player.querySelectorAll('video'))); }
        var score = function (v) {
            return (hasSource(v) ? 100 : 0) - (isPrimer(v) ? 200 : 0) + (v.currentSrc ? 20 : 0) +
                (v.srcObject ? 20 : 0) + (!v.paused ? 10 : 0) + (v.readyState || 0);
        };
        return list.filter(function (v, i) { return list.indexOf(v) === i; })
            .sort(function (a, b) { return score(b) - score(a); });
    }

    // ------------------------------------------------------------------
    // Site rules
    // ------------------------------------------------------------------

    // PBS/GPB pages embed player.pbs.org in an iframe and paint their own
    // title/play overlay over it. Only on those hosts, and only for overlays
    // in the iframe's own container.
    function hidePbsHostOverlays() {
        if (!/(^|\.)(pbs|gpb)\.org\.?$/i.test(host)) { return; }
        [].forEach.call(document.querySelectorAll('iframe[src]'), function (iframe) {
            var url = attempt(function () { return new URL(iframe.getAttribute('src'), document.baseURI); });
            if (!url || url.hostname !== 'player.pbs.org') { return; }
            var container = iframe.closest('[class*="video_player_container"]') || iframe.parentElement;
            [].forEach.call(container.querySelectorAll('[class*="video_player_overlay"],[class*="VideoPlayerOverlay"]'), function (overlay) {
                if (!overlay.contains(iframe) && !isProtected(overlay, iframe)) { hide(overlay); }
            });
        });
    }

    // ABC News AMP embeds a Disney iframe player. The same-origin MRSS feed
    // has the HLS/MP4 URL; a native video replaces the iframe only once that
    // stream has loaded, and any failure restores the original embed.
    function prepareAbcPlayers() {
        if (!/(^|\.)abcnews\.com$/i.test(host)) { return; }
        [].forEach.call(document.querySelectorAll('amp-video-iframe[src]'), function (embed) {
            if (embed._wblockAbc) { return; }
            var url = attempt(function () { return new URL(embed.getAttribute('src'), location.href); });
            var id = url && url.searchParams.get('id');
            if (!url || url.origin !== location.origin || url.pathname !== '/fitt/video/amp/embed' || !/^\d+$/.test(id || '')) { return; }
            embed._wblockAbc = true;
            var video = document.createElement('video');
            video.controls = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.poster = embed.getAttribute('poster') || '';
            var controller = new AbortController();
            var retired = [], finished = false, installed = false;
            var timer = setTimeout(restore, 15000);
            function restore() {
                if (finished) { return; }
                finished = true;
                clearTimeout(timer);
                controller.abort();
                video.removeAttribute('src');
                attempt(function () { video.load(); });
                video.remove();
                retired.forEach(function (entry) {
                    entry.node.removeAttribute(HIDDEN_ATTR);
                    entry.node.style.cssText = entry.style;
                    if (entry.src !== null) { entry.node.setAttribute('src', entry.src); }
                });
            }
            video.addEventListener('error', restore);
            video.addEventListener('loadedmetadata', function () {
                if (finished || installed || !embed.isConnected) { return; }
                clearTimeout(timer);
                installed = true;
                [].forEach.call(embed.querySelectorAll('iframe,[placeholder],[fallback]'), function (node) {
                    var src = node.tagName === 'IFRAME' ? node.getAttribute('src') : null;
                    retired.push({ node: node, style: node.style.cssText, src: src });
                    node.style.setProperty('display', 'none', 'important');
                    // A hidden iframe can still play audio; keep its URL for restore.
                    if (src !== null) { node.setAttribute('src', 'about:blank'); }
                });
                video.style.cssText = 'position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:contain!important;background:black;z-index:2';
                embed.appendChild(video);
                enhance(embed, video);
            });
            fetch('/video/itemfeed?id=' + encodeURIComponent(id), { signal: controller.signal })
                .then(function (response) { if (!response.ok) { throw new Error(); } return response.json(); })
                .then(function (feed) {
                    var item = feed && feed.channel && feed.channel.item;
                    var sources = item && item['media-group'] && item['media-group']['media-content'];
                    if (finished || !embed.isConnected || !item || String(item.guid) !== id || item.isLiveVideo === true ||
                        item.temporalType !== 'vod' || !Array.isArray(sources)) { restore(); return; }
                    var candidates = sources.map(function (s) { return s && s['@attributes']; }).filter(function (a) {
                        var u = a && attempt(function () { return new URL(a.url); });
                        return u && a.medium === 'video' && video.canPlayType(a.type || '') && u.protocol === 'https:' &&
                            /^(service-pkgabcnews\.akamaized\.net|ondemand\.abcnews\.com)$/.test(u.hostname);
                    }).sort(function (a, b) { return /mpegurl/i.test(b.type) - /mpegurl/i.test(a.type); });
                    if (!candidates.length) { restore(); return; }
                    video.title = item.title || '';
                    video.src = candidates[0].url;
                    video.load();
                }).catch(restore);
        });
    }

    // ------------------------------------------------------------------
    // Observation
    // ------------------------------------------------------------------

    var observedRoots = [];
    var MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'durationchange', 'playing', 'volumechange'];

    function scan(root) {
        hidePbsHostOverlays();
        prepareAbcPlayers();
        videosUnder(root).forEach(function (video) { attempt(function () { consider(video); }); });
    }

    function onMediaEvent(event) {
        var video = event.target;
        if (!video || video.tagName !== 'VIDEO') { return; }
        if (IS_IOS && !video.paused && !isPrimer(video) && !isDecorative(video)) {
            enableBackgroundPlayback();
            setupBackgroundResume(video);
        }
        if (event.type === 'volumechange') {
            if (video.muted || video._wblockEnhanced) { return; }
            video._wblockChosen = true;
        }
        // Let a play gesture finish before taking over in the next task:
        // handshake players attach their media from inside it.
        if (event.type === 'playing' || closest(video, HANDSHAKE_SELECTOR)) {
            setTimeout(function () {
                if (event.type === 'playing') { stateOf(video).started = true; }
                consider(video);
            }, 0);
        } else {
            consider(video);
        }
    }

    function observeRoot(root) {
        if (!root || observedRoots.indexOf(root) !== -1) { return; }
        observedRoots.push(root);
        var observer = new MutationObserver(handleMutations);
        observer.observe(root, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'src', 'data-src', 'data-video-src', 'data-file', 'data-video', 'data-source', 'data-url'] });
        MEDIA_EVENTS.forEach(function (type) { root.addEventListener(type, onMediaEvent, true); });
        root._wblockObserver = observer;
        adoptShadowRoots(root);
        scan(root);
    }

    // Declarative shadow roots never pass through attachShadow.
    function adoptShadowRoots(root) {
        attempt(function () {
            [].forEach.call(root.querySelectorAll('*'), function (el) { if (el.shadowRoot) { observeRoot(el.shadowRoot); } });
        });
    }

    function forgetRoot(root) {
        var index = observedRoots.indexOf(root);
        if (index === -1 || root === document) { return; }
        observedRoots.splice(index, 1);
        root._wblockObserver.disconnect();
        MEDIA_EVENTS.forEach(function (type) { root.removeEventListener(type, onMediaEvent, true); });
    }

    function collectVideos(node, out) {
        if (!node || !node.querySelectorAll) { return; }
        if (node.tagName === 'VIDEO') { out.push(node); }
        [].push.apply(out, node.querySelectorAll('video'));
    }

    function handleMutations(records) {
        var roots = [], removed = [], portal = false;
        var add = function (node) { if (node && roots.indexOf(node) === -1) { roots.push(node); } };
        records.forEach(function (record) {
            var target = record.target;
            if (target.shadowRoot) { observeRoot(target.shadowRoot); }
            if (record.type === 'attributes') {
                // Class churn matters only inside players: a wrapper gaining a
                // library class, or a handshake player ending its preroll.
                if (record.attributeName !== 'class' || closest(target, PLAYER_SELECTOR)) { add(target); }
                return;
            }
            if (target.tagName === 'VIDEO') { add(target); }
            [].forEach.call(record.addedNodes, function (node) {
                if (node.nodeType !== 1) { return; }
                add(node);
                if (node.shadowRoot) { observeRoot(node.shadowRoot); }
                adoptShadowRoots(node);
                var parent = node.parentNode;
                if (parent === document.body || parent === document.documentElement || parent && parent.parentNode === document.body) { portal = true; }
            });
            [].forEach.call(record.removedNodes, function (node) { collectVideos(node, removed); });
        });
        // Runs at the microtask checkpoint before paint, so chrome never
        // survives into the next frame.
        roots.forEach(scan);
        for (var i = enhanced.length - 1; i >= 0; i--) {
            var video = enhanced[i];
            if (video.isConnected) { if (portal) { requestPass(video); } }
            else if (!video._wblockInNativeFullscreen) { enhanced.splice(i, 1); }
        }
        if (!removed.length && !records.some(function (r) { return r.removedNodes.length; })) { return; }
        // A DOM move reports removal and insertion together; release only
        // what stayed detached. iOS native fullscreen detaches the video for
        // the system player, which must keep its hooks.
        removed.forEach(function (video) {
            if (!video.isConnected && !video._wblockInNativeFullscreen) { release(video); }
        });
        observedRoots.slice().forEach(function (root) {
            if (root === document || !root.host || root.host.isConnected) { return; }
            var videos = [];
            collectVideos(root, videos);
            if (videos.some(function (v) { return v._wblockInNativeFullscreen; })) { return; }
            videos.forEach(release);
            forgetRoot(root);
        });
    }

    // Closed shadow roots are only reachable at creation.
    var attachShadow = Element.prototype.attachShadow;
    if (attachShadow && !attachShadow._wblockPlayerCleaner) {
        var patched = function () {
            var root = attachShadow.apply(this, arguments);
            observeRoot(root);
            return root;
        };
        patched._wblockPlayerCleaner = true;
        Element.prototype.attachShadow = patched;
    }

    // iOS fires these on the video before detaching it into the system player.
    document.addEventListener('webkitbeginfullscreen', function (event) {
        if (event.target.tagName === 'VIDEO') { event.target._wblockInNativeFullscreen = true; }
    }, true);
    document.addEventListener('webkitendfullscreen', function (event) {
        var video = event.target;
        if (video.tagName !== 'VIDEO') { return; }
        video._wblockInNativeFullscreen = false;
        if (video.isConnected && video._wblockEnhanced) { restoreNativeControls(video); hideChrome(video); }
    }, true);

    observeRoot(document);
    function rescan() { observedRoots.slice().forEach(function (root) { adoptShadowRoots(root); scan(root); }); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', rescan, { once: true });
    }
    // Stylesheets settle by load; positioned overlays become recognizable.
    window.addEventListener('load', function () {
        rescan();
        enhanced.forEach(function (video) { hideChrome(video); });
    }, { once: true });
})();
