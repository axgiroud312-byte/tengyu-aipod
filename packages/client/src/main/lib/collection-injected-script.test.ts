import { describe, expect, it } from 'vitest'
import {
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

function createHarness(options: HarnessOptions = {}) {
  const callbacks: unknown[] = []
  const listeners = new Map<string, EventListener[]>()
  const windowListeners = new Map<string, EventListener[]>()
  const observed: unknown[] = []
  const observers: Array<{ trigger: (target: unknown) => void }> = []
  const anchors: unknown[] = []
  const pointElements: unknown[] = []
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
    querySelectorAll: () => anchors,
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
    naturalWidth?: number
    naturalHeight?: number
    goodsLink?: string
    attrs?: Record<string, string>
  } = {},
) {
  const attrs = options.attrs ?? {}
  const img = new ImageClass()
  img.src = options.src ?? 'https://img.temu.com/a_thumb.jpg'
  img.currentSrc = options.currentSrc ?? ''
  img.srcset = options.srcset ?? ''
  img.width = options.width ?? 400
  img.height = options.height ?? 300
  img.naturalWidth = options.naturalWidth ?? options.width ?? 400
  img.naturalHeight = options.naturalHeight ?? options.height ?? 300
  img.href = options.goodsLink ?? 'https://www.temu.com/goods/1'
  img.closest = (selector: string) => {
    if (selector === 'img') {
      return img
    }
    if (selector === 'a[href]') {
      return { href: img.href }
    }
    return null
  }
  img.getAttribute = (name: string) => attrs[name] ?? null
  img.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: img.width,
    bottom: img.height,
    width: img.width,
    height: img.height,
  })
  return img
}

describe('createCollectionInjectedScript', () => {
  it('captures clicked images and resolves original URLs by src replacement', () => {
    const harness = createHarness()
    const img = image(harness.FakeImageElement)

    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
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
      {
        kind: 'click',
        img: 'https://img.temu.com/overlay_original.jpg',
        goodsLink: 'https://www.temu.com/goods/1',
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
      },
    ])
  })

  it('replaces previous click listeners when the script is injected again', () => {
    const harness = createHarness()
    const img = image(harness.FakeImageElement)

    harness.runScript()
    harness.triggerClick(img)

    expect(harness.callbacks).toEqual([
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

    expect(harness.callbacks).toEqual([])
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
      {
        kind: 'click',
        img: 'https://img.kwcdn.com/product/example.jpg?imageView2/2/w/500/q/50/format/avif',
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

    expect(harness.callbacks).toEqual([])
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

    expect(harness.callbacks[0]).toMatchObject({
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

    expect(harness.callbacks[0]).toMatchObject({
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
      goodsLink: 'https://www.temu.com/goods/1',
      width: 500,
      naturalWidth: 500,
    })
    harness.observers[0]?.trigger(img)
    harness.observers[0]?.trigger(img)

    expect(harness.callbacks).toEqual([
      {
        kind: 'scroll',
        img: 'https://img.temu.com/a_original.jpg',
        goodsLink: 'https://www.temu.com/goods/1',
        width: 500,
        height: 300,
        platform: 'temu',
        page: 'https://www.temu.com/goods/1',
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
      goodsLink: 'https://www.temu.com/goods/1',
    })

    harness.observers[0]?.trigger(img)
    harness.observers[0]?.trigger(img)
    harness.pushState('/goods/2')
    harness.observers[0]?.trigger(img)

    expect(harness.callbacks).toEqual([
      expect.objectContaining({
        kind: 'scroll',
        img: 'https://img.temu.com/a_original.jpg',
        page: 'https://www.temu.com/goods/1',
      }),
      expect.objectContaining({
        kind: 'scroll',
        img: 'https://img.temu.com/a_original.jpg',
        page: 'https://www.temu.com/goods/2',
      }),
    ])
  })
})
