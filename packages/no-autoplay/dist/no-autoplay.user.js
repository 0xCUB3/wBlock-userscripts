// ==UserScript==
// @name         No Autoplay
// @namespace    com.skula.wblock
// @version      0.1.0
// @description  Stops videos and audio from playing until you tap or click them. Blocks muted autoplay in feeds and while scrolling.
// @description:de  Verhindert, dass Videos und Audio abspielen, bis du sie antippst oder anklickst. Blockiert stummes Autoplay in Feeds und beim Scrollen.
// @description:es  Impide que el vídeo y el audio se reproduzcan hasta que los toques o hagas clic. Bloquea la reproducción automática silenciada en feeds y al desplazarte.
// @description:fr  Empêche les vidéos et l’audio de se lancer tant que vous ne les touchez pas ou ne cliquez pas. Bloque la lecture automatique en sourdine dans les fils et au défilement.
// @description:it  Impedisce a video e audio di partire finché non li tocchi o fai clic. Blocca l’autoplay silenzioso nei feed e durante lo scorrimento.
// @description:pt-BR  Impede que vídeos e áudios toquem até você tocar ou clicar neles. Bloqueia a reprodução automática sem som em feeds e ao rolar.
// @description:ja  タップまたはクリックするまで動画と音声を再生しません。フィードやスクロール中のミュート自動再生も止めます。
// @description:ko  탭하거나 클릭하기 전에는 동영상과 오디오가 재생되지 않습니다. 피드와 스크롤 중의 음소거 자동 재생도 막습니다.
// @description:ru  Не даёт видео и аудио запускаться, пока вы не нажмёте на них. Блокирует беззвучное автовоспроизведение в лентах и при прокрутке.
// @description:zh-Hans  在你点按或点击之前，视频和音频不会播放。同时阻止信息流和滚动时的静音自动播放。
// @author       wBlock
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/no-autoplay/dist/no-autoplay.user.js
// @updateURL    https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/no-autoplay/dist/no-autoplay.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // No Autoplay
    //
    // iOS Safari still autoplays muted media when it scrolls into view.
    // This script blocks play() and the autoplay attribute until the user
    // interacts with that media element (or the single-media player around
    // it). Per-site off is wBlock's userscript site setting.
    // ------------------------------------------------------------------

    var unlocked = typeof WeakSet === 'function' ? new WeakSet() : null;

    function makeNotAllowed() {
        try {
            return new DOMException(
                'The play() request was interrupted because autoplay is disabled.',
                'NotAllowedError'
            );
        } catch (e) {
            var err = new Error('The play() request was interrupted because autoplay is disabled.');
            err.name = 'NotAllowedError';
            return err;
        }
    }

    function isMedia(node) {
        return !!(node && (node.localName === 'video' || node.localName === 'audio'));
    }

    function isUnlocked(media) {
        if (!media) return false;
        try {
            if (media._wblockNoAutoplayUnlocked) return true;
        } catch (e) { /* ignore */ }
        return !!(unlocked && unlocked.has(media));
    }

    function unlock(media) {
        if (!isMedia(media)) return;
        try { media._wblockNoAutoplayUnlocked = true; } catch (e) { /* ignore */ }
        try { media.setAttribute('data-wblock-no-autoplay-unlocked', '1'); } catch (e) { /* ignore */ }
        if (unlocked) {
            try { unlocked.add(media); } catch (e) { /* ignore */ }
        }
    }

    function disarm(media) {
        if (!isMedia(media) || isUnlocked(media)) return;
        try { media.autoplay = false; } catch (e) { /* ignore */ }
        try { media.removeAttribute('autoplay'); } catch (e) { /* ignore */ }
        try { media.setAttribute('data-wblock-no-autoplay', '1'); } catch (e) { /* ignore */ }
    }

    function pauseIfLocked(media) {
        if (!isMedia(media) || isUnlocked(media)) return;
        disarm(media);
        try {
            if (!media.paused) media.pause();
        } catch (e) { /* ignore */ }
    }

    function watchMedia(media) {
        if (!isMedia(media)) return;
        disarm(media);
        pauseIfLocked(media);
    }

    function scan(root) {
        if (!root) return;
        if (isMedia(root)) watchMedia(root);
        if (!root.querySelectorAll) return;
        var list = root.querySelectorAll('video, audio');
        for (var i = 0; i < list.length; i++) watchMedia(list[i]);
    }

    function eventPath(event) {
        try {
            if (typeof event.composedPath === 'function') return event.composedPath();
        } catch (e) { /* ignore */ }
        var path = [];
        var node = event.target;
        while (node) {
            path.push(node);
            node = node.parentNode || node.host;
        }
        return path;
    }

    function unlockFromEvent(event) {
        var path = eventPath(event);
        var i;
        for (i = 0; i < path.length; i++) {
            if (isMedia(path[i])) {
                unlock(path[i]);
                return;
            }
        }
        var el = event.target;
        for (i = 0; i < 8 && el; i++) {
            if (el.querySelectorAll) {
                var list = el.querySelectorAll('video, audio');
                if (list.length === 1) {
                    unlock(list[0]);
                    return;
                }
                if (list.length > 1) return;
            }
            el = el.parentElement || el.parentNode;
        }
    }

    function onKey(event) {
        var key = event.key;
        if (key !== ' ' && key !== 'k' && key !== 'K' && key !== 'MediaPlayPause') return;
        unlockFromEvent(event);
    }

    function onPlayEvent(event) {
        pauseIfLocked(event.target);
    }

    try {
        var nativePlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            if (isUnlocked(this)) return nativePlay.apply(this, arguments);
            disarm(this);
            try { if (!this.paused) this.pause(); } catch (e) { /* ignore */ }
            return Promise.reject(makeNotAllowed());
        };
    } catch (e) { /* ignore */ }

    try {
        var autoplayDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay');
        if (autoplayDesc && typeof autoplayDesc.set === 'function' && typeof autoplayDesc.get === 'function') {
            Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', {
                configurable: true,
                enumerable: autoplayDesc.enumerable,
                get: function () {
                    return isUnlocked(this) ? autoplayDesc.get.call(this) : false;
                },
                set: function (value) {
                    if (!isUnlocked(this) && value) {
                        autoplayDesc.set.call(this, false);
                        try { this.removeAttribute('autoplay'); } catch (e) { /* ignore */ }
                        return;
                    }
                    autoplayDesc.set.call(this, value);
                }
            });
        }
    } catch (e) { /* ignore */ }

    try {
        var nativeCreateElement = Document.prototype.createElement;
        Document.prototype.createElement = function (name) {
            var el = nativeCreateElement.apply(this, arguments);
            if (typeof name === 'string' && /^(video|audio)$/i.test(name)) watchMedia(el);
            return el;
        };
    } catch (e) { /* ignore */ }

    var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (mutation.type === 'attributes') {
                if (!isUnlocked(mutation.target)) disarm(mutation.target);
                continue;
            }
            var nodes = mutation.addedNodes;
            for (var j = 0; j < nodes.length; j++) scan(nodes[j]);
        }
    });

    function observeRoot(root) {
        if (!root || root._wblockNoAutoplayObserved) return;
        root._wblockNoAutoplayObserved = true;
        try {
            observer.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['autoplay']
            });
        } catch (e) { /* ignore */ }
        scan(root);
    }

    try {
        var nativeAttachShadow = Element.prototype.attachShadow;
        if (nativeAttachShadow && !nativeAttachShadow._wblockNoAutoplayPatched) {
            function patchedAttachShadow() {
                var root = nativeAttachShadow.apply(this, arguments);
                observeRoot(root);
                return root;
            }
            patchedAttachShadow._wblockNoAutoplayPatched = true;
            Element.prototype.attachShadow = patchedAttachShadow;
        }
    } catch (e) { /* ignore */ }

    function boot() {
        try {
            document.addEventListener('pointerdown', unlockFromEvent, true);
            document.addEventListener('touchstart', unlockFromEvent, true);
            document.addEventListener('click', unlockFromEvent, true);
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('play', onPlayEvent, true);
            document.addEventListener('playing', onPlayEvent, true);
        } catch (e) { /* ignore */ }
        if (document.documentElement) observeRoot(document.documentElement);
        else document.addEventListener('DOMContentLoaded', function () {
            if (document.documentElement) observeRoot(document.documentElement);
        });
    }

    boot();
})();
