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
  const listeners = new Map<string, EventListener>()
  const observed: unknown[] = []
  const observers: Array<{ trigger: (target: unknown) => void }> = []
  const anchors: unknown[] = []
  const location = {
    hostname: options.hostname ?? 'www.temu.com',
    href: options.href ?? 'https://www.temu.com/goods/1',
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
      listeners.set(event, listener)
    },
    querySelectorAll: () => anchors,
  }
  const window = {
    location,
    __poseidonSendToHost: (payload: unknown) => {
      callbacks.push(payload)
    },
  }

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

  return {
    callbacks,
    listeners,
    observed,
    observers,
    FakeImageElement,
    triggerClick: (target: unknown) => {
      listeners.get('click')?.({ target } as Event)
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

  it('does not send events outside allowed domains', () => {
    const harness = createHarness({ hostname: 'example.com', href: 'https://example.com/item/1' })
    const img = image(harness.FakeImageElement)

    harness.triggerClick(img)

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
})
