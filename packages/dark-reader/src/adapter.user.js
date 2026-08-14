// ==UserScript==
// @name         Dark Reader
// @namespace    com.skula.wblock
// @version      4.9.128-wblock.3
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
    var api = window.DarkReader;
    if (!api || typeof api.auto !== 'function') return;
    api.setFetchMethod(bridgeFetch);
    api.auto();
})();
