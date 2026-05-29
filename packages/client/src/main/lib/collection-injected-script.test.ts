import { describe, expect, it } from 'vitest'
import {
  COLLECTION_INJECTED_SCRIPT_VERSION,
  type CollectionPlatformRule,
  createCollectionInjectedScript,
} from './collection-injected-script'

const platformRule: CollectionPlatformRule = {
  key: 'temu',
  name: 'Temu',
  allowed_domains: ['temu.com', '*.temu.com'],
  entry_url: 'https://www.temu.com',
  goods_url_patterns: ['/goods/'],
  login_check: { indicators: ['Sign in'] },
  original_image_resolver: {
    type: 'src_replace',
    config: { from: '_thumb', to: '_original' },
  },
}

type HarnessOptions = {
  hostname?: string
  href?: string
  script?: string
}

type FakeDomElement = Record<string, unknown> & {
  children?: FakeDomElement[]
  closest?: (selector: string) => unknown
  tagName?: string
}

function matchesSelector(element: Record<string, unknown>, selector: string) {
  const tagName = String(element.tagName || '').toLowerCase()
  const role = typeof element.role === 'string' ? element.role : ''
  const type = typeof element.type === 'string' ? element.type : ''
  return selector
    .split(',')
    .map((item) => item.trim())
    .some((item) => {
      if (item === '[role="button"]') return role === 'button'
      if (item === 'input') return tagName === 'input' || type === 'input'
      return tagName === item
    })
}

function queryDescendants(children: FakeDomElement[] | undefined, selector: string) {
  const results: FakeDomElement[] = []
  const visit = (child: FakeDomElement) => {
    const tagName = String(child.tagName || '').toLowerCase()
    const getAttribute =
      typeof child.getAttribute === 'function' ? child.getAttribute.bind(child) : () => null
    const hasDataLink = Boolean(
      getAttribute('data-href') || getAttribute('data-url') || getAttribute('data-link'),
    )
    if (selector === 'img' && tagName === 'img') {
      results.push(child)
    }
    if (selector.includes('a[href]') && tagName === 'a' && child.href) {
      results.push(child)
    }
    if (selector.includes('[data-href]') && hasDataLink) {
      results.push(child)
    }
    for (const nested of child.children ?? []) {
      visit(nested)
    }
  }
  for (const child of children ?? []) {
    visit(child)
  }
  return results
}

