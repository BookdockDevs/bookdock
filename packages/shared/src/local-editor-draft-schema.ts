import { z } from 'zod'
import { CONTENT_EDITOR_MAX_ITEMS, CONTENT_EDITOR_MAX_TEXT_CHARS } from './constants'

export const localDraftEnvelopeSchema = z.object({ version: z.literal(1), key: z.string(), revisionId: z.string().min(1), token: z.string().min(1), savedAt: z.number().finite(), payload: z.unknown() })
const unit = z.object({ id: z.string().min(1).max(128), title: z.string().max(2000).optional(), content: z.string().optional(), level: z.number().int().min(0).max(20).optional(), structureOnlyTitle: z.boolean().optional(), titleChanged: z.boolean().optional(), contentChanged: z.boolean().optional() })
const rule = z.object({ ruleId: z.string().nullable(), patterns: z.array(z.object({ level: z.number(), regex: z.string(), replacement: z.string().nullable(), enabled: z.boolean() })).nullable(), label: z.string().nullable(), auto: z.boolean() })
export const txtLocalDraftSchema = z.object({ units: z.array(unit).min(1).max(CONTENT_EDITOR_MAX_ITEMS), tocRuleSelection: rule, activeUnitId: z.string().nullable() })
  .refine((value) => new Set(value.units.map((item) => item.id)).size === value.units.length && value.units.reduce((sum, item) => sum + (item.title?.length ?? 0) + (item.content?.length ?? 0), 0) <= CONTENT_EDITOR_MAX_TEXT_CHARS)
export type TxtLocalDraft = z.infer<typeof txtLocalDraftSchema>
export const epubLocalDraftSchema = z.object({
  documents: z.array(z.object({ href: z.string().min(1).max(2000), content: z.string() })).max(CONTENT_EDITOR_MAX_ITEMS),
  tocEntries: z.array(z.object({ href: z.string().min(1).max(2000), title: z.string().max(2000), level: z.number().int().min(1).max(20) })).max(CONTENT_EDITOR_MAX_ITEMS),
  spineOrder: z.array(z.string().min(1).max(2000)).max(CONTENT_EDITOR_MAX_ITEMS),
  view: z.enum(['toc', 'files']), activeHref: z.string().nullable(), activeTocIndex: z.number().int().nullable(),
}).refine((value) => value.documents.reduce((sum, item) => sum + item.content.length, 0) <= CONTENT_EDITOR_MAX_TEXT_CHARS && new Set(value.documents.map((item) => item.href)).size === value.documents.length)
export type EpubLocalDraft = z.infer<typeof epubLocalDraftSchema>
