// ==UserScript==
// @name         Dark Reader
// @namespace    com.skula.wblock
// @version      4.9.128-wblock.5
// @description  Dark Reader's MIT-licensed API engine for wBlock (beta; without the full site-fix database).
// @author       Dark Reader Ltd. and wBlock
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @inject-into  content
// @grant        GM_xmlhttpRequest
// @downloadURL  https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/dark-reader/dist/dark-reader.user.js
// @updateURL    https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/dark-reader/dist/dark-reader.meta.js
// ==/UserScript==

/* Dark Reader v4.9.128 is vendored above this adapter. */
(function () {
    'use strict';
    function bridgeFetch(url) {
        return new Promise(function (resolve, reject) {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('wBlock GM_xmlhttpRequest bridge unavailable'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET', url: url, responseType: 'arraybuffer',
                onload: function (response) {
                    var headers = response.responseHeaders || '';
                    resolve(new Response(response.response, {
                        status: response.status, statusText: response.statusText,
                        headers: headers.split(/\r?\n/).reduce(function (out, line) {
                            var at = line.indexOf(':');
                            if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
                            return out;
                        }, {})
                    }));
                },
                onerror: function () { reject(new Error('wBlock Dark Reader request failed')); },
                ontimeout: function () { reject(new Error('wBlock Dark Reader request timed out')); }
            });
        });
    }

    /* Built-in dark theme detection, ported from Dark Reader's MIT-licensed
       src/inject/detector.ts: a page counts as natively dark when its first
       opaque background (root, else body) has HSL lightness below 0.4. The
       check waits until the page has a body and at least one stylesheet. */
    function parseComputedColor(value) {
        var match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value || '');
        if (!match) return null;
        return {
            r: parseFloat(match[1]), g: parseFloat(match[2]), b: parseFloat(match[3]),
            a: match[4] === undefined ? 1 : parseFloat(match[4])
        };
    }
    function isDarkColor(color) {
        var max = Math.max(color.r, color.g, color.b);
        var min = Math.min(color.r, color.g, color.b);
        return (max + min) / (2 * 255) < 0.4;
    }
    function pageHasBuiltInDarkTheme() {
        var ownStyles = document.querySelectorAll('style.darkreader');
        var index, rootColor = null, bodyColor = null;
        for (index = 0; index < ownStyles.length; index++) ownStyles[index].disabled = true;
        try {
            rootColor = parseComputedColor(getComputedStyle(document.documentElement).backgroundColor);
            bodyColor = document.body ? parseComputedColor(getComputedStyle(document.body).backgroundColor) : null;
        } finally {
            for (index = 0; index < ownStyles.length; index++) ownStyles[index].disabled = false;
        }
        if (rootColor && rootColor.a === 1) return isDarkColor(rootColor);
        return !!(bodyColor && bodyColor.a === 1 && isDarkColor(bodyColor));
    }
    function pageHasSomeStyle() {
        if (document.documentElement.style.backgroundColor) return true;
        if (document.body && document.body.style.backgroundColor) return true;
        var sheets = document.styleSheets;
        for (var index = 0; index < sheets.length; index++) {
            var ownerNode = sheets[index] && sheets[index].ownerNode;
            if (ownerNode && !(ownerNode.classList && ownerNode.classList.contains('darkreader'))) return true;
        }
        return false;
    }
    function detectBuiltInDarkTheme(onDetected) {
        var observer = null;
        var onReadyStateChange = null;
        var done = false;
        function stop() {
            if (observer) { observer.disconnect(); observer = null; }
            if (onReadyStateChange) {
                document.removeEventListener('readystatechange', onReadyStateChange);
                onReadyStateChange = null;
            }
        }
        function check() {
            if (done) return;
            done = true;
            stop();
            if (pageHasBuiltInDarkTheme()) onDetected();
        }
        if (document.body && pageHasSomeStyle()) {
            check();
            return;
        }
        observer = new MutationObserver(function () {
            if (document.body && pageHasSomeStyle()) check();
        });
        observer.observe(document.documentElement, {childList: true, subtree: true});
        if (document.readyState !== 'complete') {
            onReadyStateChange = function () {
                if (document.readyState === 'complete') check();
            };
            document.addEventListener('readystatechange', onReadyStateChange);
        }
    }

    var api = window.DarkReader;
    if (!api || typeof api.setFetchMethod !== 'function') return;
    api.setFetchMethod(bridgeFetch);
    var followsSystemAppearance = typeof __wblockDarkReaderFollowsSystemAppearance === 'undefined'
        || __wblockDarkReaderFollowsSystemAppearance;
    if (followsSystemAppearance && typeof api.auto === 'function') {
        api.auto();
    } else if (!followsSystemAppearance && typeof api.enable === 'function') {
        api.enable();
    } else {
        return;
    }
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function'
        || typeof getComputedStyle !== 'function') return;
    detectBuiltInDarkTheme(function () {
        if (followsSystemAppearance && typeof api.auto === 'function') api.auto(false);
        if (typeof api.disable === 'function') api.disable();
    });
})();
