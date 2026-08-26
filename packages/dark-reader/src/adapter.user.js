// ==UserScript==
// @name         Dark Reader
// @namespace    com.skula.wblock
// @version      4.9.128-wblock.7
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

    /* Anti-flash guard: when the dark theme is about to be applied, paint the
       root dark before the page's own styles arrive so slow-loading pages do
       not flash bright first. The guard is excluded from the detector's
       page-has-style probe and removed as soon as detection settles, before
       the page background is measured, so it can never bias detection. */
    var antiflashStyle = null;
    function injectAntiflash() {
        if (!document.documentElement || typeof document.createElement !== 'function') return;
        var style = document.createElement('style');
        style.id = 'wblock-antiflash';
        style.textContent = 'html { background-color: #181a1b !important; color-scheme: dark !important; }';
        document.documentElement.appendChild(style);
        antiflashStyle = style;
    }
    function removeAntiflash() {
        if (antiflashStyle && antiflashStyle.parentNode) antiflashStyle.parentNode.removeChild(antiflashStyle);
        antiflashStyle = null;
    }

    /* Built-in dark theme detection, ported from Dark Reader's MIT-licensed
       src/inject/detector.ts. A page counts as natively dark when it advertises
       a dark color-scheme (meta or CSS), uses a .dark / data-theme=dark hint,
       or its visible colors are dark. A clear root/body background wins first;
       on-screen samples are only consulted when both are transparent. The site-fix hint database is
       not shipped. The check waits until the page has a body, visible content,
       and at least one real stylesheet. */
    var COLOR_SCHEME_META_SELECTOR = 'meta[name="color-scheme"]';
    function isSystemDarkModeEnabled() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    }
    function parseComputedColor(value) {
        if (!value) return null;
        var trimmed = String(value).trim().toLowerCase();
        if (trimmed === 'transparent') return {r: 0, g: 0, b: 0, a: 0};
        var match = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(trimmed);
        if (!match) return null;
        return {
            r: parseFloat(match[1]), g: parseFloat(match[2]), b: parseFloat(match[3]),
            a: match[4] === undefined ? 1 : parseFloat(match[4])
        };
    }
    function getSRGBLightness(r, g, b) {
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    function ownerNodeIsDarkReader(ownerNode) {
        return !!(ownerNode && ownerNode.classList && ownerNode.classList.contains('darkreader'));
    }
    function collectDarkReaderSheets() {
        var sheets = [];
        var seen = typeof Set === 'function' ? new Set() : null;
        function pushSheet(sheet) {
            if (!sheet || (seen && seen.has(sheet))) return;
            if (seen) seen.add(sheet);
            else if (sheets.indexOf(sheet) !== -1) return;
            sheets.push(sheet);
        }
        if (typeof document.querySelectorAll === 'function') {
            var ownStyles = document.querySelectorAll('style.darkreader');
            var styleIndex;
            for (styleIndex = 0; styleIndex < ownStyles.length; styleIndex++) {
                pushSheet(ownStyles[styleIndex]);
                if (ownStyles[styleIndex].sheet) pushSheet(ownStyles[styleIndex].sheet);
            }
        }
        var all = document.styleSheets;
        var index, sheet;
        for (index = 0; index < all.length; index++) {
            sheet = all[index];
            if (sheet && ownerNodeIsDarkReader(sheet.ownerNode)) pushSheet(sheet);
        }
        if (Array.isArray(document.adoptedStyleSheets)) {
            for (index = 0; index < document.adoptedStyleSheets.length; index++) {
                sheet = document.adoptedStyleSheets[index];
                var firstRule = sheet && sheet.cssRules && sheet.cssRules[0];
                if (firstRule && typeof firstRule.selectorText === 'string'
                    && firstRule.selectorText.indexOf('#__darkreader') === 0) pushSheet(sheet);
            }
        }
        return sheets;
    }
    function setSheetsDisabled(sheets, disabled) {
        var index, sheet;
        for (index = 0; index < sheets.length; index++) {
            sheet = sheets[index];
            sheet.disabled = disabled;
            if (sheet.sheet) sheet.sheet.disabled = disabled;
        }
    }
    function sampleDoesNotLookDark(rootStyle) {
        var winWidth = typeof innerWidth === 'number' ? innerWidth : 0;
        var winHeight = typeof innerHeight === 'number' ? innerHeight : 0;
        if (typeof document.elementFromPoint !== 'function' || winWidth <= 0 || winHeight <= 0) return false;
        var CELL_SIZE = 256;
        var MAX_ROW_COUNT = 4;
        var columns = Math.min(MAX_ROW_COUNT, Math.ceil(winWidth / CELL_SIZE));
        var rows = Math.min(MAX_ROW_COUNT, Math.ceil(winHeight / CELL_SIZE));
        var stepX = columns ? Math.floor(winWidth / columns) : 0;
        var stepY = rows ? Math.floor(winHeight / rows) : 0;
        if (stepX <= 0 || stepY <= 0) return false;
        var processedElements = typeof Set === 'function' ? new Set() : null;
        var seen = processedElements ? null : [];
        function alreadyProcessed(element) {
            if (processedElements) return processedElements.has(element);
            return seen.indexOf(element) !== -1;
        }
        function markProcessed(element) {
            if (processedElements) processedElements.add(element);
            else seen.push(element);
        }
        var y, x, element, style, bgColor, textColor;
        for (y = Math.floor(stepY / 2); y < winHeight; y += stepY) {
            for (x = Math.floor(stepX / 2); x < winWidth; x += stepX) {
                element = document.elementFromPoint(x, y);
                if (!element || alreadyProcessed(element)
                    || String(element.tagName || '').toLowerCase() === 'img') continue;
                markProcessed(element);
                style = element === document.documentElement ? rootStyle : getComputedStyle(element);
                bgColor = parseComputedColor(style.backgroundColor);
                if (!bgColor) return true;
                if (bgColor.r === 24 && bgColor.g === 26 && bgColor.b === 27) return true;
                if (bgColor.a === 1) {
                    if (getSRGBLightness(bgColor.r, bgColor.g, bgColor.b) > 0.6) return true;
                } else {
                    textColor = parseComputedColor(style.color);
                    if (!textColor) return true;
                    if (getSRGBLightness(textColor.r, textColor.g, textColor.b) < 0.4) return true;
                }
            }
        }
        return false;
    }
    function hasBuiltInDarkTheme() {
        var rootStyle = getComputedStyle(document.documentElement);
        if ((rootStyle.filter && rootStyle.filter.indexOf('invert(1)') !== -1)
            || rootStyle.colorScheme === 'dark') {
            return true;
        }
        var rootColor = parseComputedColor(rootStyle.backgroundColor);
        if (!rootColor) return false;
        var bodyColor = document.body
            ? parseComputedColor(getComputedStyle(document.body).backgroundColor)
            : {r: 0, g: 0, b: 0, a: 0};
        if (!bodyColor) return false;
        if (rootColor.a !== 0 || bodyColor.a !== 0) {
            var rootLightness = (1 - rootColor.a) + rootColor.a * getSRGBLightness(rootColor.r, rootColor.g, rootColor.b);
            var finalLightness = (1 - bodyColor.a) * rootLightness
                + bodyColor.a * getSRGBLightness(bodyColor.r, bodyColor.g, bodyColor.b);
            return finalLightness < 0.5;
        }
        if (sampleDoesNotLookDark(rootStyle)) return false;
        var rootTextColor = parseComputedColor(rootStyle.color);
        return !!(rootTextColor && getSRGBLightness(rootTextColor.r, rootTextColor.g, rootTextColor.b) > 0.5);
    }
    function pageHasBuiltInDarkTheme() {
        var colorSchemeMeta = typeof document.querySelector === 'function'
            ? document.querySelector(COLOR_SCHEME_META_SELECTOR) : null;
        if (colorSchemeMeta) {
            var content = String(colorSchemeMeta.content || '');
            return content === 'dark' || (content.indexOf('dark') !== -1 && isSystemDarkModeEnabled());
        }
        var root = document.documentElement;
        var body = document.body;
        if ((root.classList && root.classList.contains('dark'))
            || (body && body.classList && body.classList.contains('dark'))
            || (root.dataset && String(root.dataset.theme || '').toLowerCase() === 'dark')) {
            return true;
        }
        var drSheets = collectDarkReaderSheets();
        setSheetsDisabled(drSheets, true);
        var darkThemeDetected = false;
        try {
            darkThemeDetected = hasBuiltInDarkTheme();
        } finally {
            setSheetsDisabled(drSheets, false);
        }
        return darkThemeDetected;
    }
    function pageHasSomeStyle() {
        if (typeof document.querySelector === 'function'
            && document.querySelector(COLOR_SCHEME_META_SELECTOR)) return true;
        if (document.documentElement.style.backgroundColor) return true;
        if (document.body && document.body.style.backgroundColor) return true;
        var sheets = document.styleSheets;
        var index, ownerNode;
        for (index = 0; index < sheets.length; index++) {
            ownerNode = sheets[index] && sheets[index].ownerNode;
            if (ownerNode && ownerNode !== antiflashStyle && !ownerNodeIsDarkReader(ownerNode)) return true;
        }
        return false;
    }
    function canCheckForStyle() {
        var body = document.body;
        if (!(body && body.scrollHeight > 0 && body.clientHeight > 0
            && body.childElementCount > 0 && pageHasSomeStyle())) {
            return false;
        }
        var children = body.children || [];
        var index, tag;
        for (index = 0; index < children.length; index++) {
            tag = String(children[index].tagName || '').toUpperCase();
            if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'LINK') return true;
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
            removeAntiflash();
            if (pageHasBuiltInDarkTheme()) onDetected();
        }
        if (canCheckForStyle()) {
            check();
            return;
        }
        observer = new MutationObserver(function () {
            if (canCheckForStyle()) check();
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
    if (!followsSystemAppearance
        || (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)) {
        injectAntiflash();
    }
    detectBuiltInDarkTheme(function () {
        if (followsSystemAppearance && typeof api.auto === 'function') api.auto(false);
        if (typeof api.disable === 'function') api.disable();
    });
})();
