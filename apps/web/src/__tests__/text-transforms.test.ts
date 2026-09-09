import { describe, expect, it } from 'vitest'

import { applyTransforms, countPatternMatches, textContentOffset, type TextTransformRule } from '../features/reader/lib/text-transforms'

const rule = (overrides: Partial<TextTransformRule> = {}): TextTransformRule => ({
  matchType: 'pattern',
  pattern: 'foo',
  replacement: 'bar',
  isRegex: false,
  caseSensitive: true,
  enabled: true,
  ...overrides,
})

const doc = (body: string) => `<html><body>${body}</body></html>`

describe('applyTransforms', () => {
  it('replaces literal matches globally in text nodes', () => {
    const out = applyTransforms(doc('<p>foo and foo</p>'), [rule()])
    expect(out).toContain('<p>bar and bar</p>')
  })

  it('supports regex with capture groups via $1 references', () => {
    const out = applyTransforms(doc('<p>John Smith</p>'), [
      rule({ pattern: '(\\w+) (\\w+)', replacement: '$2 $1', isRegex: true }),
    ])
    expect(out).toContain('<p>Smith John</p>')
  })

  it('honors caseSensitive for literal rules', () => {
    const insensitive = applyTransforms(doc('<p>Foo FOO foo</p>'), [rule({ caseSensitive: false })])
    expect(insensitive).toContain('<p>bar bar bar</p>')
    const sensitive = applyTransforms(doc('<p>Foo FOO foo</p>'), [rule({ caseSensitive: true })])
    expect(sensitive).toContain('<p>Foo FOO bar</p>')
  })

  it('honors caseSensitive for regex rules', () => {
    const out = applyTransforms(doc('<p>Foo foo</p>'), [
      rule({ pattern: 'foo', replacement: 'bar', isRegex: true, caseSensitive: false }),
    ])
    expect(out).toContain('<p>bar bar</p>')
  })

  it('treats null or empty replacement as deletion', () => {
    expect(applyTransforms(doc('<p>a foo b</p>'), [rule({ replacement: null })]))
      .toContain('<p>a  b</p>')
    expect(applyTransforms(doc('<p>a foo b</p>'), [rule({ replacement: '' })]))
      .toContain('<p>a  b</p>')
  })

  it('never rewrites tags or attribute values', () => {
    const out = applyTransforms(
      doc('<a href="https://foo.example" title="foo">foo link</a>'),
      [rule()],
    )
    expect(out).toContain('href="https://foo.example"')
    expect(out).toContain('title="foo"')
    expect(out).toContain('bar link')
  })

  it('leaves script and style contents untouched', () => {
    const out = applyTransforms(
      doc('<style>.foo { color: red }</style><script>var foo = 1</script><p>foo</p>'),
      [rule()],
    )
    expect(out).toContain('.foo { color: red }')
    expect(out).toContain('var foo = 1')
    expect(out).toContain('<p>bar</p>')
  })

  it('applies multiple rules in order', () => {
    const out = applyTransforms(doc('<p>a</p>'), [
      rule({ pattern: 'a', replacement: 'b' }),
      rule({ pattern: 'b', replacement: 'c' }),
    ])
    expect(out).toContain('<p>c</p>')
  })

  it('skips point patches and disabled rules', () => {
    const out = applyTransforms(doc('<p>foo</p>'), [
      rule({ matchType: 'point', pattern: null }),
      rule({ enabled: false }),
    ])
    expect(out).toContain('<p>foo</p>')
  })

  it('honors effectiveEnabled (per-book override) over the global default', () => {
    // Override disables a globally enabled rule
    const off = applyTransforms(doc('<p>foo</p>'), [rule({ enabled: true, effectiveEnabled: false })])
    expect(off).toContain('<p>foo</p>')
    // Override enables a globally disabled rule
    const on = applyTransforms(doc('<p>foo</p>'), [rule({ enabled: false, effectiveEnabled: true })])
    expect(on).toContain('<p>bar</p>')
  })

  it('skips rules with an empty pattern', () => {
    const out = applyTransforms(doc('<p>foo</p>'), [rule({ pattern: '' })])
    expect(out).toContain('<p>foo</p>')
  })

  it('returns the identical string when no rule is active', () => {
    const html = doc('<p>foo</p>')
    expect(applyTransforms(html, [])).toBe(html)
    expect(applyTransforms(html, [rule({ enabled: false })])).toBe(html)
  })

  it('keeps a broken regex from blocking the chapter and the remaining rules', () => {
    const out = applyTransforms(doc('<p>foo baz</p>'), [
      rule({ pattern: '([', isRegex: true }),
      rule({ pattern: 'baz', replacement: 'qux' }),
    ])
    expect(out).toContain('<p>foo qux</p>')
  })

  it('does not treat regex metacharacters specially in literal mode', () => {
    const out = applyTransforms(doc('<p>price: $100</p>'), [
      rule({ pattern: '$100', replacement: '$200' }),
    ])
    expect(out).toContain('<p>price: $200</p>')
  })

  it('passes malformed XHTML through unchanged', () => {
    const broken = '<html><body><p>unclosed'
    expect(applyTransforms(broken, [rule()], 'application/xhtml+xml')).toBe(broken)
  })

  it('applies to XHTML chapter documents', () => {
    const xhtml = '<?xml version="1.0" encoding="utf-8"?>'
      + '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>foo</p></body></html>'
    const out = applyTransforms(xhtml, [rule()], 'application/xhtml+xml')
    expect(out).toContain('<p>bar</p>')
  })
})

