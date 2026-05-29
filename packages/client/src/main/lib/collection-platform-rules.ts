import { AppErrorClass } from '@tengyu-aipod/shared'
import type { CollectionPlatformRule } from './collection-injected-script'

const BUILT_IN_COLLECTION_PLATFORM_RULES: CollectionPlatformRule[] = [
  {
    key: 'temu',
    name: 'Temu',
    allowed_domains: ['temu.com', '*.temu.com'],
    entry_url: 'https://www.temu.com',
    goods_url_patterns: ['\\/goods\\/', '\\/goods\\.html', '-g-\\d+\\.html'],
    login_check: { indicators: ['Sign in', '登录'] },
    original_image_resolver: {
      type: 'srcset_largest',
      config: {},
    },
  },
  {
    key: 'ozon',
    name: 'Ozon',
    allowed_domains: ['ozon.ru', '*.ozon.ru', 'ozon.com', '*.ozon.com'],
    entry_url: 'https://www.ozon.ru',
    goods_url_patterns: ['\\/product\\/'],
    login_check: { indicators: ['Войти', 'Sign in'] },
    original_image_resolver: {
      type: 'srcset_largest',
      config: {},
    },
  },
  {
    key: 'shein',
    name: 'Shein',
    allowed_domains: ['shein.com', '*.shein.com'],
    entry_url: 'https://www.shein.com',
    goods_url_patterns: ['-p-'],
    login_check: { indicators: ['Sign In', '登录'] },
    original_image_resolver: {
      type: 'srcset_largest',
      config: {},
    },
  },
  {
    key: 'tiktok',
    name: 'TikTok Shop',
    allowed_domains: ['shop.tiktok.com', '*.shop.tiktok.com', '*.tiktokglobalshop.com'],
    entry_url: 'https://shop.tiktok.com',
    goods_url_patterns: ['\\/product\\/'],
    login_check: { indicators: ['Log in', '登录'] },
    original_image_resolver: {
      type: 'srcset_largest',
      config: {},
    },
  },
  {
    key: 'shopee',
    name: 'Shopee',
    allowed_domains: ['shopee.com', '*.shopee.com', 'shopee.cn', '*.shopee.cn'],
    entry_url: 'https://shopee.com',
    goods_url_patterns: ['\\/item\\/', '-i\\.'],
    login_check: { indicators: ['Login', '登录'] },
    original_image_resolver: {
      type: 'srcset_largest',
      config: {},
    },
  },
  {
    key: '1688',
    name: '1688',
    allowed_domains: ['1688.com', '*.1688.com'],
    entry_url: 'https://www.1688.com',
    goods_url_patterns: ['\\/offer\\/'],
    login_check: { indicators: ['登录', '请登录'] },
    original_image_resolver: {
      type: 'data_attr',
      config: { attr: 'data-src' },
    },
  },
  {
    key: 'mercado',
    name: 'Mercado Libre',
    allowed_domains: [
      'mercadolibre.com',
      '*.mercadolibre.com',
      'mercadolivre.com.br',
      '*.mercadolivre.com.br',
    ],
    entry_url: 'https://www.mercadolibre.com',
    goods_url_patterns: ['\\/MLB-', '\\/p\\/MLB'],
    login_check: { indicators: ['Ingresa', 'Entrar'] },
    original_image_resolver: {
      type: 'srcset_largest',
      config: {},
    },
  },
]

export function listPlatformRules(): CollectionPlatformRule[] {
  return BUILT_IN_COLLECTION_PLATFORM_RULES.map(clonePlatformRule)
}

export function getPlatformRule(key: string): CollectionPlatformRule {
  const rule = BUILT_IN_COLLECTION_PLATFORM_RULES.find((item) => item.key === key)
  if (!rule) {
    throw new AppErrorClass('PLATFORM_RULE_NOT_FOUND', '采集平台规则不存在', false, {
      kind: 'not_found',
      platform: key,
    })
  }
  return clonePlatformRule(rule)
}

function clonePlatformRule(rule: CollectionPlatformRule): CollectionPlatformRule {
  return {
    key: rule.key,
    name: rule.name,
    allowed_domains: [...rule.allowed_domains],
    entry_url: rule.entry_url,
    goods_url_patterns: [...rule.goods_url_patterns],
    original_image_resolver: cloneOriginalImageResolver(rule.original_image_resolver),
    ...(rule.login_check
      ? {
          login_check: {
            indicators: [...rule.login_check.indicators],
            ...(rule.login_check.inverse ? { inverse: [...rule.login_check.inverse] } : {}),
          },
        }
      : {}),
  }
}

function cloneOriginalImageResolver(
  resolver: CollectionPlatformRule['original_image_resolver'],
): CollectionPlatformRule['original_image_resolver'] {
  if (resolver.type === 'src_replace') {
    return {
      type: resolver.type,
      config: { ...resolver.config },
    }
  }
  if (resolver.type === 'data_attr') {
    return {
      type: resolver.type,
      config: { ...resolver.config },
    }
  }
  return {
    type: resolver.type,
    ...(resolver.config ? { config: { ...resolver.config } } : {}),
  }
}
