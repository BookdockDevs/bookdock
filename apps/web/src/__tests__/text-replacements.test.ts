import { describe, expect, it } from 'vitest'

import { applyReplacements, countPatternMatches, textContentOffset, type TextReplacementRule } from '../features/reader/lib/text-replacements'

const rule = (overrides: Partial<TextReplacementRule> = {}): TextReplacementRule => ({
  matchType: 'pattern',
  pattern: 'foo',
  replacement: 'bar',
  isRegex: false,
  applyTo: 'content',
  enabled: true,
  ...overrides,
})

const doc = (body: string) => `<html><body>${body}</body></html>`

describe('applyReplacements', () => {
  it('replaces literal matches globally in text nodes', () => {
    const out = applyReplacements(doc('<p>foo and foo</p>'), [rule()])
    expect(out).toContain('<p>bar and bar</p>')
  })

  it('supports regex with capture groups via $1 references', () => {
    const out = applyReplacements(doc('<p>John Smith</p>'), [
      rule({ pattern: '(\\w+) (\\w+)', replacement: '$2 $1', isRegex: true }),
    ])
    expect(out).toContain('<p>Smith John</p>')
  })

  it('supports whole-match and named capture references', () => {
    const out = applyReplacements(doc('<p>foo</p>'), [
      rule({ pattern: '(?<word>foo)', replacement: '[$0:${word}]', isRegex: true }),
    ])
    expect(out).toContain('<p>[foo:foo]</p>')
  })

  it('uses exact matching for literals', () => {
    const out = applyReplacements(doc('<p>Foo FOO foo</p>'), [rule()])
    expect(out).toContain('<p>Foo FOO bar</p>')
  })

  it('uses Legado inline flags for case-insensitive regexes', () => {
    const out = applyReplacements(doc('<p>Foo foo</p>'), [
      rule({ pattern: '(?i)foo', replacement: 'bar', isRegex: true }),
    ])
    expect(out).toContain('<p>bar bar</p>')
  })

  it('treats Chinese characters as word characters like Legado', () => {
    const out = applyReplacements(doc('<p>中文 abc</p>'), [
      rule({ pattern: '\\w+', replacement: 'X', isRegex: true }),
    ])
    expect(out).toContain('<p>X X</p>')
  })

  it('matches across inline text nodes while preserving their tags', () => {
    const out = applyReplacements(doc('<p>前fo<strong>o</strong>后</p>'), [rule()])
    expect(out).toContain('<p>前bar<strong></strong>后</p>')
  })

  it('supports title-only and both scopes', () => {
    const title = rule({ pattern: 'foo', replacement: 'title', applyTo: 'title' })
    const both = rule({ id: 'r2', pattern: 'bar', replacement: 'both', applyTo: 'both' })
    const out = applyReplacements(doc('<h1>foo</h1><p>foo bar</p><h2>bar</h2>'), [title, both])
    expect(out).toContain('<h1>title</h1>')
    expect(out).toContain('<p>foo both</p>')
    expect(out).toContain('<h2>both</h2>')
  })

  it('treats null or empty replacement as deletion', () => {
    expect(applyReplacements(doc('<p>a foo b</p>'), [rule({ replacement: null })]))
      .toContain('<p>a  b</p>')
    expect(applyReplacements(doc('<p>a foo b</p>'), [rule({ replacement: '' })]))
      .toContain('<p>a  b</p>')
  })

  it('never rewrites tags or attribute values', () => {
    const out = applyReplacements(
      doc('<a href="https://foo.example" title="foo">foo link</a>'),
      [rule()],
    )
    expect(out).toContain('href="https://foo.example"')
    expect(out).toContain('title="foo"')
    expect(out).toContain('bar link')
  })

  it('leaves script and style contents untouched', () => {
    const out = applyReplacements(
      doc('<style>.foo { color: red }</style><script>var foo = 1</script><p>foo</p>'),
      [rule()],
    )
    expect(out).toContain('.foo { color: red }')
    expect(out).toContain('var foo = 1')
    expect(out).toContain('<p>bar</p>')
  })

  it('applies multiple rules in order', () => {
    const out = applyReplacements(doc('<p>a</p>'), [
      rule({ pattern: 'a', replacement: 'b' }),
      rule({ pattern: 'b', replacement: 'c' }),
    ])
    expect(out).toContain('<p>c</p>')
  })

  it('skips point patches and disabled rules', () => {
    const out = applyReplacements(doc('<p>foo</p>'), [
      rule({ matchType: 'point', pattern: null }),
      rule({ enabled: false }),
    ])
    expect(out).toContain('<p>foo</p>')
  })

  it('honors effectiveEnabled (per-book override) over the global default', () => {
    // Override disables a globally enabled rule
    const off = applyReplacements(doc('<p>foo</p>'), [rule({ enabled: true, effectiveEnabled: false })])
    expect(off).toContain('<p>foo</p>')
    // Override enables a globally disabled rule
    const on = applyReplacements(doc('<p>foo</p>'), [rule({ enabled: false, effectiveEnabled: true })])
    expect(on).toContain('<p>bar</p>')
  })

  it('skips rules with an empty pattern', () => {
    const out = applyReplacements(doc('<p>foo</p>'), [rule({ pattern: '' })])
    expect(out).toContain('<p>foo</p>')
  })

  it('returns the identical string when no rule is active', () => {
    const html = doc('<p>foo</p>')
    expect(applyReplacements(html, [])).toBe(html)
    expect(applyReplacements(html, [rule({ enabled: false })])).toBe(html)
  })

  it('keeps a broken regex from blocking the chapter and the remaining rules', () => {
    const out = applyReplacements(doc('<p>foo baz</p>'), [
      rule({ pattern: '([', isRegex: true }),
      rule({ pattern: 'baz', replacement: 'qux' }),
    ])
    expect(out).toContain('<p>foo qux</p>')
  })

  it('does not treat regex metacharacters specially in literal mode', () => {
    const out = applyReplacements(doc('<p>price: $100</p>'), [
      rule({ pattern: '$100', replacement: '$200' }),
    ])
    expect(out).toContain('<p>price: $200</p>')
  })

  it('passes malformed XHTML through unchanged', () => {
    const broken = '<html><body><p>unclosed'
    expect(applyReplacements(broken, [rule()], 'application/xhtml+xml')).toBe(broken)
  })

  it('applies to XHTML chapter documents', () => {
    const xhtml = '<?xml version="1.0" encoding="utf-8"?>'
      + '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>foo</p></body></html>'
    const out = applyReplacements(xhtml, [rule()], 'application/xhtml+xml')
    expect(out).toContain('<p>bar</p>')
  })
})