const point = (overrides: Partial<TextTransformRule> = {}): TextTransformRule => ({
  id: 'p1',
  matchType: 'point',
  pattern: null,
  replacement: 'fix',
  isRegex: false,
  caseSensitive: true,
  enabled: true,
  spineHref: 'ch1.xhtml',
  textOffset: 4,
  originalText: 'bad',
  ...overrides,
})

describe('applyTransforms point patches', () => {
  it('applies a matching patch at its offset', () => {
    const out = applyTransforms(doc('<p>a good bad text</p>'), [point()], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>a good fix text</p>')
  })

  it('applies a point patch across text nodes without changing their tags', () => {
    const out = applyTransforms(doc('<p>前错<strong>误</strong>后</p>'), [
      point({ textOffset: 1, originalText: '错误', replacement: '修正' }),
    ], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>前修正<strong></strong>后</p>')
  })

  it('only touches the requested section', () => {
    const out = applyTransforms(doc('<p>bad</p>'), [point()], 'text/html', 'ch2.xhtml')
    expect(out).toContain('<p>bad</p>')
  })

  it('skips patches when no sectionHref is passed', () => {
    const out = applyTransforms(doc('<p>bad</p>'), [point()])
    expect(out).toContain('<p>bad</p>')
  })

  it('reports invalid patches and leaves the text untouched', () => {
    const invalid: string[][] = []
    const out = applyTransforms(doc('<p>nothing here</p>'), [point()], 'text/html', 'ch1.xhtml', (ids) => invalid.push(ids))
    expect(out).toContain('<p>nothing here</p>')
    expect(invalid).toEqual([['p1']])
  })

  it('prefers the occurrence closest to the recorded offset', () => {
    // "bad" appears twice; the patch anchored at 12 must hit the second one
    const out = applyTransforms(doc('<p>bad and bad</p>'), [point({ textOffset: 12 })], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>bad and fix</p>')
  })

  it('honors caseSensitive on the snapshot search', () => {
    // Anchored at 4: the second occurrence wins the closest-match tie
    const out = applyTransforms(
      doc('<p>Bad bad</p>'),
      [point({ originalText: 'bad', caseSensitive: false })],
      'text/html',
      'ch1.xhtml',
    )
    expect(out).toContain('<p>Bad fix</p>')
    // Anchored at 0 with caseSensitive true: only the lowercase form matches
    const sensitive = applyTransforms(
      doc('<p>Bad bad</p>'),
      [point({ textOffset: 0 })],
      'text/html',
      'ch1.xhtml',
    )
    expect(sensitive).toContain('<p>Bad fix</p>')
  })

  it('treats empty replacement as deletion', () => {
    const out = applyTransforms(doc('<p>a bad b</p>'), [point({ replacement: null })], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>a  b</p>')
  })

  it('runs after pattern rules so rules see the original text', () => {
    const out = applyTransforms(
      doc('<p>foo bad</p>'),
      [
        rule({ pattern: 'foo', replacement: 'qux' }),
        point({ textOffset: 4 }),
      ],
      'text/html',
      'ch1.xhtml',
    )
    expect(out).toContain('<p>qux fix</p>')
  })

  it('never touches script contents even at matching offsets', () => {
    const out = applyTransforms(
      doc('<script>var bad = 1</script><p>bad</p>'),
      [point({ textOffset: 8 })],
      'text/html',
      'ch1.xhtml',
    )
    expect(out).toContain('var bad = 1')
    expect(out).toContain('<p>fix</p>')
  })

  it('honors enabled and effectiveEnabled', () => {
    const disabled = applyTransforms(doc('<p>bad</p>'), [point({ enabled: false })], 'text/html', 'ch1.xhtml')
    expect(disabled).toContain('<p>bad</p>')
    const overriddenOff = applyTransforms(doc('<p>bad</p>'), [point({ enabled: true, effectiveEnabled: false })], 'text/html', 'ch1.xhtml')
    expect(overriddenOff).toContain('<p>bad</p>')
  })

  it('patches a zero textOffset', () => {
    const out = applyTransforms(doc('<p>bad!</p>'), [point({ textOffset: 0 })], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>fix!</p>')
  })
})

describe('textContentOffset', () => {
  it('counts text nodes in document order, skipping script/style', () => {
    const docEl = new DOMParser().parseFromString(
      doc('<p>ab</p><style>.x{}</style><script>var s</script><p>cd</p>'),
      'text/html',
    )
    const nodes = Array.from(docEl.querySelectorAll('p')).map((p) => p.firstChild as Text)
    expect(textContentOffset(docEl, nodes[0]!, 1)).toBe(1)
    expect(textContentOffset(docEl, nodes[1]!, 1)).toBe(3)
  })

  it('returns null for a node outside the walk', () => {
    const docEl = new DOMParser().parseFromString(doc('<p>ab</p>'), 'text/html')
    const foreign = document.createTextNode('x')
    expect(textContentOffset(docEl, foreign, 0)).toBeNull()
  })
})

describe('countPatternMatches', () => {
  it('counts each rule independently across text nodes', () => {
    const counts = countPatternMatches(doc('<p>foo foo</p><p>foo</p><script>foo</script>'), [
      rule({ id: 'r1', pattern: 'foo' }),
    ])
    expect(counts).toEqual({ r1: 3 })
  })

  it('honors isRegex and caseSensitive', () => {
    const counts = countPatternMatches(doc('<p>Foo foo FOO</p>'), [
      rule({ id: 'r1', pattern: 'foo' }),
      rule({ id: 'r2', pattern: 'foo', caseSensitive: false }),
      // case-sensitive by default: only the lowercase form matches
      rule({ id: 'r3', pattern: 'f.o', isRegex: true }),
    ])
    expect(counts).toEqual({ r1: 1, r2: 3, r3: 1 })
  })

  it('never counts inside script/style subtrees', () => {
    const counts = countPatternMatches(doc('<style>.foo{}</style><script>var foo</script><p>foo</p>'), [
      rule({ id: 'r1', pattern: 'foo' }),
    ])
    expect(counts).toEqual({ r1: 1 })
  })

  it('returns zero for a broken regex instead of throwing', () => {
    const counts = countPatternMatches(doc('<p>foo</p>'), [rule({ id: 'r1', pattern: '([', isRegex: true })])
    expect(counts).toEqual({ r1: 0 })
  })

  it('returns an empty map for no pattern rules', () => {
    expect(countPatternMatches(doc('<p>foo</p>'), [])).toEqual({})
  })
})
