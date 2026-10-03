import { describe, expect, it } from 'vitest'

import {
  normalizeTransferName,
  prepareRuleTransferExport,
  replacementTransferFileSchema,
  serializeReplacementsForExport,
  serializeTocRulesForExport,
  suggestImportName,
  tocTransferFileSchema,
} from '@bookdock/shared'

describe('toc transfer file', () => {
  it('serializes an export whitelist in display order without database fields', () => {
    const file = serializeTocRulesForExport([
      {
        name: 'first',
        enabled: true,
        patterns: [{ level: 1, regex: '^a', replacement: '$1', enabled: false }],
      },
      {
        name: 'second',
        enabled: false,
        patterns: [{ level: 1, regex: '^b', replacement: null, enabled: true }],
      },
    ])
    expect(file.kind).toBe('bookdock.toc-rules')
    expect(file.formatVersion).toBe(1)
    expect(file.rules.map((rule) => rule.name)).toEqual(['first', 'second'])
    expect(file.rules[0]).toEqual({
      name: 'first',
      enabled: true,
      patterns: [{ level: 1, regex: '^a', replacement: '$1', enabled: false }],
    })
    expect(JSON.stringify(file)).not.toContain('seedKey')
    expect(JSON.stringify(file)).not.toContain('sortOrder')
  })

  it('accepts a valid file and rejects regex, level, envelope, and size violations', () => {
    const valid = {
      kind: 'bookdock.toc-rules',
      formatVersion: 1,
      rules: [{ name: 'ok', enabled: true, patterns: [{ level: 1, regex: '^ok', replacement: null, enabled: true }] }],
    }
    expect(tocTransferFileSchema.safeParse(valid).success).toBe(true)

    const badRegex = structuredClone(valid)
    badRegex.rules[0]!.patterns = [{ level: 1, regex: '([', replacement: null, enabled: true }]
    expect(tocTransferFileSchema.safeParse(badRegex).success).toBe(false)

    const gapped = structuredClone(valid)
    gapped.rules[0]!.patterns = [
      { level: 1, regex: '^a', replacement: null, enabled: true },
      { level: 3, regex: '^b', replacement: null, enabled: true },
    ]
    expect(tocTransferFileSchema.safeParse(gapped).success).toBe(false)

    expect(tocTransferFileSchema.safeParse({ ...valid, kind: 'bookdock.text-replacements' }).success).toBe(false)
    expect(tocTransferFileSchema.safeParse({ ...valid, formatVersion: 2 }).success).toBe(false)
    expect(tocTransferFileSchema.safeParse({
      kind: 'bookdock.toc-rules',
      formatVersion: 1,
      rules: Array.from({ length: 501 }, (_, index) => ({
        name: `rule-${index}`,
        enabled: true,
        patterns: [{ level: 1, regex: '^x', replacement: null, enabled: true }],
      })),
    }).success).toBe(false)
  })

  it('compares names trimmed-exact and suggests import names within 200 chars', () => {
    expect(normalizeTransferName('  abc  ')).toBe('abc')
    const taken = new Set(['taken'])
    expect(suggestImportName('taken', taken)).toBe('taken（导入）')
    taken.add('taken（导入）')
    expect(suggestImportName('taken', taken)).toBe('taken（导入 2）')
    const longBase = 'x'.repeat(200)
    expect(suggestImportName(longBase, new Set([longBase]))).toHaveLength(200)
  })
})

describe('replacement transfer file', () => {
  it('rejects unrestorable exports before download and accepts a valid round trip', () => {
    const rule = { name: 'n', group: null, pattern: 'x', replacement: null, isRegex: false, applyTo: 'content' as const, enabled: true }
    expect(prepareRuleTransferExport(serializeReplacementsForExport(Array(501).fill(rule))))
      .toEqual({ success: false, reason: 'limit' })
    expect(prepareRuleTransferExport(serializeReplacementsForExport([{ ...rule, pattern: 'x'.repeat(2 * 1024 * 1024) }])))
      .toEqual({ success: false, reason: 'limit' })
    expect(prepareRuleTransferExport(serializeReplacementsForExport([{ ...rule, pattern: '' }])))
      .toEqual({ success: false, reason: 'invalid' })
    const prepared = prepareRuleTransferExport(serializeReplacementsForExport([rule]))
    expect(prepared.success).toBe(true)
    if (prepared.success) expect(replacementTransferFileSchema.safeParse(JSON.parse(prepared.text)).success).toBe(true)
  })
  it('serializes the global-pattern whitelist without ownership or override fields', () => {
    const file = serializeReplacementsForExport([
      { name: 'n', group: 'g', pattern: 'a', replacement: 'b', isRegex: false, applyTo: 'both', enabled: true },
    ])
    expect(file.kind).toBe('bookdock.text-replacements')
    expect(file.rules[0]).toEqual({
      name: 'n',
      group: 'g',
      pattern: 'a',
      replacement: 'b',
      isRegex: false,
      applyTo: 'both',
      enabled: true,
    })
    expect(JSON.stringify(file)).not.toContain('bookId')
    expect(JSON.stringify(file)).not.toContain('effectiveEnabled')
  })

  it('keeps empty names and delete semantics while validating regex', () => {
    const valid = {
      kind: 'bookdock.text-replacements',
      formatVersion: 1,
      rules: [
        { name: null, group: null, pattern: 'plain', replacement: '', isRegex: false, applyTo: 'content', enabled: true },
        { name: '', group: 'g', pattern: '^a+', replacement: null, isRegex: true, applyTo: 'both', enabled: false },
      ],
    }
    expect(replacementTransferFileSchema.safeParse(valid).success).toBe(true)
    const bad = structuredClone(valid)
    bad.rules[1]!.pattern = '(['
    expect(replacementTransferFileSchema.safeParse(bad).success).toBe(false)
  })
})
