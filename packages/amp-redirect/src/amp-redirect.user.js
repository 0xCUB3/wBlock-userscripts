// ==UserScript==
// @name         AMP Redirect
// @namespace    com.skula.wblock
// @version      0.1.0
// @description  Opens the publisher's regular page instead of its AMP version.
// @description:ar  يفتح صفحة الناشر العادية بدلًا من نسخة AMP.
// @description:de  Öffnet die normale Seite des Herausgebers statt der AMP-Version.
// @description:el  Ανοίγει την κανονική σελίδα του εκδότη αντί για την έκδοση AMP.
// @description:es  Abre la página normal del editor en lugar de su versión AMP.
// @description:fa  به‌جای نسخهٔ AMP، صفحهٔ معمولی ناشر را باز می‌کند.
// @description:fr  Ouvre la page normale de l’éditeur au lieu de sa version AMP.
// @description:hu  A kiadó normál oldalát nyitja meg az AMP-változat helyett.
// @description:it  Apre la pagina normale dell’editore invece della sua versione AMP.
// @description:ja  AMP 版の代わりに、発行元の通常のページを開きます。
// @description:ko  AMP 버전 대신 게시자의 일반 페이지를 엽니다.
// @description:pl  Otwiera zwykłą stronę wydawcy zamiast jej wersji AMP.
// @description:pt-BR  Abre a página normal do editor em vez da versão AMP.
// @description:ro  Deschide pagina obișnuită a editorului în locul versiunii AMP.
// @description:ru  Открывает обычную страницу издателя вместо её AMP-версии.
// @description:tr  AMP sürümü yerine yayıncının normal sayfasını açar.
// @description:zh-Hans  打开发布者的常规页面，而不是 AMP 版本。
// @description:zh-Hant  開啟發布者的一般頁面，而不是 AMP 版本。
// @author       wBlock
// @homepageURL  https://github.com/0xCUB3/wBlock-userscripts
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/amp-redirect/dist/amp-redirect.user.js
// @updateURL    https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/amp-redirect/dist/amp-redirect.meta.js
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) return;

    // Query parameters the AMP viewer and cache add to the publisher's URL.
    var AMP_PARAMS = /^(amp_.*|usqp|aoh|csi|referrer|ampshare|amp)$/i;

    function stripAmpParams(search) {
        var kept = search.replace(/^\?/, '').split('&').filter(function (pair) {
            return pair && !AMP_PARAMS.test(decodeURIComponent(pair.split('=')[0]));
        });
        return kept.length ? '?' + kept.join('&') : '';
    }

    // Google's AMP viewer (google.*/amp/s/host/path) and the AMP cache
    // (*.cdn.ampproject.org/c/s/host/path) wrap the publisher's URL in their
    // own; "/s/" marks an HTTPS origin.
    function unwrappedURL(location) {
        var host = location.hostname, path = location.pathname, rest = null;
        if (/(^|\.)google\.[a-z.]+$/.test(host)) {
            var viewer = /^\/amp\/(s\/)?(.+)$/.exec(path);
            if (viewer) rest = [viewer[1], viewer[2]];
        } else if (/\.cdn\.ampproject\.org$/.test(host)) {
            var cache = /^\/(?:c|v|wp|i)\/(s\/)?(.+)$/.exec(path);
            if (cache) rest = [cache[1], cache[2]];
        }
        if (!rest || !/^[a-z0-9.-]+\.[a-z]{2,}(?:[:/]|$)/i.test(rest[1])) return null;
        return (rest[0] ? 'https://' : 'http://') + rest[1] + stripAmpParams(location.search) + location.hash;
    }

    // A page that already redirected once this session isn't redirected again,
    // so a canonical link that leads back to AMP can't loop.
    function go(target) {
        var key = 'wblockAmpRedirect:' + target.split('#')[0];
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
        } catch (error) { /* storage blocked: redirect once anyway */ }
        location.replace(target);
    }

    var wrapped = unwrappedURL(location);
    if (wrapped) { go(wrapped); return; }

    function isAmpDocument() {
        var root = document.documentElement;
        return !!root && (root.hasAttribute('amp') || root.hasAttribute('⚡'));
    }

    // A publisher's own AMP page names its regular page in rel=canonical.
    function canonicalTarget() {
        var link = document.querySelector('link[rel~="canonical"][href]');
        if (!link) return null;
        var target;
        try { target = new URL(link.getAttribute('href'), location.href); } catch (error) { return null; }
        if (!/^https?:$/.test(target.protocol)) return null;
        var here = location.href.split('#')[0];
        if (target.href.split('#')[0] === here) return null;
        return target.href;
    }

    var done = false;
    function check() {
        if (done || !isAmpDocument()) return false;
        var target = canonicalTarget();
        if (!target) return false;
        done = true;
        go(target);
        return true;
    }

    if (check()) return;
    var observer = new MutationObserver(function () {
        if (check() || document.body) observer.disconnect();
    });
    observer.observe(document, {childList: true, subtree: true});
    document.addEventListener('DOMContentLoaded', function () {
        observer.disconnect();
        check();
    }, {once: true});
})();
