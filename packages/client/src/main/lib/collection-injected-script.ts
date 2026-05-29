export type CollectionOriginalImageResolver =
  | {
      type: 'src_replace'
      config: {
        from?: string
        to?: string
      }
    }
  | {
      type: 'data_attr'
      config: {
        attr?: string
      }
    }
  | {
      type: 'srcset_largest'
      config?: Record<string, unknown>
    }

export type CollectionPlatformRule = {
  key: string
  name: string
  allowed_domains: string[]
  entry_url: string
  goods_url_patterns: string[]
  login_check?: {
    indicators: string[]
    inverse?: string[]
  }
  original_image_resolver: CollectionOriginalImageResolver
}

export type CollectionScrollFilter = {
  excludeKeywords?: string[]
  includeKeywords?: string[]
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

export type SizeFilter = {
  min_width?: number
  max_width?: number
  min_height?: number
  max_height?: number
}

export type CollectionInjectedScriptMode = 'click' | 'scroll' | 'both'

export type CollectionInjectedScriptOptions = {
  platformRule: CollectionPlatformRule
  scrollFilter?: CollectionScrollFilter
  sizeFilter?: SizeFilter
  bindingName?: string
  mode?: CollectionInjectedScriptMode
}

const DEFAULT_BINDING_NAME = '__poseidonSendToHost'
export const COLLECTION_INJECTED_SCRIPT_VERSION = '2026-05-28-click-gallery-v2'

export function createCollectionInjectedScript(options: CollectionInjectedScriptOptions) {
  return `(() => {
  const platformRule = ${JSON.stringify(options.platformRule)};
  const keywordFilter = ${JSON.stringify(normalizeKeywordFilter(options.scrollFilter))};
  const sizeFilter = ${JSON.stringify(normalizeSizeFilter(options.sizeFilter, options.scrollFilter))};
  const bindingName = ${JSON.stringify(options.bindingName ?? DEFAULT_BINDING_NAME)};
  const runtimeMode = ${JSON.stringify(options.mode ?? 'both')};
  const injectedScriptVersion = ${JSON.stringify(COLLECTION_INJECTED_SCRIPT_VERSION)};
  const runtimeKey = '__poseidonCollectionRuntime';
  const previousRuntime = window[runtimeKey];
  if (previousRuntime && typeof previousRuntime.dispose === 'function') {
    previousRuntime.dispose();
  }
  const seenScrollImages = new Set();
  let lastPageUrl = window.location.href;

  function host() {
    return window.location.hostname.toLowerCase();
  }

  function allowedDomainMatches(pattern, hostname) {
    const normalized = String(pattern || '').toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(2);
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }
    return hostname === normalized || hostname.endsWith('.' + normalized);
  }

  function isAllowedPage() {
    return Array.isArray(platformRule.allowed_domains) &&
      platformRule.allowed_domains.some((domain) => allowedDomainMatches(domain, host()));
  }

  if (!isAllowedPage()) return;

  function absoluteUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') return '';
    try {
      return new URL(value, window.location.href).toString();
    } catch {
      return value;
    }
  }

  function isBlockedImageUrl(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return !normalized ||
      normalized.startsWith('data:') ||
      normalized.startsWith('about:') ||
      normalized.startsWith('blob:');
  }

  function normalizedImageUrl(value) {
    const url = absoluteUrl(value);
    return isBlockedImageUrl(url) ? '' : url;
  }

  function preferredImageUrl(value) {
    const url = normalizedImageUrl(value);
    if (!url) return '';
    return url.replace(/(imageView2\\/2\\/w\\/)(\\d+)(?=\\/)/, (_match, prefix, width) => {
      const parsed = Number.parseInt(width, 10);
      return prefix + String(Number.isFinite(parsed) ? Math.max(parsed, 800) : 800);
    }).replace(/(\\/q\\/)(\\d+)(?=\\/)/, (_match, prefix, quality) => {
      const parsed = Number.parseInt(quality, 10);
      return prefix + String(Number.isFinite(parsed) ? Math.max(parsed, 90) : 90);
    });
  }

  function looksLikeImageUrl(value) {
    const normalized = String(value || '').toLowerCase();
    return normalized.includes('img.kwcdn.com') ||
      /\\.(?:jpe?g|png|webp|avif)(?:[?#/]|$)/.test(normalized);
  }

  function nearestGoodsLink(element) {
    if (!(element instanceof Element) || typeof element.closest !== 'function') return '';
    const anchor = element.closest('a[href]');
    const anchorUrl = goodsLinkFromNode(anchor);
    if (anchorUrl) return anchorUrl;
    const wrapper = element.closest('[data-href], [data-url], [data-link]');
    const wrapperUrl = goodsLinkFromNode(wrapper);
    if (wrapperUrl) return wrapperUrl;
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 12) {
      const currentUrl = goodsLinkFromNode(current);
      if (currentUrl) return currentUrl;
      const descendantUrl = firstDescendantGoodsLink(current);
      if (descendantUrl) return descendantUrl;
      current = current.parentElement;
      depth += 1;
    }
    return '';
  }

  function goodsLinkFromNode(node) {
    if (node && typeof node.href === 'string') {
      const hrefUrl = absoluteUrl(node.href);
      if (matchesGoodsUrl(hrefUrl)) return hrefUrl;
    }
    if (!(node instanceof Element)) return '';
    const raw = node.href ||
      node.getAttribute?.('href') ||
      node.getAttribute?.('data-href') ||
      node.getAttribute?.('data-url') ||
      node.getAttribute?.('data-link') ||
      '';
    const url = absoluteUrl(String(raw || ''));
    return matchesGoodsUrl(url) ? url : '';
  }

  function firstDescendantGoodsLink(element) {
    if (!(element instanceof Element) || typeof element.querySelectorAll !== 'function') return '';
    for (const node of element.querySelectorAll('a[href], [data-href], [data-url], [data-link]')) {
      const url = goodsLinkFromNode(node);
      if (url) return url;
    }
    return '';
  }

  function matchesGoodsUrl(value) {
    return platformRule.goods_url_patterns.some((pattern) => {
      try {
        return new RegExp(pattern).test(value);
      } catch {
        return String(value || '').includes(pattern);
      }
    });
  }

  function imageFromElement(element) {
    if (element instanceof HTMLImageElement) return element;
    if (!(element instanceof Element)) return null;
    const closestImage = element.closest('img');
    return closestImage instanceof HTMLImageElement ? closestImage : null;
  }

  function describeElement(element) {
    if (!(element instanceof Element)) return 'unknown';
    const tag = String(element.tagName || '').toLowerCase() || 'element';
    const id = typeof element.id === 'string' && element.id ? '#' + element.id : '';
    const rawClassName = typeof element.className === 'string' ? element.className : '';
    const className = rawClassName.trim()
      ? '.' + rawClassName.trim().split(/\\s+/).slice(0, 3).join('.')
      : '';
    return (tag + id + className).slice(0, 120);
  }

  function compactDebugValue(value) {
    const normalized = String(value || '').replace(/\\s+/g, ' ').trim();
    return normalized.length > 220 ? normalized.slice(0, 217) + '...' : normalized;
  }

  function describeElementDebugAttributes(element) {
    if (!(element instanceof Element)) return '';
    const attrs = [
      ['role', element.getAttribute?.('role') || ''],
      ['aria_label', element.getAttribute?.('aria-label') || ''],
      ['image_url', elementAttributeImageUrl(element) || backgroundImageUrl(element)],
      ['class', typeof element.className === 'string' ? element.className : ''],
    ];
    return compactDebugValue(
      attrs
        .filter((item) => item[1])
        .map((item) => item[0] + '=' + item[1])
        .join(' '),
    );
  }

  function eventPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function elementContainsPoint(element, point) {
    if (!(element instanceof Element) || typeof element.getBoundingClientRect !== 'function') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom;
  }

  function imageContainsPoint(img, point) {
    return elementContainsPoint(img, point);
  }

  function addResolvedCandidate(candidates, seenUrls, candidate) {
    if (!candidate || !candidate.url || seenUrls.has(candidate.url)) return;
    seenUrls.add(candidate.url);
    candidates.push(candidate);
  }

  function imageCandidate(img, point) {
    if (!(img instanceof HTMLImageElement)) return null;
    if (point && !imageContainsPoint(img, point)) return null;
    const originalUrl = resolveOriginalImage(img) || elementAttributeImageUrl(img);
    if (!originalUrl || !insideSizeRange(img, originalUrl)) return null;
    return {
      url: originalUrl,
      goodsLink: nearestGoodsLink(img),
      source: 'img',
    };
  }

  function attributeValue(element, attr) {
    if (!(element instanceof Element) || typeof element.getAttribute !== 'function') return '';
    return element.getAttribute(attr) || '';
  }

  function imageUrlFromValue(value) {
    if (typeof value !== 'string' || value.trim() === '') return '';
    if (value.includes(',')) {
      const srcsetUrl = largestSrcset(value);
      if (srcsetUrl) return resolveOriginalImageUrl(srcsetUrl);
    }
    if (!looksLikeImageUrl(value)) return '';
    return resolveOriginalImageUrl(value);
  }

  function elementAttributeImageUrl(element) {
    if (!(element instanceof Element)) return '';
    const priorityAttrs = [
      'currentSrc',
      'src',
      'srcset',
      'data-src',
      'data-original',
      'data-original-src',
      'data-lazy-src',
      'data-img',
      'data-image',
      'data-image-url',
      'data-url',
      'data-thumb',
      'data-thumbnail',
    ];
    for (const attr of priorityAttrs) {
      const value = attr === 'currentSrc' || attr === 'src' || attr === 'srcset'
        ? element[attr]
        : attributeValue(element, attr);
      const url = imageUrlFromValue(value);
      if (url) return url;
    }
    if (typeof element.getAttributeNames === 'function') {
      for (const attr of element.getAttributeNames()) {
        const url = imageUrlFromValue(attributeValue(element, attr));
        if (url) return url;
      }
    }
    const source = typeof element.querySelector === 'function' ? element.querySelector('source[srcset], source[data-srcset]') : null;
    if (source instanceof Element) {
      return imageUrlFromValue(attributeValue(source, 'srcset') || attributeValue(source, 'data-srcset'));
    }
    return '';
  }

  function elementAttributeCandidate(element, point) {
    if (!(element instanceof Element)) return null;
    if (point && !elementContainsPoint(element, point)) return null;
    const originalUrl = elementAttributeImageUrl(element);
    if (!originalUrl || !insideElementSizeRange(element, originalUrl)) return null;
    return {
      url: originalUrl,
      goodsLink: nearestGoodsLink(element),
      source: 'attribute',
    };
  }

  function backgroundImageUrl(element) {
    if (!(element instanceof Element)) return '';
    const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element) : null;
    const backgroundImage = String(style?.backgroundImage || '');
    if (!backgroundImage || backgroundImage === 'none') return '';
    const match = backgroundImage.match(/url\\(["']?(.+?)["']?\\)/);
    return resolveOriginalImageUrl(match?.[1] || '');
  }

  function backgroundCandidate(element, point) {
    if (!(element instanceof Element)) return null;
    if (point && !elementContainsPoint(element, point)) return null;
    const originalUrl = backgroundImageUrl(element);
    if (!originalUrl || !insideElementSizeRange(element, originalUrl)) return null;
    return {
      url: originalUrl,
      goodsLink: nearestGoodsLink(element),
      source: 'background',
    };
  }

  function addElementImageCandidates(candidates, seenImages, seenUrls, element, point) {
    const directImage = imageFromElement(element);
    if (directImage) {
      if (!seenImages.has(directImage)) {
        seenImages.add(directImage);
        addResolvedCandidate(candidates, seenUrls, imageCandidate(directImage, point));
      }
    }
    if (!(element instanceof Element)) return;
    addResolvedCandidate(candidates, seenUrls, elementAttributeCandidate(element, point));
    addResolvedCandidate(candidates, seenUrls, backgroundCandidate(element, point));
    addResolvedCandidate(candidates, seenUrls, pageGalleryCandidate(element, point));
    if (typeof element.querySelectorAll !== 'function') return;
    for (const img of element.querySelectorAll('img')) {
      if (seenImages.has(img)) continue;
      seenImages.add(img);
      addResolvedCandidate(candidates, seenUrls, imageCandidate(img, point));
    }
  }

  function addAncestorImageCandidates(candidates, seenImages, seenUrls, element, point) {
    if (!point || !(element instanceof Element)) return;
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 10) {
      addElementImageCandidates(candidates, seenImages, seenUrls, current, point);
      current = current.parentElement;
      depth += 1;
    }
  }

  function pageGalleryImageUrl() {
    try {
      const value = new URL(window.location.href).searchParams.get('top_gallery_url') || '';
      return imageUrlFromValue(value);
    } catch {
      return '';
    }
  }

  function hasInteractiveAncestor(element) {
    if (!(element instanceof Element) || typeof element.closest !== 'function') return false;
    return Boolean(element.closest('button, input, textarea, select'));
  }

  function elementTextSignature(element) {
    if (!(element instanceof Element)) return '';
    return [
      element.tagName,
      element.id,
      typeof element.className === 'string' ? element.className : '',
      element.getAttribute?.('role') || '',
      element.getAttribute?.('aria-label') || '',
    ].join(' ');
  }

  function isLikelyGalleryClick(element, point) {
    if (!(element instanceof Element)) return false;
    if (imageFromElement(element)) return true;
    if (elementAttributeImageUrl(element) || backgroundImageUrl(element)) return true;
    if (typeof element.querySelector === 'function') {
      const mediaChild = element.querySelector('img, picture, source[srcset], source[data-srcset]');
      if (mediaChild) return true;
    }
    const signature = elementTextSignature(element).toLowerCase();
    if (/(image|img|photo|picture|gallery|thumb|thumbnail|swiper|slider|carousel|slide|lazy|_3acovdzo|_2kr3llmi)/.test(signature)) {
      return true;
    }
    if (!point) return false;
    const viewportWidth = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
    if (viewportWidth <= 0 || point.x > viewportWidth * 0.6 || point.y < 160) return false;
    const rect = element.getBoundingClientRect();
    const ratio = rect.height > 0 ? rect.width / rect.height : 0;
    return rect.width >= 40 && rect.height >= 40 && ratio >= 0.6 && ratio <= 1.8;
  }

  function pageGalleryCandidate(element, point) {
    if (!(element instanceof Element)) return null;
    if (point && !elementContainsPoint(element, point)) return null;
    const originalUrl = pageGalleryImageUrl();
    const likelyGalleryClick = isLikelyGalleryClick(element, point);
    if (!originalUrl || !likelyGalleryClick) return null;
    if (
      hasInteractiveAncestor(element) &&
      !imageFromElement(element) &&
      !elementAttributeImageUrl(element) &&
      !backgroundImageUrl(element)
    ) {
      return null;
    }
    if (!insideResolvedSizeRange(1000, 1000, originalUrl)) return null;
    return {
      url: originalUrl,
      goodsLink: nearestGoodsLink(element) || window.location.href,
      source: 'page_top_gallery',
    };
  }

  function shouldResolveAfterGalleryUpdate(element, point) {
    if (!(element instanceof Element)) return false;
    if (!pageGalleryImageUrl() || !isLikelyGalleryClick(element, point)) return false;
    const rect = element.getBoundingClientRect();
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    return role === 'button' || rect.width < 180 || rect.height < 180;
  }

  function displayedGalleryImageCandidate() {
    if (typeof document.querySelectorAll !== 'function') return null;
    const candidates = [];
    const viewportWidth = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
    for (const img of document.querySelectorAll('img')) {
      if (!(img instanceof HTMLImageElement)) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 180) continue;
      if (viewportWidth > 0 && (rect.left > viewportWidth * 0.65 || rect.right < viewportWidth * 0.35)) continue;
      if (rect.width < rect.height * 0.75 || rect.width > rect.height * 1.35) continue;
      const candidate = imageCandidate(img, null);
      if (!candidate) continue;
      candidates.push({
        ...candidate,
        source: 'gallery_current_img',
        area: rect.width * rect.height,
      });
    }
    candidates.sort((left, right) => right.area - left.area);
    const best = candidates[0];
    if (!best) return null;
    return {
      url: best.url,
      goodsLink: best.goodsLink,
      source: best.source,
    };
  }

  function largeGalleryImageCount() {
    if (typeof document.querySelectorAll !== 'function') return 0;
    let count = 0;
    for (const img of document.querySelectorAll('img')) {
      if (!(img instanceof HTMLImageElement)) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width >= 180 && rect.height >= 180) count += 1;
    }
    return count;
  }

  function describeElementsAtPoint(point) {
    if (!point) return '';
    const elementsAtPoint = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : [document.elementFromPoint(point.x, point.y)].filter(Boolean);
    return elementsAtPoint
      .slice(0, 5)
      .map((element) => {
        if (!(element instanceof Element)) return 'unknown';
        const attrs = describeElementDebugAttributes(element);
        return compactDebugValue(attrs ? describeElement(element) + ' ' + attrs : describeElement(element));
      })
      .join(' | ');
  }

  function clickMissDetails(target, point) {
    const targetElement = target instanceof Element ? target : null;
    const topGalleryUrl = pageGalleryImageUrl();
    return {
      script_version: injectedScriptVersion,
      runtime_mode: runtimeMode,
      target: describeElement(target),
      target_attrs: targetElement ? describeElementDebugAttributes(targetElement) || null : null,
      click_x: point?.x ?? null,
      click_y: point?.y ?? null,
      top_gallery_url_present: Boolean(topGalleryUrl),
      top_gallery_url: topGalleryUrl || null,
      likely_gallery_target: targetElement ? isLikelyGalleryClick(targetElement, point) : false,
      interactive_ancestor: targetElement ? hasInteractiveAncestor(targetElement) : false,
      elements_from_point: describeElementsAtPoint(point) || null,
      large_gallery_candidates_count: largeGalleryImageCount(),
    };
  }

  function clickedImage(event) {
    const candidates = [];
    const seenImages = new Set();
    const seenUrls = new Set();
    const point = eventPoint(event);

    if (point) {
      const elementsAtPoint = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(point.x, point.y)
        : [document.elementFromPoint(point.x, point.y)].filter(Boolean);
      for (const element of elementsAtPoint) {
        addElementImageCandidates(candidates, seenImages, seenUrls, element, point);
      }
    }

    addElementImageCandidates(candidates, seenImages, seenUrls, event.target, point);
    addAncestorImageCandidates(candidates, seenImages, seenUrls, event.target, point);
    addResolvedCandidate(candidates, seenUrls, pageGalleryCandidate(event.target, point));

    return candidates[0] || null;
  }

  function largestSrcset(srcset) {
    if (typeof srcset !== 'string' || srcset.trim() === '') return '';
    const candidates = srcset
      .split(',')
      .map((item) => {
        const parts = item.trim().split(/\\s+/);
        const url = parts[0] || '';
        const descriptor = parts[1] || '1x';
        const size = Number.parseFloat(descriptor.replace(/[^0-9.]/g, '')) || 1;
        return { url, size };
      })
      .filter((item) => item.url);
    candidates.sort((left, right) => right.size - left.size);
    return preferredImageUrl(candidates[0]?.url || '');
  }

  function resolveOriginalImage(img) {
    const resolver = platformRule.original_image_resolver || { type: 'srcset_largest', config: {} };
    if (resolver.type === 'data_attr') {
      const attr = resolver.config?.attr || 'data-src';
      return resolveOriginalImageUrl(img.getAttribute(attr) || elementAttributeImageUrl(img) || img.currentSrc || img.src);
    }
    if (resolver.type === 'src_replace') {
      return resolveOriginalImageUrl(img.currentSrc || img.src || elementAttributeImageUrl(img));
    }
    return largestSrcset(img.srcset) || elementAttributeImageUrl(img) || preferredImageUrl(img.currentSrc || img.src);
  }

  function resolveOriginalImageUrl(value) {
    const resolver = platformRule.original_image_resolver || { type: 'srcset_largest', config: {} };
    if (resolver.type === 'src_replace') {
      const from = resolver.config?.from || '';
      const to = resolver.config?.to || '';
      return preferredImageUrl(from ? String(value || '').replace(from, to) : value);
    }
    return preferredImageUrl(value);
  }

  function dimensionsFromImageUrl(value) {
    const match = String(value || '').match(/\\/w\\/(\\d+)(?:\\D|$)/);
    if (!match) return null;
    const width = Number.parseInt(match[1], 10);
    if (!Number.isFinite(width) || width <= 0) return null;
    return { width, height: width };
  }

  function send(data) {
    if (!isAllowedPage()) return;
    const payload = { ...data };
    if (typeof payload.img === 'string') {
      const img = normalizedImageUrl(payload.img);
      if (!img) return;
      payload.img = img;
    }
    if (Array.isArray(payload.images)) {
      const images = payload.images.map(normalizedImageUrl).filter(Boolean);
      if (images.length === 0) return;
      payload.images = images;
    }
    const target = window[bindingName];
    if (typeof target === 'function') {
      void target({ ...payload, platform: platformRule.key, page: window.location.href });
    }
  }

  function sendDebug(message, details, level) {
    send({
      kind: 'debug',
      level: level || 'debug',
      message,
      details: details || {},
    });
  }

  function sendClickCandidate(candidate, point, target) {
    if (!candidate) {
      sendDebug('页面点击未识别到可采集图片', clickMissDetails(target, point), 'debug');
      return;
    }
    sendDebug('页面点击已识别图片', {
      script_version: injectedScriptVersion,
      runtime_mode: runtimeMode,
      image_url: candidate.url,
      goods_link: candidate.goodsLink || null,
      image_source: candidate.source,
    }, 'debug');
    send({
      kind: 'click',
      img: candidate.url,
      goodsLink: candidate.goodsLink,
    });
  }

  function handleClick(event) {
    const point = eventPoint(event);
    const target = event.target;
    if (shouldResolveAfterGalleryUpdate(target, point)) {
      window.setTimeout?.(() => {
        sendClickCandidate(displayedGalleryImageCandidate() || clickedImage(event), point, target);
      }, 160);
      return;
    }
    sendClickCandidate(clickedImage(event), point, target);
  }

  function keywordMatches(keywords, value) {
    if (!Array.isArray(keywords) || keywords.length === 0) return false;
    const normalized = String(value || '').toLowerCase();
    return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
  }

  function insideSizeRange(img, originalUrl) {
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    return insideResolvedSizeRange(width, height, originalUrl);
  }

  function insideElementSizeRange(element, originalUrl) {
    const rect = element.getBoundingClientRect();
    return insideResolvedSizeRange(rect.width || 0, rect.height || 0, originalUrl);
  }

  function insideResolvedSizeRange(width, height, originalUrl) {
    const urlDimensions = dimensionsFromImageUrl(originalUrl);
    const filterWidth = Math.max(width, urlDimensions?.width || 0);
    const filterHeight = Math.max(height, urlDimensions?.height || 0);
    if (sizeFilter.minWidth > 0 && filterWidth < sizeFilter.minWidth) return false;
    if (sizeFilter.maxWidth > 0 && filterWidth > sizeFilter.maxWidth) return false;
    if (sizeFilter.minHeight > 0 && filterHeight < sizeFilter.minHeight) return false;
    if (sizeFilter.maxHeight > 0 && filterHeight > sizeFilter.maxHeight) return false;
    return true;
  }

  function passesScrollFilter(img, goodsLink) {
    if (!isRelevantScrollImage(img, goodsLink)) return false;
    if (keywordMatches(keywordFilter.excludeKeywords, goodsLink)) return false;
    if (keywordFilter.includeKeywords.length > 0 && !keywordMatches(keywordFilter.includeKeywords, goodsLink)) return false;
    return insideSizeRange(img, resolveOriginalImage(img));
  }

  function isRelevantScrollImage(img, goodsLink) {
    if (platformRule.key !== 'temu') return true;
    if (!goodsLink || !matchesGoodsUrl(goodsLink)) return false;
    const rawUrl = String(img.currentSrc || img.src || elementAttributeImageUrl(img) || '').toLowerCase();
    const resolvedUrl = resolveOriginalImage(img).toLowerCase();
    if (!resolvedUrl.includes('img.kwcdn.com/product/')) return false;
    if (img.getAttribute?.('data-js-main-img') === 'true') return true;
    const rawDimensions = dimensionsFromImageUrl(rawUrl);
    return !rawDimensions || rawDimensions.width >= 300;
  }

  function clearScrollSeenOnUrlChange() {
    const nextPageUrl = window.location.href;
    if (nextPageUrl === lastPageUrl) return;
    lastPageUrl = nextPageUrl;
    seenScrollImages.clear();
  }

  function setupRouteChangeWatcher() {
    const historyRef = window.history;
    const cleanup = [];
    if (historyRef) {
      for (const methodName of ['pushState', 'replaceState']) {
        const original = historyRef[methodName];
        if (typeof original !== 'function') continue;
        const wrapped = function () {
          const result = original.apply(this, arguments);
          clearScrollSeenOnUrlChange();
          return result;
        };
        historyRef[methodName] = wrapped;
        cleanup.push(() => {
          if (historyRef[methodName] === wrapped) {
            historyRef[methodName] = original;
          }
        });
      }
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('popstate', clearScrollSeenOnUrlChange);
      cleanup.push(() => window.removeEventListener?.('popstate', clearScrollSeenOnUrlChange));
    }
    return () => {
      for (const item of cleanup.reverse()) item();
    };
  }

  function handleVisibleImage(img) {
    const originalUrl = resolveOriginalImage(img);
    if (!originalUrl || seenScrollImages.has(originalUrl)) return;
    const goodsLink = nearestGoodsLink(img);
    if (!passesScrollFilter(img, goodsLink)) return;
    seenScrollImages.add(originalUrl);
    send({
      kind: 'scroll',
      img: originalUrl,
      goodsLink,
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
    });
  }

  function setupScrollObserver() {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target instanceof HTMLImageElement) {
          handleVisibleImage(entry.target);
        }
      }
    }, { root: null, threshold: 0.2 });

    const observeImages = (root) => {
      for (const img of root.querySelectorAll('img')) {
        observer.observe(img);
      }
    };

    observeImages(document);
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLImageElement) {
            observer.observe(node);
          } else if (node instanceof Element) {
            observeImages(node);
          }
        }
      }
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      observer.disconnect?.();
      mutationObserver.disconnect?.();
    };
  }

  const cleanupClickListener = runtimeMode === 'scroll'
    ? () => {}
    : (() => {
      document.addEventListener('click', handleClick, true);
      return () => document.removeEventListener?.('click', handleClick, true);
    })();
  const cleanupRouteChangeWatcher = setupRouteChangeWatcher();
  const cleanupScrollObserver = runtimeMode === 'click' ? () => {} : setupScrollObserver();
  window[runtimeKey] = {
    dispose: () => {
      cleanupClickListener();
      cleanupRouteChangeWatcher();
      cleanupScrollObserver();
    },
  };
})();`
}

function normalizeKeywordFilter(filter: CollectionScrollFilter = {}) {
  return {
    excludeKeywords: filter.excludeKeywords ?? [],
    includeKeywords: filter.includeKeywords ?? [],
  }
}

function normalizeSizeFilter(filter: SizeFilter = {}, legacyFilter: CollectionScrollFilter = {}) {
  return {
    minWidth: positiveNumber(filter.min_width ?? legacyFilter.minWidth),
    maxWidth: positiveNumber(filter.max_width ?? legacyFilter.maxWidth),
    minHeight: positiveNumber(filter.min_height ?? legacyFilter.minHeight),
    maxHeight: positiveNumber(filter.max_height ?? legacyFilter.maxHeight),
  }
}

function positiveNumber(value: number | undefined) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0
}
