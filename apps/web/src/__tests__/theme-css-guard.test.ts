import { describe, expect, it } from 'vitest'

import {
  collectCssAssetRefs,
  collectThemeFontRefs,
  rewriteThemeFontRefs,
  sanitizeThemeCssField,
  validateContentCss,
  validateUiCss,
} from '@/lib/theme-css-guard'

describe('validateContentCss', () => {
  it('accepts ordinary content rules and nested at-rules', () => {
    const result = validateContentCss(`
      [data-bd-chapter-title] { text-align: center !important; color: #b45309; font-size: 1.6rem; }
      p { text-indent: 2em; }
      blockquote { margin: 1em 0; border-left: 3px solid #888; }
      @media (min-width: 600px) {
        p { line-height: 1.8; }
        @supports (display: grid) { img { max-width: 100%; } }
      }
    `)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('rejects html/body subjects but allows descendant selectors over them', () => {
    expect(validateContentCss('html { color: red }').ok).toBe(false)
    expect(validateContentCss('body { margin: 0 }').ok).toBe(false)
    expect(validateContentCss('BODY { color: red }').ok).toBe(false)
    expect(validateContentCss(':root { --x: 1 }').ok).toBe(false)
    expect(validateContentCss('body p { color: red }').ok).toBe(true)
    expect(validateContentCss('body > p { margin: 0 }').ok).toBe(true)
    expect(validateContentCss('html body p { color: red }').ok).toBe(true)
  })

  it('blocks resource-loading values including obfuscated spellings', () => {
    expect(validateContentCss('p { background: url(https://x.example/a.png) }').ok).toBe(false)
    expect(validateContentCss('p { background: image-set("a.png" 1x) }').ok).toBe(false)
    expect(validateContentCss('p { background: -webkit-image-set("a.png" 1x) }').ok).toBe(false)
    expect(validateContentCss('p { background-image: u\\72l(https://x.example/a.png) }').ok).toBe(false)
    expect(validateContentCss('p { background-image: ur/**/l(https://x.example/a.png) }').ok).toBe(false)
    expect(validateContentCss('p { background: element(#x) }').ok).toBe(false)
    expect(validateContentCss('p { content: url(x.png) }').ok).toBe(false)
    // safe functions stay allowed
    expect(validateContentCss('p { color: rgb(1 2 3); width: calc(100% - 2rem); }').ok).toBe(true)
    expect(validateContentCss('p { color: color-mix(in srgb, red, blue); }').ok).toBe(true)
  })

  it('blocks @import and @font-face with located errors', () => {
    const result = validateContentCss('p { color: red }\n@import url(theme.css);')
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.line).toBe(2)
    expect(result.css).toBe('')
    expect(validateContentCss('@font-face { font-family: x; src: url(a.woff2) }').ok).toBe(false)
  })

  it('scopes each selector to content descendants and keeps pseudo-elements working', () => {
    const result = validateContentCss('p::before, body blockquote, * { color: red }')
    expect(result.ok).toBe(true)
    expect(result.scopedCss).toContain('p:where(body *)::before, body blockquote:where(body *), *:where(body *)')
    const escaped = 'p { \\62 ackground-color: red }'
    expect(validateContentCss(escaped).scopedCss).toContain('\\62 ackground-color: red')
  })

  it('rejects indirect resource values and rules that would register page-wide names', () => {
    expect(validateContentCss('p { background: var(--existing-image) }').ok).toBe(false)
    expect(validateContentCss('@keyframes fade { from { opacity: 0 } to { opacity: 1 } }').ok).toBe(false)
    expect(validateContentCss('@layer page { p { color: red } }').ok).toBe(false)
    expect(validateContentCss('p { color: rgb(0 0 0 }').ok).toBe(false)
  })

  it('reports malformed input with a line number and fails atomically', () => {
    const result = validateContentCss('p { color: red\nh1 { size: 2 } }')
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]?.line).toBeGreaterThan(0)
    expect(result.css).toBe('')
  })

  it('treats empty input as valid', () => {
    expect(validateContentCss('')).toEqual({ ok: true, css: '', scopedCss: '', issues: [] })
    expect(validateContentCss('   \n  ').ok).toBe(true)
  })
})

