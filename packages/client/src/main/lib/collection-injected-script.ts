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

export type CollectionInjectedScriptOptions = {
  platformRule: CollectionPlatformRule
  scrollFilter?: CollectionScrollFilter
  sizeFilter?: SizeFilter
  bindingName?: string
}

const DEFAULT_BINDING_NAME = '__poseidonSendToHost'

export function createCollectionInjectedScript(options: CollectionInjectedScriptOptions) {
  return `(() => {
  const platformRule = ${JSON.stringify(options.platformRule)};
  const keywordFilter = ${JSON.stringify(normalizeKeywordFilter(options.scrollFilter))};
  const sizeFilter = ${JSON.stringify(normalizeSizeFilter(options.sizeFilter, options.scrollFilter))};
  const bindingName = ${JSON.stringify(options.bindingName ?? DEFAULT_BINDING_NAME)};
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
      return prefix + String(Number.isFinite(parsed) ? Math.max(parsed, 500) : 500);
    });
  }

  function nearestGoodsLink(element) {
    const anchor = element.closest('a[href]');
    if (anchor && anchor.href) return absoluteUrl(anchor.href);
    const wrapper = element.closest('[data-href], [data-url], [data-link]');
    if (!wrapper) return '';
    return absoluteUrl(wrapper.getAttribute('data-href') || wrapper.getAttribute('data-url') || wrapper.getAttribute('data-link') || '');
  }

  function imageFromElement(element) {
    if (element instanceof HTMLImageElement) return element;
    if (!(element instanceof Element)) return null;
    const closestImage = element.closest('img');
    return closestImage instanceof HTMLImageElement ? closestImage : null;
  }

  function eventPoint(event) {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function imageContainsPoint(img, point) {
    const rect = img.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom;
  }

  function addImageCandidate(candidates, seen, value) {
    if (!(value instanceof HTMLImageElement) || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  }

  function addElementImageCandidates(candidates, seen, element, point) {
    const directImage = imageFromElement(element);
    if (directImage) {
      addImageCandidate(candidates, seen, directImage);
    }
    if (!(element instanceof Element)) return;
    if (typeof element.querySelectorAll !== 'function') return;
    for (const img of element.querySelectorAll('img')) {
      if (point && !imageContainsPoint(img, point)) continue;
      addImageCandidate(candidates, seen, img);
    }
  }

  function clickedImage(event) {
    const candidates = [];
    const seen = new Set();
    const point = eventPoint(event);

    if (point) {
      const elementsAtPoint = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(point.x, point.y)
        : [document.elementFromPoint(point.x, point.y)].filter(Boolean);
      for (const element of elementsAtPoint) {
        addElementImageCandidates(candidates, seen, element, point);
      }
    }

    addElementImageCandidates(candidates, seen, event.target, point);

    return candidates.find((img) => {
      if (point && !imageContainsPoint(img, point)) return false;
      const originalUrl = resolveOriginalImage(img);
      if (!originalUrl) return false;
      if (!insideSizeRange(img, originalUrl)) return false;
      return true;
    }) || null;
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
      return preferredImageUrl(img.getAttribute(attr) || img.currentSrc || img.src);
    }
    if (resolver.type === 'src_replace') {
      const from = resolver.config?.from || '';
      const to = resolver.config?.to || '';
      const source = img.currentSrc || img.src;
      return preferredImageUrl(from ? source.replace(from, to) : source);
    }
    return largestSrcset(img.srcset) || preferredImageUrl(img.currentSrc || img.src);
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

  function handleClick(event) {
    const img = clickedImage(event);
    if (!img) return;
    const originalUrl = resolveOriginalImage(img);
    if (!originalUrl) return;
    send({
      kind: 'click',
      img: originalUrl,
      goodsLink: nearestGoodsLink(img),
    });
  }

  function keywordMatches(keywords, value) {
    if (!Array.isArray(keywords) || keywords.length === 0) return false;
    const normalized = String(value || '').toLowerCase();
    return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
  }

  function insideSizeRange(img, originalUrl) {
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
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
    if (keywordMatches(keywordFilter.excludeKeywords, goodsLink)) return false;
    if (keywordFilter.includeKeywords.length > 0 && !keywordMatches(keywordFilter.includeKeywords, goodsLink)) return false;
    return insideSizeRange(img, resolveOriginalImage(img));
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

  document.addEventListener('click', handleClick, true);
  const cleanupRouteChangeWatcher = setupRouteChangeWatcher();
  const cleanupScrollObserver = setupScrollObserver();
  window[runtimeKey] = {
    dispose: () => {
      document.removeEventListener?.('click', handleClick, true);
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