function createHarness(options: HarnessOptions = {}) {
  const callbacks: unknown[] = []
  const listeners = new Map<string, EventListener[]>()
  const windowListeners = new Map<string, EventListener[]>()
  const observed: unknown[] = []
  const observers: Array<{ trigger: (target: unknown) => void }> = []
  const anchors: unknown[] = []
  const documentImages: unknown[] = []
  const pointElements: unknown[] = []
  const timers: Array<() => void> = []
  const initialHref = options.href ?? `https://${options.hostname ?? 'www.temu.com'}/goods/1`
  const initialUrl = new URL(initialHref)
  const location = {
    hostname: options.hostname ?? initialUrl.hostname,
    href: initialUrl.toString(),
  }
  const setLocationHref = (value: string) => {
    const nextUrl = new URL(value, location.href)
    location.hostname = nextUrl.hostname
    location.href = nextUrl.toString()
  }

  class FakeElement {
    [key: string]: unknown
  }
  class FakeImageElement extends FakeElement {}
  class FakeIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {
      observers.push({ trigger: (target: unknown) => this.trigger(target) })
    }

    trigger(target: unknown) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never)
    }

    observe(target: unknown) {
      observed.push(target)
    }
  }
  class FakeMutationObserver {
    observe() {}
  }

  const document = {
    documentElement: {},
    addEventListener: (event: string, listener: EventListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    removeEventListener: (event: string, listener: EventListener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((item) => item !== listener),
      )
    },
    querySelectorAll: (selector: string) => (selector === 'img' ? documentImages : anchors),
    elementFromPoint: () => pointElements[0] ?? null,
    elementsFromPoint: () => pointElements,
  }
  const window = {
    location,
    history: {
      pushState: (_state: unknown, _title: string, url?: string | URL | null) => {
        if (url !== undefined && url !== null) {
          setLocationHref(String(url))
        }
      },
      replaceState: (_state: unknown, _title: string, url?: string | URL | null) => {
        if (url !== undefined && url !== null) {
          setLocationHref(String(url))
        }
      },
    },
    addEventListener: (event: string, listener: EventListener) => {
      windowListeners.set(event, [...(windowListeners.get(event) ?? []), listener])
    },
    removeEventListener: (event: string, listener: EventListener) => {
      windowListeners.set(
        event,
        (windowListeners.get(event) ?? []).filter((item) => item !== listener),
      )
    },
    __poseidonSendToHost: (payload: unknown) => {
      callbacks.push(payload)
    },
    innerWidth: 1280,
    setTimeout: (callback: () => void) => {
      timers.push(callback)
      return timers.length
    },
    getComputedStyle: (element: Record<string, unknown>) => ({
      backgroundImage: element.backgroundImage ?? '',
    }),
  }

  const runScript = () => {
    const fn = new Function(
      'window',
      'document',
      'IntersectionObserver',
      'MutationObserver',
      'HTMLImageElement',
      'Element',
      options.script ?? createCollectionInjectedScript({ platformRule }),
    )
    fn(
      window,
      document,
      FakeIntersectionObserver,
      FakeMutationObserver,
      FakeImageElement,
      FakeElement,
    )
  }

  runScript()

  return {
    callbacks,
    listeners,
    observed,
    observers,
    FakeElement,
    FakeImageElement,
    setPointElements: (...items: unknown[]) => {
      pointElements.splice(0, pointElements.length, ...items)
    },
    setDocumentImages: (...items: unknown[]) => {
      documentImages.splice(0, documentImages.length, ...items)
    },
    flushTimers: () => {
      const pending = timers.splice(0, timers.length)
      for (const callback of pending) {
        callback()
      }
    },
    runScript,
    pushState: (url: string) => {
      window.history.pushState(null, '', url)
    },
    triggerPopState: (url: string) => {
      setLocationHref(url)
      for (const listener of windowListeners.get('popstate') ?? []) {
        listener({} as Event)
      }
    },
    triggerClick: (target: unknown, patch: Record<string, unknown> = {}) => {
      for (const listener of listeners.get('click') ?? []) {
        listener({ target, ...patch } as Event)
      }
    },
  }
}

function image(
  ImageClass: new () => Record<string, unknown>,
  options: {
    src?: string
    currentSrc?: string
    srcset?: string
    width?: number
    height?: number
    x?: number
    y?: number
    naturalWidth?: number
    naturalHeight?: number
    goodsLink?: string
    attrs?: Record<string, string>
    parentElement?: FakeDomElement | null
  } = {},
) {
  const attrs = options.attrs ?? {}
  const img = new ImageClass() as FakeDomElement
  img.src = options.src ?? 'https://img.temu.com/a_thumb.jpg'
  img.currentSrc = options.currentSrc ?? ''
  img.srcset = options.srcset ?? ''
  img.width = options.width ?? 400
  img.height = options.height ?? 300
  img.naturalWidth = options.naturalWidth ?? options.width ?? 400
  img.naturalHeight = options.naturalHeight ?? options.height ?? 300
  img.href = options.goodsLink ?? 'https://www.temu.com/goods/1'
  img.tagName = 'IMG'
  img.parentElement = options.parentElement ?? null
  img.closest = (selector: string) => {
    if (selector === 'img') {
      return img
    }
    if (matchesSelector(img, selector)) {
      return img
    }
    const parentElement = img.parentElement as FakeDomElement | null
    if (parentElement && typeof parentElement.closest === 'function') {
      return parentElement.closest(selector)
    }
    if (selector === 'a[href]') {
      return { href: img.href }
    }
    return null
  }
  img.getAttribute = (name: string) => attrs[name] ?? null
  img.getAttributeNames = () => Object.keys(attrs)
  img.getBoundingClientRect = () => ({
    left: options.x ?? 0,
    top: options.y ?? 0,
    right: (options.x ?? 0) + Number(img.width),
    bottom: (options.y ?? 0) + Number(img.height),
    width: img.width,
    height: img.height,
  })
  return img
}