describe('validateUiCss', () => {
  it('accepts the documented root targets with paint properties', () => {
    const result = validateUiCss(`
      [data-bd-ui="header"] { background: #2b2b2b; color: #eee; }
      [data-bd-ui="footer"] { border-top: 2px solid gold; border-radius: 12px; }
      [data-bd-ui="toolbar"] { border-radius: 9999px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
      [data-bd-ui="outside"] { border: 6px double #8a7a5f; background-image: linear-gradient(#123, #456); }
      [data-bd-ui="header"]:hover { color: white; }
      [data-bd-ui="footer"]::after { content: ""; }
    `)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('splits outside-rooted rules for section-document injection', () => {
    const result = validateUiCss(`
      [data-bd-ui="header"] { color: red; }
      [data-bd-ui="footer"], [data-bd-ui='outside'] { border: 1px solid teal; }
      [data-bd-ui=outside]:hover { border-width: 2px; }
    `)
    expect(result.ok).toBe(true)
    expect(result.outsideCss).toContain('border: 1px solid teal')
    expect(result.outsideCss).toContain(':hover')
    expect(result.outsideCss).not.toContain('color: red')
    expect(result.outsideCss).not.toContain('footer')
    expect(result.hostCss).toContain('[data-bd-ui="footer"]:where([data-bd-user-ui-root], [data-bd-user-ui-root] *)')
  })

  it('rejects combinators, descendants and foreign selectors', () => {
    expect(validateUiCss('[data-bd-ui="header"] button { color: red }').ok).toBe(false)
    expect(validateUiCss('body [data-bd-ui="header"] { color: red }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] > * { color: red }').ok).toBe(false)
    expect(validateUiCss('.settings-panel { display: none }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="unknown"] { color: red }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui] { color: red }').ok).toBe(false)
  })

  it('enforces the paint-only property scope to keep chrome reachable', () => {
    expect(validateUiCss('[data-bd-ui="header"] { display: none }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] { opacity: 0 }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] { visibility: hidden }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] { position: fixed }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] { pointer-events: none }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] { height: 0 }').ok).toBe(false)
    expect(validateUiCss('[data-bd-ui="header"] { transform: translateY(100px) }').ok).toBe(false)
  })

  it('blocks resource values and @keyframes', () => {
    expect(validateUiCss('[data-bd-ui="header"] { background: url(a.png) }').ok).toBe(false)
    expect(validateUiCss('@keyframes x { from { color: red } } [data-bd-ui="header"] { color: red }').ok).toBe(false)
    expect(validateUiCss('@media (min-width: 600px) { [data-bd-ui="header"] { color: red } }').ok).toBe(true)
  })
})

describe('sanitizeThemeCssField', () => {
  it('keeps absent fields undefined and drops invalid blocks to empty strings', () => {
    expect(sanitizeThemeCssField(undefined, 'content')).toBeUndefined()
    expect(sanitizeThemeCssField(null, 'ui')).toBeUndefined()
    expect(sanitizeThemeCssField(42, 'content')).toBe('')
    expect(sanitizeThemeCssField('  ', 'content')).toBe('')
    expect(sanitizeThemeCssField('p { color: red }', 'content')).toBe('p { color: red }')
    expect(sanitizeThemeCssField('body { color: red }', 'content')).toBe('')
    expect(sanitizeThemeCssField('[data-bd-ui="header"] { color: red }', 'ui')).toBe('[data-bd-ui="header"] { color: red }')
    expect(sanitizeThemeCssField('[data-bd-ui="header"] { position: fixed }', 'ui')).toBe('')
  })
})

describe('theme asset references (phase 4)', () => {
  it('accepts the strict bd-asset url form in content and UI CSS', () => {
    const content = validateContentCss('p { background-image: url("bd-asset:asset-abc_123") }')
    expect(content.ok).toBe(true)
    expect(content.css).toContain('bd-asset:asset-abc_123')
    const ui = validateUiCss('[data-bd-ui="outside"] { background-image: url(\'bd-asset:asset-abc\') }')
    expect(ui.ok).toBe(true)
  })

  it('rejects url() payloads other than bd-asset references', () => {
    const payloads = [
      'url("https://example.com/x.png")',
      'url("/relative.png")',
      'url("../up.png")',
      'url("data:image/png;base64,AAAA")',
      'url("blob:https://example.com/x")',
      'url(bd-asset:x)',
      'url("bd-asset:bad id")',
      'url("bd-asset:")',
      'url("bd-asset:x\\35")',
      'url("bd-asset:x", "y")',
      'url("bd-asset:x" junk)',
    ]
    for (const payload of payloads) {
      const r = validateContentCss(`p { background-image: ${payload} }`)
      if (r.ok) console.log('ACCEPTED:', JSON.stringify(payload), JSON.stringify(r.issues))
      expect(r.ok).toBe(false)
    }
  })

  it('still rejects obfuscated resource spellings with external payloads', () => {
    // escape resolution normalizes the obfuscated function name, so the payload
    // rules apply: external URLs stay rejected even behind an obfuscated spelling
    expect(validateContentCss('p { background-image: u\\72l("https://example.com/x.png") }').ok).toBe(false)
    expect(validateContentCss('p { background-image: ur/**/l("https://example.com/x.png") }').ok).toBe(false)
    expect(validateContentCss('p { background-image: image-set("bd-asset:x" 1x) }').ok).toBe(false)
  })

  it('validates references against the supplied manifest with located issues', () => {
    const result = validateContentCss('p { color: red }\np { background-image: url("bd-asset:missing") }', { ids: new Set(['asset-known']) })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('missing') && issue.line === 2)).toBe(true)
    const known = validateContentCss('p { background-image: url("bd-asset:asset-known") }', { ids: new Set(['asset-known']) })
    expect(known.ok).toBe(true)
    // ingest keeps the leniency: unknown ids pass without a manifest
    expect(sanitizeThemeCssField('p { background-image: url("bd-asset:whatever") }', 'content')).toContain('bd-asset:whatever')
  })

  it('rewrites references through the resolver and drops declarations with missing assets', () => {
    const resolve = (id: string) => (id === 'asset-ok' ? 'blob:http://localhost/1' : null)
    const content = validateContentCss('p { color: red; background-image: url("bd-asset:asset-ok") }\nq { border-left: 1px solid red; background: url("bd-asset:asset-gone") }', { resolve })
    expect(content.ok).toBe(true)
    expect(content.scopedCss).toContain('url("blob:http://localhost/1")')
    expect(content.scopedCss).not.toContain('bd-asset:asset-gone')
    expect(content.scopedCss).not.toContain('background: url')
    expect(content.scopedCss).toContain('color: red')
    expect(content.scopedCss).toContain('border-left')
  })

  it('resolves later declarations when an earlier image is missing', () => {
    const result = validateContentCss('p { background-image: url("bd-asset:missing"); border-image-source: url( "bd-asset:present" ) }', {
      resolve: (id) => id === 'present' ? 'blob:http://localhost/present' : null,
    })
    expect(result.ok).toBe(true)
    expect(result.scopedCss).toContain('blob:http://localhost/present')
    expect(result.scopedCss).not.toContain('bd-asset:')
  })

  it('routes each selector of a mixed image rule to its own surface', () => {
    const result = validateUiCss('[data-bd-ui="outside"], [data-bd-ui="header"] { background-image: url("bd-asset:present") }', {
      resolve: () => 'blob:http://localhost/present',
      decorationTarget: '[data-bd-preview-decoration]',
    })
    expect(result.ok).toBe(true)
    expect(result.decorationCss).toContain('[data-bd-preview-decoration]')
    expect(result.outsideCss).toBe('')
    expect(result.resolvedCss).toContain('[data-bd-ui="header"]')
    expect(result.resolvedCss).not.toContain('[data-bd-ui="outside"]')
  })

  it('compiles image-bearing outside rules to the decoration surface and strips them from the mirror', () => {
    const resolve = (id: string) => (id === 'asset-ok' ? 'blob:http://localhost/1' : null)
    const ui = validateUiCss([
      '[data-bd-ui="outside"] { border: 1px solid red; background-image: url("bd-asset:asset-ok") }',
      '[data-bd-ui="outside"]::after { content: ""; background-image: url("bd-asset:asset-ok") }',
      '[data-bd-ui="outside"] { color: red }',
      '[data-bd-ui="header"] { color: blue }',
    ].join('\n'), { resolve })
    expect(ui.ok).toBe(true)
    expect(ui.decorationCss).toContain('#decoration {')
    expect(ui.decorationCss).toContain('#decoration::after {')
    expect(ui.decorationCss).toContain('url("blob:http://localhost/1")')
    expect(ui.outsideCss).not.toContain('url(')
    expect(ui.outsideCss).toContain('color: red')
    expect(ui.hostCss).not.toContain('url("blob:')
    expect(ui.hostCss).toContain('color: blue')
  })

  it('keeps outside rules with unresolvable assets on the ordinary surfaces', () => {
    const ui = validateUiCss('[data-bd-ui="outside"] { background-image: url("bd-asset:asset-gone") }', {
      resolve: () => null,
    })
    expect(ui.ok).toBe(true)
    expect(ui.decorationCss).toBe('')
    expect(ui.outsideCss).toBe('') // the whole declaration was dropped
    expect(ui.hostCss).toBe('') // the rule lost every declaration
  })

  it('collects referenced asset ids through the parser', () => {
    const css = [
      'p { background-image: url("bd-asset:one") }',
      '@media (min-width: 600px) { [data-bd-ui="outside"] { background-image: url("bd-asset:two") } }',
      'p { color: red }',
    ].join('\n')
    expect(collectCssAssetRefs(css)).toEqual(['one', 'two'])
    expect(collectCssAssetRefs('p { background-image: url("https://example.com/x") }')).toEqual([])
    expect(collectCssAssetRefs('p { color: red')).toEqual([])
  })
})

