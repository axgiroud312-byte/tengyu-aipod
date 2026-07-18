import { describe, expect, it } from 'vitest'
import {
  rendererContentSecurityPolicy,
  rendererContentSecurityPolicyResponse,
} from './window-security'

function parseDirectives(policy: string) {
  return new Map(
    policy.split(';').map((directive) => {
      const [name = '', ...sources] = directive.trim().split(/\s+/)
      return [name, sources]
    }),
  )
}

describe('renderer security', () => {
  it('uses a restrictive production content security policy', () => {
    const directives = parseDirectives(rendererContentSecurityPolicy(true))

    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('connect-src')).toEqual(["'self'"])
    expect(directives.get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https:',
      'tengyu-local-image:',
    ])
    expect(directives.get('media-src')).toEqual(["'self'", 'blob:', 'file:'])
    expect(directives.get('font-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('frame-src')).toEqual(["'none'"])
  })

  it('limits development allowances to Vite scripts, sockets, and HTTP images', () => {
    const directives = parseDirectives(rendererContentSecurityPolicy(false))

    expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'ws://localhost:*',
      'ws://127.0.0.1:*',
    ])
    expect(directives.get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'http://localhost:*',
      'http://127.0.0.1:*',
      'https:',
      'tengyu-local-image:',
    ])
  })

  it('replaces the CSP header only on main document responses', () => {
    const mainFrame = rendererContentSecurityPolicyResponse(
      {
        resourceType: 'mainFrame',
        responseHeaders: {
          'Content-Type': ['text/html'],
          'content-security-policy': ['default-src *'],
        },
      },
      true,
    )
    const image = rendererContentSecurityPolicyResponse(
      {
        resourceType: 'image',
        responseHeaders: { 'Content-Type': ['image/png'] },
      },
      true,
    )

    expect(mainFrame.responseHeaders).toEqual({
      'Content-Security-Policy': [rendererContentSecurityPolicy(true)],
      'Content-Type': ['text/html'],
    })
    expect(image.responseHeaders).toEqual({ 'Content-Type': ['image/png'] })
  })
})
