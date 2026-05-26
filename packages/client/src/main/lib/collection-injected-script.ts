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

  function nearestGoodsLink(element) {
    const anchor = element.closest('a[href]');
    if (anchor && anchor.href) return absoluteUrl(anchor.href);
    const wrapper = element.closest('[data-href], [data-url], [data-link]');
    if (!wrapper) return '';
    return absoluteUrl(wrapper.getAttribute('data-href') || wrapper.getAttribute('data-url') || wrapper.getAttribute('data-link') || '');
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
    return normalizedImageUrl(candidates[0]?.url || '');
  }

  function resolveOriginalImage(img) {
    const resolver = platformRule.original_image_resolver || { type: 'srcset_largest', config: {} };
    if (resolver.type === 'data_attr') {
      const attr = resolver.config?.attr || 'data-src';
      return normalizedImageUrl(img.getAttribute(attr) || img.currentSrc || img.src);
    }
    if (resolver.type === 'src_replace') {
      const from = resolver.config?.from || '';
      const to = resolver.config?.to || '';
      const source = img.currentSrc || img.src;
      return normalizedImageUrl(from ? source.replace(from, to) : source);
    }
    return largestSrcset(img.srcset) || normalizedImageUrl(img.currentSrc || img.src);
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
    const target = event.target;
    const img = target?.closest?.('img');
    if (!img) return;
    if (!insideSizeRange(img)) return;
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

  function insideSizeRange(img) {
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (sizeFilter.minWidth > 0 && width < sizeFilter.minWidth) return false;
    if (sizeFilter.maxWidth > 0 && width > sizeFilter.maxWidth) return false;
    if (sizeFilter.minHeight > 0 && height < sizeFilter.minHeight) return false;
    if (sizeFilter.maxHeight > 0 && height > sizeFilter.maxHeight) return false;
    return true;
  }

  function passesScrollFilter(img, goodsLink) {
    if (keywordMatches(keywordFilter.excludeKeywords, goodsLink)) return false;
    if (keywordFilter.includeKeywords.length > 0 && !keywordMatches(keywordFilter.includeKeywords, goodsLink)) return false;
    return insideSizeRange(img);
  }

  function clearScrollSeenOnUrlChange() {
    const nextPageUrl = window.location.href;
    if (nextPageUrl === lastPageUrl) return;
    lastPageUrl = nextPageUrl;
    seenScrollImages.clear();
  }

  function setupRouteChangeWatcher() {
    const historyRef = window.history;
    if (historyRef) {
      for (const methodName of ['pushState', 'replaceState']) {
        const original = historyRef[methodName];
        if (typeof original !== 'function') continue;
        historyRef[methodName] = function () {
          const result = original.apply(this, arguments);
          clearScrollSeenOnUrlChange();
          return result;
        };
      }
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('popstate', clearScrollSeenOnUrlChange);
    }
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
  }

  document.addEventListener('click', handleClick, true);
  setupRouteChangeWatcher();
  setupScrollObserver();
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