describe('theme font references (phase 5)', () => {
  it('accepts the quoted bd-font token as an ordinary family string', () => {
    const result = validateContentCss('[data-bd-chapter-title] { font-family: "bd-font:lxgw-wenkai", serif; }')
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('keeps rejecting font definitions and resource values', () => {
    expect(validateContentCss('@font-face { font-family: X; src: url("bd-asset:x") }').ok).toBe(false)
    expect(validateContentCss('@import url("https://x.example/a.css");').ok).toBe(false)
    expect(validateContentCss('p { font-family: "bd-font:x", url(https://x.example/a.woff2) }').ok).toBe(false)
  })

  it('collects referenced font ids through the parser', () => {
    expect(collectThemeFontRefs(`
      p { color: red; }
      [data-bd-chapter-title] { font-family: "bd-font:lxgw-wenkai", serif }
      @media (min-width: 600px) { blockquote { font-family: 'bd-font:abc', "bd-font:lxgw-wenkai" } }
    `)).toEqual(['lxgw-wenkai', 'abc'])
    expect(collectThemeFontRefs('p { font-family: "Noto Serif SC", serif }')).toEqual([])
  })

  it('rewrites known ids and leaves unknown ones as an unknown family', () => {
    const stacks = new Map([['lxgw-wenkai', '"LXGW WenKai", serif']])
    const rewritten = rewriteThemeFontRefs(
      'p { font-family: "bd-font:lxgw-wenkai", sans-serif } h1 { font-family: "bd-font:gone", serif }',
      stacks,
    )
    expect(rewritten).toContain('font-family: "LXGW WenKai", serif, sans-serif;')
    expect(rewritten).toContain('font-family: "bd-font:gone", serif;')
    // idempotent: resolved stacks are not references any more
    expect(rewriteThemeFontRefs(rewritten, stacks)).toBe(rewritten)
    // unrelated declarations keep their text
    expect(rewriteThemeFontRefs('p { color: "bd-font:x" }', stacks)).toBe('p { color: "bd-font:x" }')
  })
})