const point = (overrides: Partial<TextReplacementRule> = {}): TextReplacementRule => ({
  id: 'p1',
  matchType: 'point',
  pattern: null,
  replacement: 'fix',
  isRegex: false,
  applyTo: 'content',
  enabled: true,
  spineHref: 'ch1.xhtml',
  textOffset: 4,
  originalText: 'bad',
  ...overrides,
})

describe('applyReplacements point patches', () => {
  it('applies a matching patch at its offset', () => {
    const out = applyReplacements(doc('<p>a good bad text</p>'), [point()], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>a good fix text</p>')
  })

  it('applies a point patch across text nodes without changing their tags', () => {
    const out = applyReplacements(doc('<p>前错<strong>误</strong>后</p>'), [
      point({ textOffset: 1, originalText: '错误', replacement: '修正' }),
    ], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>前修正<strong></strong>后</p>')
  })

  it('only touches the requested section', () => {
    const out = applyReplacements(doc('<p>bad</p>'), [point()], 'text/html', 'ch2.xhtml')
    expect(out).toContain('<p>bad</p>')
  })

  it('skips patches when no sectionHref is passed', () => {
    const out = applyReplacements(doc('<p>bad</p>'), [point()])
    expect(out).toContain('<p>bad</p>')
  })

  it('reports invalid patches and leaves the text untouched', () => {
    const invalid: string[][] = []
    const out = applyReplacements(doc('<p>nothing here</p>'), [point()], 'text/html', 'ch1.xhtml', (ids) => invalid.push(ids))
    expect(out).toContain('<p>nothing here</p>')
    expect(invalid).toEqual([['p1']])
  })

  it('prefers the occurrence closest to the recorded offset', () => {
    // "bad" appears twice; the patch anchored at 12 must hit the second one
    const out = applyReplacements(doc('<p>bad and bad</p>'), [point({ textOffset: 12 })], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>bad and fix</p>')
  })

  it('uses exact snapshot matching', () => {
    const out = applyReplacements(
      doc('<p>Bad bad</p>'),
      [point({ originalText: 'bad' })],
      'text/html',
      'ch1.xhtml',
    )
    expect(out).toContain('<p>Bad fix</p>')
  })

  it('treats empty replacement as deletion', () => {
    const out = applyReplacements(doc('<p>a bad b</p>'), [point({ replacement: null })], 'text/html', 'ch1.xhtml')
    expect(out).toContain('<p>a  b</p>')
  })

  it('runs after pattern rules so rules see the original text', () => {
    const out = applyReplacements(
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
    const out = applyReplacements(
      doc('<script>var bad = 1</script><p>bad</p>'),
      [point({ textOffset: 8 })],
      'text/html',
      'ch1.xhtml',
    )
    expect(out).toContain('var bad = 1')
    expect(out).toContain('<p>fix</p>')
  })

  it('honors enabled and effectiveEnabled', () => {
    const disabled = applyReplacements(doc('<p>bad</p>'), [point({ enabled: false })], 'text/html', 'ch1.xhtml')
    expect(disabled).toContain('<p>bad</p>')
    const overriddenOff = applyReplacements(doc('<p>bad</p>'), [point({ enabled: true, effectiveEnabled: false })], 'text/html', 'ch1.xhtml')
    expect(overriddenOff).toContain('<p>bad</p>')
  })

  it('patches a zero textOffset', () => {
    const out = applyReplacements(doc('<p>bad!</p>'), [point({ textOffset: 0 })], 'text/html', 'ch1.xhtml')
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

  it('honors exact literals and inline regex flags', () => {
    const counts = countPatternMatches(doc('<p>Foo foo FOO</p>'), [
      rule({ id: 'r1', pattern: 'foo' }),
      rule({ id: 'r2', pattern: '(?i)foo', isRegex: true }),
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