function element(
  ElementClass: new () => Record<string, unknown>,
  options: {
    tagName?: string
    className?: string
    role?: string
    children?: FakeDomElement[]
    parentElement?: FakeDomElement | null
    href?: string
    backgroundImage?: string
    width?: number
    height?: number
    attrs?: Record<string, string>
  } = {},
) {
  const attrs = options.attrs ?? {}
  const item = new ElementClass() as FakeDomElement
  item.tagName = options.tagName ?? 'DIV'
  item.className = options.className ?? ''
  item.role = options.role ?? ''
  item.parentElement = options.parentElement ?? null
  item.href = options.href ?? 'https://www.temu.com/goods/1'
  item.backgroundImage = options.backgroundImage ?? ''
  item.children = options.children ?? []
  item.closest = (selector: string) => {
    if (matchesSelector(item, selector)) {
      return item
    }
    if (selector === 'a[href]' && item.href) {
      return { href: item.href }
    }
    if (selector === '[data-href], [data-url], [data-link]') {
      return attrs['data-href'] || attrs['data-url'] || attrs['data-link'] ? item : null
    }
    return null
  }
  item.getAttribute = (name: string) => (name === 'href' ? item.href : attrs[name]) ?? null
  item.getAttributeNames = () => [...Object.keys(attrs), ...(item.href ? ['href'] : [])]
  item.querySelectorAll = (selector: string) => queryDescendants(item.children, selector)
  item.querySelector = (selector: string) => {
    if (
      selector === 'source[srcset], source[data-srcset]' ||
      selector === 'img, picture, source[srcset], source[data-srcset]'
    ) {
      return (item.children ?? []).find((child) => {
        return (
          child instanceof Object &&
          'tagName' in child &&
          ['IMG', 'PICTURE', 'SOURCE'].includes(String(child.tagName))
        )
      })
    }
    return null
  }
  item.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: options.width ?? 500,
    bottom: options.height ?? 500,
    width: options.width ?? 500,
    height: options.height ?? 500,
  })
  return item
}

