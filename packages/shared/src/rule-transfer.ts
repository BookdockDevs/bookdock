import { z } from 'zod'

import { compileReplacementRegex } from './text-replacement-engine'

export const TOC_TRANSFER_KIND = 'bookdock.toc-rules' as const
export const REPLACEMENT_TRANSFER_KIND = 'bookdock.text-replacements' as const
export const RULE_TRANSFER_FORMAT_VERSION = 1 as const
export const RULE_TRANSFER_MAX_BYTES = 2 * 1024 * 1024
export const RULE_TRANSFER_MAX_RULES = 500

export function isValidTocRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, 'gm')
    return true
  } catch {
    return false
  }
}

function isValidTransferReplacementRegex(pattern: string): boolean {
  try {
    compileReplacementRegex(pattern)
    return true
  } catch {
    return false
  }
}

export const tocTransferPatternSchema = z.object({
  level: z.number().int().min(1),
  regex: z.string().min(1),
  replacement: z.string().nullable().optional().default(null),
  enabled: z.boolean().optional().default(true),
}).strict()

export const tocTransferPatternsSchema = z.array(tocTransferPatternSchema).min(1).superRefine((patterns, context) => {
  patterns.forEach((pattern, index) => {
    if (pattern.level !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'level'],
        message: 'pattern levels must match their array positions',
      })
    }
    if (!isValidTocRegex(pattern.regex)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'regex'],
        message: 'pattern is not a valid regular expression',
      })
    }
  })
})

export const tocTransferRuleSchema = z.object({
  name: z.string().min(1).max(200).refine((name) => name.trim().length > 0, 'Rule name must not be blank'),
  enabled: z.boolean().optional().default(true),
  patterns: tocTransferPatternsSchema,
}).strict()

export const tocTransferFileSchema = z.object({
  kind: z.literal(TOC_TRANSFER_KIND),
  formatVersion: z.literal(RULE_TRANSFER_FORMAT_VERSION),
  rules: z.array(tocTransferRuleSchema).max(RULE_TRANSFER_MAX_RULES),
}).strict()

export type TocTransferPattern = z.infer<typeof tocTransferPatternSchema>
export type TocTransferRule = z.infer<typeof tocTransferRuleSchema>
export type TocTransferFile = z.infer<typeof tocTransferFileSchema>

export const replacementTransferRuleSchema = z.object({
  name: z.string().max(200).nullish(),
  group: z.string().max(200).nullish(),
  pattern: z.string().min(1),
  replacement: z.string().nullish(),
  isRegex: z.boolean().optional().default(false),
  applyTo: z.enum(['content', 'title', 'both']).optional().default('content'),
  enabled: z.boolean().optional().default(true),
}).strict().superRefine((rule, context) => {
  if (rule.isRegex && rule.pattern && !isValidTransferReplacementRegex(rule.pattern)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pattern'],
      message: 'pattern is not a valid regular expression',
    })
  }
})

export const replacementTransferFileSchema = z.object({
  kind: z.literal(REPLACEMENT_TRANSFER_KIND),
  formatVersion: z.literal(RULE_TRANSFER_FORMAT_VERSION),
  rules: z.array(replacementTransferRuleSchema).max(RULE_TRANSFER_MAX_RULES),
}).strict()

export type ReplacementTransferRule = z.infer<typeof replacementTransferRuleSchema>
export type ReplacementTransferFile = z.infer<typeof replacementTransferFileSchema>

export function normalizeTransferName(name: string | null | undefined): string {
  return (name ?? '').trim()
}

function truncateImportBase(base: string, suffix: string): string {
  const trimmed = base.trim()
  if (trimmed.length + suffix.length <= 200) return `${trimmed}${suffix}`
  return `${trimmed.slice(0, 200 - suffix.length)}${suffix}`
}

export function suggestImportName(base: string, taken: Set<string>): string {
  const clean = base.trim()
  let candidate = truncateImportBase(clean, '（导入）')
  if (!taken.has(candidate)) return candidate
  let counter = 2
  while (true) {
    candidate = truncateImportBase(clean, `（导入 ${counter}）`)
    if (!taken.has(candidate)) return candidate
    counter += 1
  }
}

export interface TransferIssue {
  ruleIndex: number | null
  field: string
  message: string
}

export function describeTransferIssues(error: z.ZodError): TransferIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment))
    const ruleIndex = path[0] === 'rules' && typeof issue.path[1] === 'number' ? (issue.path[1] as number) : null
    const field = ruleIndex === null ? path.join('.') : path.slice(2).join('.') || 'rules'
    return { ruleIndex, field, message: issue.message }
  })
}

export function transferFileByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function prepareRuleTransferExport(file: TocTransferFile | ReplacementTransferFile):
  { success: true; text: string } | { success: false; reason: 'limit' | 'invalid' } {
  if (file.rules.length > RULE_TRANSFER_MAX_RULES) return { success: false, reason: 'limit' }
  const parsed = file.kind === TOC_TRANSFER_KIND
    ? tocTransferFileSchema.safeParse(file)
    : replacementTransferFileSchema.safeParse(file)
  if (!parsed.success) return { success: false, reason: 'invalid' }
  const text = JSON.stringify(parsed.data, null, 2)
  if (transferFileByteLength(text) > RULE_TRANSFER_MAX_BYTES) return { success: false, reason: 'limit' }
  return { success: true, text }
}

export function serializeTocRulesForExport(rules: Array<{ name: string; enabled: boolean; patterns: Array<{ level: number; regex: string; replacement: string | null; enabled: boolean }> }>): TocTransferFile {
  return {
    kind: TOC_TRANSFER_KIND,
    formatVersion: RULE_TRANSFER_FORMAT_VERSION,
    rules: rules.map((rule) => ({
      name: rule.name,
      enabled: rule.enabled,
      patterns: rule.patterns.map((pattern) => ({
        level: pattern.level,
        regex: pattern.regex,
        replacement: pattern.replacement,
        enabled: pattern.enabled,
      })),
    })),
  }
}

export function serializeReplacementsForExport(rules: Array<{ name: string | null; group: string | null; pattern: string; replacement: string | null; isRegex: boolean; applyTo: 'content' | 'title' | 'both'; enabled: boolean }>): ReplacementTransferFile {
  return {
    kind: REPLACEMENT_TRANSFER_KIND,
    formatVersion: RULE_TRANSFER_FORMAT_VERSION,
    rules: rules.map((rule) => ({
      name: rule.name,
      group: rule.group,
      pattern: rule.pattern,
      replacement: rule.replacement,
      isRegex: rule.isRegex,
      applyTo: rule.applyTo,
      enabled: rule.enabled,
    })),
  }
}
