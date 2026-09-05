// ==UserScript==
// @name         DeArrow
// @namespace    com.skula.wblock
// @version      0.1.0
// @description  Replaces YouTube titles and thumbnails with community-submitted DeArrow alternatives.
// @description:ar  يستبدل عناوين YouTube وصوره المصغرة ببدائل يقدمها مجتمع DeArrow.
// @description:de  Ersetzt YouTube-Titel und Vorschaubilder durch Alternativen aus der DeArrow-Community.
// @description:el  Αντικαθιστά τίτλους και μικρογραφίες του YouTube με εναλλακτικές από την κοινότητα DeArrow.
// @description:es  Sustituye los títulos y las miniaturas de YouTube por alternativas de la comunidad DeArrow.
// @description:fr  Remplace les titres et miniatures YouTube par des alternatives proposées par la communauté DeArrow.
// @description:hu  A YouTube-címeket és bélyegképeket a DeArrow közössége által beküldött alternatívákra cseréli.
// @description:it  Sostituisce titoli e miniature di YouTube con alternative proposte dalla comunità DeArrow.
// @description:ja  YouTubeのタイトルとサムネイルをDeArrowコミュニティが投稿した代替案に置き換えます。
// @description:ko  YouTube 제목과 썸네일을 DeArrow 커뮤니티가 제안한 대안으로 바꿉니다.
// @description:pl  Zastępuje tytuły i miniatury YouTube alternatywami zaproponowanymi przez społeczność DeArrow.
// @description:pt-BR  Substitui títulos e miniaturas do YouTube por alternativas enviadas pela comunidade DeArrow.
// @description:ro  Înlocuiește titlurile și miniaturile YouTube cu alternative propuse de comunitatea DeArrow.
// @description:ru  Заменяет заголовки и миниатюры YouTube вариантами, предложенными сообществом DeArrow.
// @description:tr  YouTube başlıklarını ve küçük resimlerini DeArrow topluluğunun sunduğu alternatiflerle değiştirir.
// @description:zh-Hans  使用 DeArrow 社区提交的替代内容更换 YouTube 标题和缩略图。
// @description:zh-Hant  使用 DeArrow 社群提交的替代內容更換 YouTube 標題和縮圖。
// @author       wBlock
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @noframes
// @run-at       document-start
// @inject-into  page
// @grant        none
// @homepageURL  https://dearrow.ajay.app/
// @downloadURL  https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/dearrow/dist/dearrow.user.js
// @updateURL    https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main/packages/dearrow/dist/dearrow.meta.js
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self || window.__wblockDeArrowDebug) return;
    function log() {
        if (window.console && console.debug) {
            console.debug.apply(console, ['[wBlock DeArrow]'].concat(Array.prototype.slice.call(arguments)));
        }
    }

    // DeArrow
    //
    // DeArrow stores voted replacement titles and thumbnail timestamps on the
    // SponsorBlock server. The current watch video uses its four-character
    // SHA-256 bucket so its exact id is filtered locally. Visible feed cards use
    // DeArrow's compact single-video endpoint, matching the official extension,
    // and are cached for the page session. An optional fallback uses DeArrow's
    // server-provided random timestamp when a video has no accepted thumbnail.

    var DEARROW_API = 'https://sponsor.ajay.app/api/branding';
    var DEARROW_THUMBNAIL_API = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail';
    var DEARROW_CARD_SELECTOR = [
        'ytd-rich-grid-media', 'ytd-video-renderer', 'ytd-compact-video-renderer',
        'ytd-grid-video-renderer', 'ytd-playlist-video-renderer', 'yt-lockup-view-model',
        'ytm-video-with-context-renderer', 'ytm-compact-video-renderer',
        'ytm-rich-item-renderer', 'ytm-shorts-lockup-view-model'
    ].join(',');
    var DEARROW_WATCH_TITLE_SELECTOR = [
        'ytd-watch-metadata h1 yt-formatted-string',
        '#watch-metadata h1 yt-formatted-string',
        'ytm-slim-video-metadata-section-renderer h1',
        'ytm-watch-metadata h1',
        'h1.title yt-formatted-string'
    ].join(',');
    var deArrowBrandingCache = {};
    var deArrowBrandingCacheOrder = [];
    var deArrowActiveRequests = {};
    var deArrowIntersectionObserver = null;
    var deArrowPendingScanRoots = [];
    var deArrowScanScheduled = false;

    // The app prepends standalone DeArrow preferences; other managers use the defaults.
    function loadDeArrowSettings() {
        var settings = {
            enabled: true,
            replaceTitles: true,
            replaceThumbnails: true,
            randomThumbnails: false,
            showOriginalOnHover: true
        };
        var injected = typeof __wblockDeArrowSettings === 'object' ? __wblockDeArrowSettings : null;
        if (!injected) return settings;
        for (var key in settings) {
            if (typeof injected[key] === 'boolean') settings[key] = injected[key];
        }
        return settings;
    }

    function cachedDeArrowBranding(videoId) {
        return Object.prototype.hasOwnProperty.call(deArrowBrandingCache, videoId) ?
            deArrowBrandingCache[videoId] : undefined;
    }

    function cacheDeArrowBranding(videoId, branding) {
        if (!Object.prototype.hasOwnProperty.call(deArrowBrandingCache, videoId)) {
            deArrowBrandingCacheOrder.push(videoId);
        }
        deArrowBrandingCache[videoId] = branding;
        while (deArrowBrandingCacheOrder.length > 100) {
            delete deArrowBrandingCache[deArrowBrandingCacheOrder.shift()];
        }
    }

    function normalizeDeArrowBranding(value) {
        if (!value || typeof value !== 'object') return null;
        return {
            titles: Array.isArray(value.titles) ? value.titles : [],
            thumbnails: Array.isArray(value.thumbnails) ? value.thumbnails : [],
            videoDuration: isFinite(value.videoDuration) && Number(value.videoDuration) > 0 ? Number(value.videoDuration) : null,
            randomTime: value.randomTime !== null && value.randomTime !== undefined && isFinite(value.randomTime) &&
                Number(value.randomTime) >= 0 ? Number(value.randomTime) : null
        };
    }

    function fetchDeArrowBranding(videoId, hashLookup) {
        var cached = cachedDeArrowBranding(videoId);
        if (cached !== undefined) return Promise.resolve(cached);
        if (deArrowActiveRequests[videoId]) return deArrowActiveRequests[videoId];
        if (!window.fetch) return Promise.resolve(null);

        var request;
        if (hashLookup && window.crypto && crypto.subtle && window.TextEncoder) {
            request = crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId)).then(function (buffer) {
                var bytes = new Uint8Array(buffer);
                var hash = '';
                for (var i = 0; i < bytes.length; i++) hash += ('0' + bytes[i].toString(16)).slice(-2);
                return fetch(DEARROW_API + '/' + hash.slice(0, 4) + '?fetchAll=true', { referrerPolicy: 'no-referrer' });
            }).then(function (response) {
                if (!response.ok && response.status !== 404) throw new Error('DeArrow HTTP ' + response.status);
                return response.json();
            }).then(function (bucket) {
                return normalizeDeArrowBranding(bucket && bucket[videoId]);
            });
        } else {
            request = fetch(DEARROW_API + '?videoID=' + encodeURIComponent(videoId) + '&fetchAll=true', {
                referrerPolicy: 'no-referrer'
            }).then(function (response) {
                if (!response.ok && response.status !== 404) throw new Error('DeArrow HTTP ' + response.status);
                return response.json();
            }).then(normalizeDeArrowBranding);
        }
        deArrowActiveRequests[videoId] = request.then(function (branding) {
            cacheDeArrowBranding(videoId, branding);
            delete deArrowActiveRequests[videoId];
            return branding;
        }, function (error) {
            delete deArrowActiveRequests[videoId];
            log('DeArrow unavailable', error);
            return null;
        });
        return deArrowActiveRequests[videoId];
    }

    function deArrowAcceptedTitle(branding) {
        var title = branding && branding.titles[0];
        return title && title.original !== true && typeof title.title === 'string' && title.title.trim() &&
            (title.locked || Number(title.votes) >= 0) ? title.title.replace(/‹/g, '<') : null;
    }

    function deArrowAcceptedThumbnail(branding) {
        var thumbnail = branding && branding.thumbnails[0];
        return thumbnail && thumbnail.original !== true && isFinite(thumbnail.timestamp) && thumbnail.timestamp >= 0 &&
            (thumbnail.locked || Number(thumbnail.votes) >= 0) ? Number(thumbnail.timestamp) : null;
    }

    // DeArrow supplies a stable randomTime when it has one. The deterministic
    // fallback avoids a thumbnail changing on every scan for older responses.
    function deArrowRandomThumbnailTimestamp(videoId, branding) {
        if (!branding || !isFinite(branding.videoDuration) || branding.videoDuration <= 0) return null;
        var fraction = branding.randomTime;
        if (!isFinite(fraction) || fraction < 0) {
            var hash = 2166136261;
            for (var i = 0; i < videoId.length; i++) {
                hash ^= videoId.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            fraction = (hash >>> 0) / 4294967296;
        }
        // Match DeArrow's policy of keeping fallback frames out of the ending.
        fraction = Math.min(Math.max(Number(fraction), 0), 0.9);
        return fraction * branding.videoDuration;
    }

    function deArrowVideoIdFromUrl(value) {
        try {
            var url = new URL(value, location.href);
            var id = url.searchParams.get('v');
            if (!id) {
                var match = url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
                id = match && match[1];
            }
            return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        } catch (e) { return null; }
    }

    function deArrowCardVideoId(card) {
        var direct = card.getAttribute('data-video-id');
        if (direct && /^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;
        var links = card.querySelectorAll('a[href], [href]');
        for (var i = 0; i < links.length; i++) {
            var id = deArrowVideoIdFromUrl(links[i].getAttribute('href'));
            if (id) return id;
        }
        return null;
    }

    function findDeArrowCardTitle(card) {
        var selectors = [
            '#video-title yt-formatted-string', 'yt-formatted-string#video-title',
            'a#video-title-link yt-formatted-string', 'a#video-title-link', 'a#video-title',
            '.yt-lockup-metadata-view-model__title span', '.yt-lockup-metadata-view-model__title',
            '.media-item-headline', 'h3 a[href]'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var element = card.querySelector(selectors[i]);
            if (element) return element;
        }
        return null;
    }

    function findDeArrowCardThumbnail(card, videoId) {
        var links = card.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
            if (deArrowVideoIdFromUrl(links[i].getAttribute('href')) === videoId) {
                var image = links[i].querySelector('img');
                if (image) return image;
            }
        }
        return card.querySelector('#thumbnail img, ytm-thumbnail-cover img, img.yt-core-image');
    }

    function applyDeArrowTitleElement(element, customTitle) {
        if (!element) return;
        var current = element.textContent || '';
        if (element._wblockDeArrowOriginalText === undefined ||
            current !== element._wblockDeArrowCustomText && current !== element._wblockDeArrowOriginalText) {
            element._wblockDeArrowOriginalText = current;
        }
        element._wblockDeArrowCustomText = customTitle;
        element.setAttribute('data-wblock-dearrow-title', '');
        if (!element._wblockDeArrowShowingOriginal && current !== customTitle) element.textContent = customTitle;
    }

    function restoreDeArrowTitleElement(element) {
        if (!element || element._wblockDeArrowOriginalText === undefined) return;
        if (element.textContent === element._wblockDeArrowCustomText) {
            element.textContent = element._wblockDeArrowOriginalText;
        }
        delete element._wblockDeArrowOriginalText;
        delete element._wblockDeArrowCustomText;
        delete element._wblockDeArrowShowingOriginal;
        element.removeAttribute('data-wblock-dearrow-title');
    }

    function restoreDeArrowAttribute(element, name, value) {
        if (value === null || value === undefined) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }

    function deArrowThumbnailUrl(videoId, timestamp) {
        return DEARROW_THUMBNAIL_API + '?videoID=' + encodeURIComponent(videoId) +
            '&time=' + encodeURIComponent(String(timestamp));
    }

    // The thumbnail server may answer with a frame from a different time than
    // the one requested and reports the time it used in X-Timestamp. The API
    // docs require comparing that header with the branding timestamp and
    // requesting once more at the server's time when they differ, so the image
    // is fetched here rather than assigned straight to the element's src.
    function fetchDeArrowThumbnail(videoId, timestamp, retried) {
        var url = deArrowThumbnailUrl(videoId, timestamp);
        if (!window.fetch || !window.URL || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
        return fetch(url, { referrerPolicy: 'no-referrer' }).then(function (response) {
            if (response.status !== 200) {
                throw new Error('DeArrow thumbnail HTTP ' + response.status + ' ' +
                    (response.headers.get('X-Failure-Reason') || ''));
            }
            var served = parseFloat(response.headers.get('X-Timestamp'));
            if (!retried && isFinite(served) && served >= 0 && Math.abs(served - timestamp) > 0.001) {
                log('DeArrow thumbnail served at', served, 'instead of', timestamp);
                return fetchDeArrowThumbnail(videoId, served, true);
            }
            return response.blob().then(function (blob) {
                return { url: url, objectUrl: URL.createObjectURL(blob) };
            });
        }).catch(function (error) {
            log('DeArrow thumbnail unavailable', error);
            return null;
        });
    }

    function releaseDeArrowThumbnail(element) {
        var src = element._wblockDeArrowCustomSrc;
        if (src && src.indexOf('blob:') === 0) {
            try { URL.revokeObjectURL(src); } catch (e) { /* ignore */ }
        }
        delete element._wblockDeArrowCustomSrc;
        delete element._wblockDeArrowRequestedUrl;
        delete element._wblockDeArrowThumbnailFailed;
    }

    function showDeArrowThumbnail(element) {
        if (!element._wblockDeArrowCustomSrc) return;
        element.removeAttribute('srcset');
        element.setAttribute('referrerpolicy', 'no-referrer');
        if (element.getAttribute('src') !== element._wblockDeArrowCustomSrc) {
            element.setAttribute('src', element._wblockDeArrowCustomSrc);
        }
    }

    function applyDeArrowThumbnailElement(element, videoId, timestamp) {
        if (!element) return;
        var url = deArrowThumbnailUrl(videoId, timestamp);
        var currentSrc = element.getAttribute('src');
        if (element._wblockDeArrowOriginalSrc === undefined) {
            element._wblockDeArrowOriginalSrc = currentSrc;
            element._wblockDeArrowOriginalSrcset = element.getAttribute('srcset');
            element._wblockDeArrowOriginalReferrerPolicy = element.getAttribute('referrerpolicy');
        } else if (!element._wblockDeArrowShowingOriginal && currentSrc !== element._wblockDeArrowCustomSrc &&
            currentSrc !== element._wblockDeArrowOriginalSrc) {
            // YouTube recycles card image elements as the feed changes. Preserve
            // its newly assigned original before applying the cached thumbnail.
            element._wblockDeArrowOriginalSrc = currentSrc;
            element._wblockDeArrowOriginalSrcset = element.getAttribute('srcset');
            element._wblockDeArrowOriginalReferrerPolicy = element.getAttribute('referrerpolicy');
            releaseDeArrowThumbnail(element);
        }
        if (!element.hasAttribute('data-wblock-dearrow-thumbnail')) element.setAttribute('data-wblock-dearrow-thumbnail', '');
        if (element._wblockDeArrowThumbnailFailed === url || element._wblockDeArrowShowingOriginal) return;
        if (!element._wblockDeArrowErrorHooked) {
            element._wblockDeArrowErrorHooked = true;
            element.addEventListener('error', function () {
                if (!element._wblockDeArrowCustomSrc || element.getAttribute('src') !== element._wblockDeArrowCustomSrc) return;
                var failedUrl = element._wblockDeArrowRequestedUrl;
                releaseDeArrowThumbnail(element);
                element._wblockDeArrowThumbnailFailed = failedUrl;
                restoreDeArrowAttribute(element, 'src', element._wblockDeArrowOriginalSrc);
                restoreDeArrowAttribute(element, 'srcset', element._wblockDeArrowOriginalSrcset);
                restoreDeArrowAttribute(element, 'referrerpolicy', element._wblockDeArrowOriginalReferrerPolicy);
            });
        }
        if (element._wblockDeArrowRequestedUrl === url) {
            showDeArrowThumbnail(element);
            return;
        }
        releaseDeArrowThumbnail(element);
        element._wblockDeArrowRequestedUrl = url;
        fetchDeArrowThumbnail(videoId, timestamp, false).then(function (result) {
            if (element._wblockDeArrowRequestedUrl !== url) {
                if (result) { try { URL.revokeObjectURL(result.objectUrl); } catch (e) { /* ignore */ } }
                return;
            }
            if (!result) {
                // The original YouTube thumbnail was never replaced, so it stays.
                element._wblockDeArrowThumbnailFailed = url;
                return;
            }
            element._wblockDeArrowCustomSrc = result.objectUrl;
            element.setAttribute('data-wblock-dearrow-thumbnail', result.url);
            if (!element._wblockDeArrowShowingOriginal) showDeArrowThumbnail(element);
        });
    }

    function restoreDeArrowThumbnailElement(element) {
        if (!element || element._wblockDeArrowOriginalSrc === undefined) return;
        restoreDeArrowAttribute(element, 'src', element._wblockDeArrowOriginalSrc);
        restoreDeArrowAttribute(element, 'srcset', element._wblockDeArrowOriginalSrcset);
        restoreDeArrowAttribute(element, 'referrerpolicy', element._wblockDeArrowOriginalReferrerPolicy);
        delete element._wblockDeArrowOriginalSrc;
        delete element._wblockDeArrowOriginalSrcset;
        delete element._wblockDeArrowOriginalReferrerPolicy;
        releaseDeArrowThumbnail(element);
        delete element._wblockDeArrowShowingOriginal;
        element.removeAttribute('data-wblock-dearrow-thumbnail');
    }

    function installDeArrowHover(card) {
        if (card._wblockDeArrowHoverInstalled) return;
        card._wblockDeArrowHoverInstalled = true;
        card._wblockDeArrowMouseEnter = function () {
            if (!loadDeArrowSettings().showOriginalOnHover) return;
            card._wblockDeArrowShowingOriginal = true;
            var title = card._wblockDeArrowTitleElement;
            var image = card._wblockDeArrowThumbnailElement;
            if (title && title._wblockDeArrowOriginalText !== undefined) {
                title._wblockDeArrowShowingOriginal = true;
                title.textContent = title._wblockDeArrowOriginalText;
            }
            if (image && image._wblockDeArrowOriginalSrc !== undefined) {
                image._wblockDeArrowShowingOriginal = true;
                restoreDeArrowAttribute(image, 'src', image._wblockDeArrowOriginalSrc);
                restoreDeArrowAttribute(image, 'srcset', image._wblockDeArrowOriginalSrcset);
                restoreDeArrowAttribute(image, 'referrerpolicy', image._wblockDeArrowOriginalReferrerPolicy);
            }
        };
        card._wblockDeArrowMouseLeave = function () {
            card._wblockDeArrowShowingOriginal = false;
            var settings = loadDeArrowSettings();
            if (!settings.enabled) return;
            var title = card._wblockDeArrowTitleElement;
            var image = card._wblockDeArrowThumbnailElement;
            if (title) {
                title._wblockDeArrowShowingOriginal = false;
                if (settings.replaceTitles && title._wblockDeArrowCustomText) title.textContent = title._wblockDeArrowCustomText;
            }
            if (image) {
                image._wblockDeArrowShowingOriginal = false;
                if (settings.replaceThumbnails && image._wblockDeArrowCustomSrc &&
                    image._wblockDeArrowThumbnailFailed !== image._wblockDeArrowRequestedUrl) {
                    showDeArrowThumbnail(image);
                }
            }
        };
        card.addEventListener('mouseenter', card._wblockDeArrowMouseEnter);
        card.addEventListener('mouseleave', card._wblockDeArrowMouseLeave);
    }

    function restoreDeArrowCard(card) {
        if (!card) return;
        restoreDeArrowTitleElement(card._wblockDeArrowTitleElement);
        restoreDeArrowThumbnailElement(card._wblockDeArrowThumbnailElement);
        if (card._wblockDeArrowHoverInstalled) {
            card.removeEventListener('mouseenter', card._wblockDeArrowMouseEnter);
            card.removeEventListener('mouseleave', card._wblockDeArrowMouseLeave);
        }
        delete card._wblockDeArrowTitleElement;
        delete card._wblockDeArrowThumbnailElement;
        delete card._wblockDeArrowHoverInstalled;
        delete card._wblockDeArrowMouseEnter;
        delete card._wblockDeArrowMouseLeave;
        delete card._wblockDeArrowShowingOriginal;
        delete card._wblockDeArrowObserved;
        delete card._wblockDeArrowRequestedVideoId;
        delete card._wblockDeArrowProcessedVideoId;
        card.removeAttribute('data-wblock-dearrow-card');
    }

    function applyDeArrowCard(card) {
        var videoId = deArrowCardVideoId(card);
        if (!videoId) return;
        if (card._wblockDeArrowRequestedVideoId && card._wblockDeArrowRequestedVideoId !== videoId) {
            restoreDeArrowCard(card);
        }
        var settings = loadDeArrowSettings();
        if (!settings.enabled) {
            restoreDeArrowCard(card);
            return;
        }
        card._wblockDeArrowRequestedVideoId = videoId;
        card.setAttribute('data-wblock-dearrow-card', '');
        fetchDeArrowBranding(videoId, false).then(function (branding) {
            if (!card.isConnected || card._wblockDeArrowRequestedVideoId !== videoId) return;
            var currentSettings = loadDeArrowSettings();
            if (!currentSettings.enabled) {
                restoreDeArrowCard(card);
                return;
            }
            var customTitle = deArrowAcceptedTitle(branding);
            var customTimestamp = deArrowAcceptedThumbnail(branding);
            if (customTimestamp === null && currentSettings.randomThumbnails) {
                customTimestamp = deArrowRandomThumbnailTimestamp(videoId, branding);
            }
            var titleElement = findDeArrowCardTitle(card);
            var thumbnailElement = findDeArrowCardThumbnail(card, videoId);
            if (currentSettings.replaceTitles && customTitle) {
                card._wblockDeArrowTitleElement = titleElement;
                applyDeArrowTitleElement(titleElement, customTitle);
            } else {
                restoreDeArrowTitleElement(card._wblockDeArrowTitleElement);
                delete card._wblockDeArrowTitleElement;
            }
            if (currentSettings.replaceThumbnails && customTimestamp !== null) {
                card._wblockDeArrowThumbnailElement = thumbnailElement;
                applyDeArrowThumbnailElement(thumbnailElement, videoId, customTimestamp);
            } else {
                restoreDeArrowThumbnailElement(card._wblockDeArrowThumbnailElement);
                delete card._wblockDeArrowThumbnailElement;
            }
            if (card._wblockDeArrowTitleElement || card._wblockDeArrowThumbnailElement) installDeArrowHover(card);
            card._wblockDeArrowProcessedVideoId = videoId;
        });
    }

    function queueDeArrowCard(card) {
        if (!card || card._wblockDeArrowShowingOriginal) return;
        var videoId = deArrowCardVideoId(card);
        if (!videoId) return;
        if (card._wblockDeArrowProcessedVideoId === videoId) {
            var title = card._wblockDeArrowTitleElement;
            var image = card._wblockDeArrowThumbnailElement;
            var titleNeedsRepair = title && title._wblockDeArrowCustomText &&
                title.textContent !== title._wblockDeArrowCustomText;
            var imageNeedsRepair = image && image._wblockDeArrowCustomSrc &&
                image._wblockDeArrowThumbnailFailed !== image._wblockDeArrowRequestedUrl &&
                image.getAttribute('src') !== image._wblockDeArrowCustomSrc;
            if (!titleNeedsRepair && !imageNeedsRepair) return;
            applyDeArrowCard(card);
            return;
        }
        if (card._wblockDeArrowRequestedVideoId === videoId && card._wblockDeArrowObserved) return;
        if (typeof IntersectionObserver === 'undefined') {
            applyDeArrowCard(card);
            return;
        }
        if (!deArrowIntersectionObserver) {
            deArrowIntersectionObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    try { deArrowIntersectionObserver.unobserve(entry.target); } catch (e) { /* ignore */ }
                    entry.target._wblockDeArrowObserved = false;
                    applyDeArrowCard(entry.target);
                });
            }, { rootMargin: '240px 0px', threshold: 0.01 });
        }
        if (!card._wblockDeArrowObserved) {
            card._wblockDeArrowObserved = true;
            card._wblockDeArrowRequestedVideoId = videoId;
            card.setAttribute('data-wblock-dearrow-card', '');
            deArrowIntersectionObserver.observe(card);
        }
    }

    function applyCurrentDeArrowTitle() {
        var settings = loadDeArrowSettings();
        var videoId = currentDeArrowVideoId();
        if (!settings.enabled || !settings.replaceTitles || !videoId) return;
        fetchDeArrowBranding(videoId, true).then(function (branding) {
            var currentSettings = loadDeArrowSettings();
            if (!currentSettings.enabled || !currentSettings.replaceTitles || currentDeArrowVideoId() !== videoId) return;
            var customTitle = deArrowAcceptedTitle(branding);
            if (!customTitle) return;
            var titles = document.querySelectorAll(DEARROW_WATCH_TITLE_SELECTOR);
            for (var i = 0; i < titles.length; i++) applyDeArrowTitleElement(titles[i], customTitle);
        });
    }

    function scanForDeArrow(root) {
        var settings = loadDeArrowSettings();
        if (!settings.enabled || !root) return;
        applyCurrentDeArrowTitle();
        var cards = [];
        if (root.nodeType === 1) {
            try {
                if (root.matches(DEARROW_CARD_SELECTOR)) cards.push(root);
                var closest = root.closest(DEARROW_CARD_SELECTOR);
                if (closest && cards.indexOf(closest) === -1) cards.push(closest);
            } catch (e) { /* ignore */ }
        }
        if (root.querySelectorAll) {
            var nested = root.querySelectorAll(DEARROW_CARD_SELECTOR);
            for (var i = 0; i < nested.length; i++) if (cards.indexOf(nested[i]) === -1) cards.push(nested[i]);
        }
        for (var j = 0; j < cards.length; j++) queueDeArrowCard(cards[j]);
    }

    function scheduleDeArrowScan(root) {
        if (!loadDeArrowSettings().enabled) return;
        if (root === document) deArrowPendingScanRoots = [document];
        else if (deArrowPendingScanRoots.indexOf(document) === -1 && root && deArrowPendingScanRoots.indexOf(root) === -1) {
            deArrowPendingScanRoots.push(root);
            if (deArrowPendingScanRoots.length > 40) deArrowPendingScanRoots = [document];
        }
        if (deArrowScanScheduled) return;
        deArrowScanScheduled = true;
        Promise.resolve().then(function () {
            deArrowScanScheduled = false;
            var roots = deArrowPendingScanRoots;
            deArrowPendingScanRoots = [];
            for (var i = 0; i < roots.length; i++) {
                if (roots[i] === document || roots[i].isConnected) scanForDeArrow(roots[i]);
            }
        });
    }

    function restoreAllDeArrowBranding() {
        if (deArrowIntersectionObserver) {
            try { deArrowIntersectionObserver.disconnect(); } catch (e) { /* ignore */ }
            deArrowIntersectionObserver = null;
        }
        var cards = document.querySelectorAll('[data-wblock-dearrow-card]');
        for (var i = 0; i < cards.length; i++) restoreDeArrowCard(cards[i]);
        var titles = document.querySelectorAll('[data-wblock-dearrow-title]');
        for (var j = 0; j < titles.length; j++) restoreDeArrowTitleElement(titles[j]);
        var thumbnails = document.querySelectorAll('[data-wblock-dearrow-thumbnail]');
        for (var k = 0; k < thumbnails.length; k++) restoreDeArrowThumbnailElement(thumbnails[k]);
    }

    function refreshDeArrowBranding() {
        restoreAllDeArrowBranding();
        if (loadDeArrowSettings().enabled) scheduleDeArrowScan(document);
    }


    function currentDeArrowVideoId() {
        var fromURL = deArrowVideoIdFromUrl(location.href);
        if (fromURL) return fromURL;
        var details = window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails;
        return details && /^[A-Za-z0-9_-]{11}$/.test(details.videoId) ? details.videoId : null;
    }

    var brandingObserver = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            scheduleDeArrowScan(records[i].target);
            for (var j = 0; j < records[i].addedNodes.length; j++) {
                if (records[i].addedNodes[j].nodeType === 1) scheduleDeArrowScan(records[i].addedNodes[j]);
            }
            for (var k = 0; k < records[i].removedNodes.length; k++) {
                var removed = records[i].removedNodes[k];
                if (removed.nodeType !== 1 || removed.isConnected) continue;
                if (removed.matches('[data-wblock-dearrow-card]')) restoreDeArrowCard(removed);
                var cards = removed.querySelectorAll('[data-wblock-dearrow-card]');
                for (var n = 0; n < cards.length; n++) restoreDeArrowCard(cards[n]);
            }
        }
    });
    brandingObserver.observe(document, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['href', 'src', 'srcset', 'data-video-id']
    });
    ['yt-navigate-finish', 'yt-page-data-updated'].forEach(function (event) {
        document.addEventListener(event, function () { scheduleDeArrowScan(document); }, true);
    });
    window.addEventListener('popstate', refreshDeArrowBranding);
    window.addEventListener('pagehide', restoreAllDeArrowBranding);
    window.addEventListener('pageshow', function () { scheduleDeArrowScan(document); });
    scheduleDeArrowScan(document);

    window.__wblockDeArrowDebug = {
        refresh: refreshDeArrowBranding,
        setSetting: function (key, value) {
            if (typeof __wblockDeArrowSettings !== 'object') return false;
            __wblockDeArrowSettings[key] = value;
            refreshDeArrowBranding();
            return true;
        }
    };
})();