describe('createCollectionInjectedScript', () => {
  it('captures clicked images and resolves original URLs by src replacement', () => {
    const harness = createHarness()
    const img = image(harness.FakeImageElement)

    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
      }),
      {
        kind: 'click',
        img: 'https://img.temu.com/a_original.jpg',
        goodsLink: 'https://www.temu.com/goods/1',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('captures clicks that land on a visible image overlay', () => {
    const harness = createHarness()
    const overlay = new harness.FakeElement()
    overlay.closest = () => null
    const img = image(harness.FakeImageElement, {
      src: 'https://img.temu.com/overlay_thumb.jpg',
      width: 500,
      height: 500,
      naturalWidth: 500,
      naturalHeight: 500,
    })
    harness.setPointElements(overlay, img)

    harness.triggerClick(overlay, { clientX: 250, clientY: 250 })

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
      }),
      {
        kind: 'click',
        img: 'https://img.temu.com/overlay_original.jpg',
        goodsLink: 'https://www.temu.com/goods/1',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('captures clicks on product containers when the image is a child of the clicked element', () => {
    const harness = createHarness()
    const container = element(harness.FakeElement, {
      tagName: 'DIV',
      className: 'goods-card',
      href: 'https://www.temu.com/goods/container',
    })
    const img = image(harness.FakeImageElement, {
      src: 'https://img.temu.com/container_thumb.jpg',
      width: 500,
      height: 500,
      naturalWidth: 500,
      naturalHeight: 500,
      parentElement: container,
    })
    container.children = [img]

    harness.triggerClick(container, { clientX: 250, clientY: 250 })

    expect(harness.callbacks).toEqual([
      {
        kind: 'debug',
        level: 'debug',
        message: '页面点击已识别图片',
        details: {
          script_version: COLLECTION_INJECTED_SCRIPT_VERSION,
          runtime_mode: 'both',
          image_url: 'https://img.temu.com/container_original.jpg',
          goods_link: 'https://www.temu.com/goods/container',
          image_source: 'img',
        },
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
      {
        kind: 'click',
        img: 'https://img.temu.com/container_original.jpg',
        goodsLink: 'https://www.temu.com/goods/container',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('captures clicks on product containers when the image is a CSS background', () => {
    const harness = createHarness()
    const container = element(harness.FakeElement, {
      tagName: 'DIV',
      className: 'goods-card',
      backgroundImage: 'url("https://img.temu.com/background_thumb.jpg")',
      href: 'https://www.temu.com/goods/background',
      width: 640,
      height: 640,
    })

    harness.triggerClick(container, { clientX: 250, clientY: 250 })

    expect(harness.callbacks).toEqual([
      {
        kind: 'debug',
        level: 'debug',
        message: '页面点击已识别图片',
        details: {
          script_version: COLLECTION_INJECTED_SCRIPT_VERSION,
          runtime_mode: 'both',
          image_url: 'https://img.temu.com/background_original.jpg',
          goods_link: 'https://www.temu.com/goods/background',
          image_source: 'background',
        },
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
      {
        kind: 'click',
        img: 'https://img.temu.com/background_original.jpg',
        goodsLink: 'https://www.temu.com/goods/background',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('captures Temu lazy images whose URL is stored in data attributes', () => {
    const harness = createHarness()
    const img = image(harness.FakeImageElement, {
      src: '',
      currentSrc: '',
      attrs: {
        'data-src': 'https://img.kwcdn.com/product/fancy/lazy-image.jpg',
      },
      width: 640,
      height: 640,
      naturalWidth: 640,
      naturalHeight: 640,
    })

    harness.triggerClick(img, { clientX: 250, clientY: 250 })

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
        details: expect.objectContaining({
          image_url: 'https://img.kwcdn.com/product/fancy/lazy-image.jpg',
          image_source: 'img',
        }),
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.kwcdn.com/product/fancy/lazy-image.jpg',
      }),
    ])
  })

  it('falls back to the Temu top_gallery_url when a clicked gallery container has no image URL', () => {
    const harness = createHarness({
      href: 'https://www.temu.com/ca/example-g-123.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Ftop-gallery-goods.jpeg',
    })
    const container = element(harness.FakeElement, {
      tagName: 'DIV',
      className: '_3ACovDZO _2KR3lLmI',
      width: 640,
      height: 640,
    })

    harness.triggerClick(container, { clientX: 250, clientY: 250 })

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
        details: expect.objectContaining({
          image_url: 'https://img.kwcdn.com/product/open/top-gallery-goods.jpeg',
          image_source: 'page_top_gallery',
        }),
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.kwcdn.com/product/open/top-gallery-goods.jpeg',
      }),
    ])
  })

  it('falls back to top_gallery_url when a gallery overlay is above the thumbnail wrapper', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      sizeFilter: { min_width: 600, min_height: 600 },
    })
    const harness = createHarness({
      href: 'https://www.temu.com/ca/example-g-123.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Ftop-gallery-goods.jpeg',
      script,
    })
    const overlay = element(harness.FakeElement, {
      tagName: 'DIV',
      className: 'transparent-layer',
      width: 20,
      height: 20,
    })
    const thumbnailWrapper = element(harness.FakeElement, {
      tagName: 'DIV',
      className: '_3ACovDZO _2KR3lLmI',
      role: 'option',
      width: 58,
      height: 58,
    })
    harness.setPointElements(overlay, thumbnailWrapper)

    harness.triggerClick(overlay, { clientX: 30, clientY: 30 })

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
        details: expect.objectContaining({
          image_url: 'https://img.kwcdn.com/product/open/top-gallery-goods.jpeg',
          image_source: 'page_top_gallery',
        }),
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.kwcdn.com/product/open/top-gallery-goods.jpeg',
      }),
    ])
  })

  it('falls back to top_gallery_url for small Temu thumbnail wrappers without applying the thumbnail size', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      sizeFilter: { min_width: 600, min_height: 600 },
    })
    const harness = createHarness({
      href: 'https://www.temu.com/ca/example-g-123.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Ftop-gallery-goods.jpeg',
      script,
    })
    const thumbnail = element(harness.FakeElement, {
      tagName: 'DIV',
      className: '_3ACovDZO _2KR3lLmI',
      role: 'button',
      width: 58,
      height: 58,
    })

    harness.triggerClick(thumbnail, { clientX: 30, clientY: 30 })
    harness.flushTimers()

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
        details: expect.objectContaining({
          image_url: 'https://img.kwcdn.com/product/open/top-gallery-goods.jpeg',
          image_source: 'page_top_gallery',
        }),
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.kwcdn.com/product/open/top-gallery-goods.jpeg',
      }),
    ])
  })

  it('captures the displayed large gallery image after a Temu thumbnail click switches it', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      sizeFilter: { min_width: 600, min_height: 600 },
    })
    const harness = createHarness({
      href: 'https://www.temu.com/ca/example-g-123.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Ffirst-gallery-goods.jpeg',
      script,
    })
    const thumbnail = element(harness.FakeElement, {
      tagName: 'DIV',
      className: '_3ACovDZO _2KR3lLmI',
      role: 'button',
      width: 58,
      height: 58,
    })
    const selectedLargeImage = image(harness.FakeImageElement, {
      src: 'https://img.temu.com/selected_thumb.jpg',
      width: 720,
      height: 720,
      naturalWidth: 1200,
      naturalHeight: 1200,
    })

    harness.triggerClick(thumbnail, { clientX: 30, clientY: 30 })
    expect(harness.callbacks).toEqual([])

    harness.setDocumentImages(selectedLargeImage)
    harness.flushTimers()

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
        details: expect.objectContaining({
          image_url: 'https://img.temu.com/selected_original.jpg',
          image_source: 'gallery_current_img',
        }),
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.temu.com/selected_original.jpg',
      }),
    ])
  })

  it('prefers the centered Temu gallery image after a thumbnail click', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      sizeFilter: { min_width: 600, min_height: 600 },
    })
    const harness = createHarness({
      href: 'https://www.temu.com/ca/example-g-123.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Ffallback-goods.jpeg',
      script,
    })
    const thumbnail = element(harness.FakeElement, {
      tagName: 'DIV',
      className: '_3ACovDZO _2KR3lLmI',
      role: 'button',
      width: 58,
      height: 58,
    })
    const previousImage = image(harness.FakeImageElement, {
      src: 'https://img.temu.com/previous_thumb.jpg',
      x: -284,
      y: 160,
      width: 609,
      height: 609,
      naturalWidth: 1300,
      naturalHeight: 1300,
    })
    const centeredImage = image(harness.FakeImageElement, {
      src: 'https://img.temu.com/current_thumb.jpg',
      x: 325,
      y: 160,
      width: 609,
      height: 609,
      naturalWidth: 1300,
      naturalHeight: 1300,
    })
    const nextImage = image(harness.FakeImageElement, {
      src: 'https://img.temu.com/next_thumb.jpg',
      x: 934,
      y: 160,
      width: 609,
      height: 609,
      naturalWidth: 1300,
      naturalHeight: 1300,
    })

    harness.triggerClick(thumbnail, { clientX: 30, clientY: 30 })
    harness.setDocumentImages(previousImage, centeredImage, nextImage)
    harness.flushTimers()

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
        details: expect.objectContaining({
          image_url: 'https://img.temu.com/current_original.jpg',
          image_source: 'gallery_current_img',
        }),
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.temu.com/current_original.jpg',
      }),
    ])
  })

  it('does not use top_gallery_url fallback for non-gallery action buttons', () => {
    const harness = createHarness({
      href: 'https://www.temu.com/ca/example-g-123.html?top_gallery_url=https%3A%2F%2Fimg.kwcdn.com%2Fproduct%2Fopen%2Ftop-gallery-goods.jpeg',
    })
    const button = element(harness.FakeElement, {
      tagName: 'BUTTON',
      className: 'add-to-cart',
      width: 140,
      height: 44,
    })

    harness.triggerClick(button, { clientX: 950, clientY: 560 })

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击未识别到可采集图片',
      }),
    ])
  })

  it('emits a debug log when a click does not resolve to an image', () => {
    const harness = createHarness()
    const button = element(harness.FakeElement, {
      tagName: 'BUTTON',
      className: 'buy-now',
      href: '',
    })

    harness.triggerClick(button, { clientX: 25, clientY: 25 })

    expect(harness.callbacks).toEqual([
      {
        kind: 'debug',
        level: 'debug',
        message: '页面点击未识别到可采集图片',
        details: expect.objectContaining({
          script_version: COLLECTION_INJECTED_SCRIPT_VERSION,
          runtime_mode: 'both',
          target: 'button.buy-now',
          click_x: 25,
          click_y: 25,
          top_gallery_url_present: false,
        }),
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('does not emit scroll events in click-only runtime mode', () => {
    const script = createCollectionInjectedScript({ platformRule, mode: 'click' })
    const harness = createHarness({ script })
    const img = image(harness.FakeImageElement)

    expect(harness.observers).toEqual([])
    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
      }),
      expect.objectContaining({
        kind: 'click',
        img: 'https://img.temu.com/a_original.jpg',
      }),
    ])
  })

  it('replaces previous click listeners when the script is injected again', () => {
    const harness = createHarness()
    const img = image(harness.FakeImageElement)

    harness.runScript()
    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
      }),
      {
        kind: 'click',
        img: 'https://img.temu.com/a_original.jpg',
        goodsLink: 'https://www.temu.com/goods/1',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('stays inert outside allowed domains', () => {
    const harness = createHarness({ hostname: 'example.com', href: 'https://example.com/item/1' })
    const img = image(harness.FakeImageElement)

    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([])
    expect(harness.observers).toEqual([])
    expect(harness.observed).toEqual([])
  })

  it('drops clicked images outside the configured size range', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      sizeFilter: { min_width: 600 },
    })
    const harness = createHarness({ script })
    const img = image(harness.FakeImageElement, {
      width: 500,
      naturalWidth: 500,
    })

    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击未识别到可采集图片',
      }),
    ])
  })

  it('uses the preferred Temu image URL before applying the size filter', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      sizeFilter: { min_width: 300, min_height: 300 },
    })
    const harness = createHarness({ script })
    const img = image(harness.FakeImageElement, {
      src: 'https://img.kwcdn.com/product/example.jpg?imageView2/2/w/150/q/50/format/avif',
      width: 178,
      height: 178,
      naturalWidth: 150,
      naturalHeight: 150,
    })

    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击已识别图片',
      }),
      {
        kind: 'click',
        img: 'https://img.kwcdn.com/product/example.jpg?imageView2/2/w/800/q/90/format/avif',
        goodsLink: 'https://www.temu.com/goods/1',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('drops clicked data and blob image URLs', () => {
    const harness = createHarness()
    const dataImage = image(harness.FakeImageElement, {
      src: 'data:image/png;base64,a_thumb',
    })
    const blobImage = image(harness.FakeImageElement, {
      src: 'blob:https://www.temu.com/image-1',
    })

    harness.triggerClick(dataImage)
    harness.triggerClick(blobImage)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击未识别到可采集图片',
      }),
      expect.objectContaining({
        kind: 'debug',
        message: '页面点击未识别到可采集图片',
      }),
    ])
  })

  it('supports data attribute original image resolver', () => {
    const rule: CollectionPlatformRule = {
      ...platformRule,
      original_image_resolver: { type: 'data_attr', config: { attr: 'data-original' } },
    }
    const harness = createHarness({
      script: createCollectionInjectedScript({ platformRule: rule }),
    })
    const img = image(harness.FakeImageElement, {
      attrs: { 'data-original': '/images/original.jpg' },
    })

    harness.triggerClick(img)

    expect(harness.callbacks[1]).toMatchObject({
      img: 'https://www.temu.com/images/original.jpg',
    })
  })

  it('supports srcset largest original image resolver', () => {
    const rule: CollectionPlatformRule = {
      ...platformRule,
      original_image_resolver: { type: 'srcset_largest', config: {} },
    }
    const harness = createHarness({
      script: createCollectionInjectedScript({ platformRule: rule }),
    })
    const img = image(harness.FakeImageElement, {
      srcset: '/small.jpg 320w, /large.jpg 1200w',
    })

    harness.triggerClick(img)

    expect(harness.callbacks[1]).toMatchObject({
      img: 'https://www.temu.com/large.jpg',
    })
  })

  it('captures visible scroll images once after keyword and size filtering', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      scrollFilter: {
        excludeKeywords: ['ad'],
        includeKeywords: ['goods'],
        minWidth: 300,
      },
    })
    const harness = createHarness({ script })
    const img = image(harness.FakeImageElement, {
      src: 'https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/500/q/70/format/avif',
      goodsLink: 'https://www.temu.com/goods/1',
      width: 500,
      naturalWidth: 500,
      attrs: { 'data-js-main-img': 'true' },
    })
    harness.observers[0]?.trigger(img)
    harness.observers[0]?.trigger(img)

    expect(harness.callbacks).toEqual([
      {
        kind: 'scroll',
        img: 'https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/800/q/90/format/avif',
        goodsLink: 'https://www.temu.com/goods/1',
        width: 500,
        height: 300,
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('keeps only Temu product card main images during scroll collection', () => {
    const rule: CollectionPlatformRule = {
      ...platformRule,
      goods_url_patterns: ['\\/goods\\/', '\\/goods\\.html', '-g-\\d+\\.html'],
      original_image_resolver: { type: 'srcset_largest', config: {} },
    }
    const harness = createHarness({
      script: createCollectionInjectedScript({ platformRule: rule }),
      href: 'https://www.temu.com/search_result.html?search_key=six%20seven',
    })
    const goodsLink = 'https://www.temu.com/ca/example-product-g-601105824553551.html'
    const link = element(harness.FakeElement, { tagName: 'A', href: goodsLink })
    const card = element(harness.FakeElement, { children: [link], href: '' })
    const imageContainer = element(harness.FakeElement, { parentElement: card, href: '' })
    const badge = image(harness.FakeImageElement, {
      src: 'https://aimg.kwcdn.com/upload_aimg/commodity/badge.png',
      width: 51,
      height: 18,
      naturalWidth: 51,
      naturalHeight: 18,
      parentElement: imageContainer,
    })
    const thumbnail = image(harness.FakeImageElement, {
      src: 'https://img.kwcdn.com/product/fancy/example.jpg?imageView2/2/w/150/q/50/format/avif',
      width: 256,
      height: 256,
      naturalWidth: 150,
      naturalHeight: 150,
      parentElement: imageContainer,
    })
    const mainImage = image(harness.FakeImageElement, {
      src: 'https://img.kwcdn.com/product/fancy/example.jpg?imageView2/2/w/500/q/70/format/avif',
      width: 256,
      height: 256,
      naturalWidth: 500,
      naturalHeight: 500,
      attrs: { 'data-js-main-img': 'true' },
      parentElement: imageContainer,
    })

    harness.observers[0]?.trigger(badge)
    harness.observers[0]?.trigger(thumbnail)
    harness.observers[0]?.trigger(mainImage)

    expect(harness.callbacks).toEqual([
      {
        kind: 'scroll',
        img: 'https://img.kwcdn.com/product/fancy/example.jpg?imageView2/2/w/800/q/90/format/avif',
        goodsLink,
        width: 500,
        height: 500,
        platform: 'temu',
        page: 'https://www.temu.com/search_result.html?search_key=six%20seven',
      },
    ])
  })

  it('drops scroll images when exclude keywords match before include keywords', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      scrollFilter: {
        excludeKeywords: ['promo'],
        includeKeywords: ['goods'],
      },
    })
    const harness = createHarness({ script })
    const img = image(harness.FakeImageElement, {
      goodsLink: 'https://www.temu.com/goods/promo-shirt',
    })

    harness.observers[0]?.trigger(img)

    expect(harness.callbacks).toEqual([])
  })

  it('drops scroll images outside the configured size range', () => {
    const script = createCollectionInjectedScript({
      platformRule,
      scrollFilter: {
        minWidth: 600,
        maxHeight: 500,
      },
    })
    const harness = createHarness({ script })
    const tooSmall = image(harness.FakeImageElement, {
      goodsLink: 'https://www.temu.com/goods/1',
      width: 500,
      height: 300,
      naturalWidth: 500,
      naturalHeight: 300,
    })
    const tooTall = image(harness.FakeImageElement, {
      goodsLink: 'https://www.temu.com/goods/2',
      width: 700,
      height: 800,
      naturalWidth: 700,
      naturalHeight: 800,
    })

    harness.observers[0]?.trigger(tooSmall)
    harness.observers[0]?.trigger(tooTall)

    expect(harness.callbacks).toEqual([])
  })

  it('clears seen scroll images when pushState changes the URL', () => {
    const harness = createHarness()
    const img = image(harness.FakeImageElement, {
      src: 'https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/500/q/70/format/avif',
      goodsLink: 'https://www.temu.com/goods/1',
      attrs: { 'data-js-main-img': 'true' },
    })

    harness.observers[0]?.trigger(img)
    harness.observers[0]?.trigger(img)
    harness.pushState('/goods/2')
    harness.observers[0]?.trigger(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'scroll',
        img: 'https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/800/q/90/format/avif',
        page: 'https://www.temu.com/goods/1',
      }),
      expect.objectContaining({
        kind: 'scroll',
        img: 'https://img.kwcdn.com/product/fancy/a.jpg?imageView2/2/w/800/q/90/format/avif',
        page: 'https://www.temu.com/goods/2',
      }),
    ])
  })
})
