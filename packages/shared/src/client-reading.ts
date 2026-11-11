import { z } from 'zod'

import { COVER_PALETTE_IDS } from './constants'
import { REVIEW_BODY_MAX_LENGTH, REVIEW_TITLE_MAX_LENGTH } from './review'
import { bookMetadataSchema, replacementCreateSchema, settingsUpdateSchema, tocRulePatternsSchema } from './schema'

const identity = z.string().min(1)
const timestamp = z.number().int().nonnegative()
export const clientFractionSchema = z.number().finite().min(0).max(1)

export const clientDataScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), vaultId: identity }),
  z.object({ kind: z.literal('remote'), connectionId: identity, accountId: identity }),
  z.object({ kind: z.literal('remote-guest'), connectionId: identity, guestScopeId: identity }),
])
export type ClientDataScope = z.infer<typeof clientDataScopeSchema>

export const clientBookRefSchema = z.object({ scope: clientDataScopeSchema, bookId: identity })
export type ClientBookRef = z.infer<typeof clientBookRefSchema>
export const clientContentRefSchema = z.object({ book: clientBookRefSchema, contentId: identity })
export type ClientContentRef = z.infer<typeof clientContentRefSchema>

export const clientPreferenceOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('device') }),
  z.object({ kind: z.literal('account'), connectionId: identity, accountId: identity }),
])
export type ClientPreferenceOwner = z.infer<typeof clientPreferenceOwnerSchema>
export const clientPresetBindingSchema = z.object({ presetId: identity, owner: clientPreferenceOwnerSchema })
export type ClientPresetBinding = z.infer<typeof clientPresetBindingSchema>

export function resolveClientPresetBinding(binding: ClientPresetBinding | null | undefined, owner: ClientPreferenceOwner): string | null {
  if (!binding || binding.owner.kind !== owner.kind) return null
  if (binding.owner.kind === 'account' && owner.kind === 'account' && (binding.owner.accountId !== owner.accountId || binding.owner.connectionId !== owner.connectionId)) return null
  return binding.presetId
}

export interface ClientPublicationNavigationItem {
  label: string
  href: string | null
  children: ClientPublicationNavigationItem[]
}
export const clientPublicationNavigationItemSchema: z.ZodType<ClientPublicationNavigationItem> = z.lazy(() => z.object({
  label: z.string(), href: identity.nullable(), children: z.array(clientPublicationNavigationItemSchema).max(10_000),
}))
export const clientPublicationStructureSchema = z.object({
  content: clientContentRefSchema,
  sections: z.array(z.object({
    index: z.number().int().nonnegative(), href: identity.nullable(), title: z.string().nullable(),
    byteLength: z.number().int().nonnegative().nullable(), wordCount: z.number().int().nonnegative().nullable(),
  })).max(10_000),
  navigation: z.array(clientPublicationNavigationItemSchema).max(10_000),
})
export type ClientPublicationStructure = z.infer<typeof clientPublicationStructureSchema>

export const clientLocatorSchema = z.object({
  content: clientContentRefSchema,
  schemaVersion: z.literal(1),
  kind: z.literal('epub-cfi'),
  value: z.string().regex(/^epubcfi\(.+\)$/),
  href: z.string().optional(),
  quote: z.object({ exact: z.string(), prefix: z.string().optional(), suffix: z.string().optional() }).optional(),
  layout: z.object({ engine: identity, version: identity, value: z.string() }).optional(),
})
export type ClientLocator = z.infer<typeof clientLocatorSchema>

export const clientReadingStateSchema = z.object({
  book: clientBookRefSchema,
  readStatus: z.enum(['wishlist', 'reading', 'idle', 'finished', 'abandoned']),
  position: clientLocatorSchema.nullable(),
  fraction: clientFractionSchema.nullable(),
  fractionContent: clientContentRefSchema.nullable().optional(),
  chapter: z.string().nullable().optional(),
  coverage: z.object({ content: clientContentRefSchema, fraction: clientFractionSchema, available: z.boolean() }).nullable(),
  positionHistory: z.array(z.object({ position: clientLocatorSchema.nullable(), fraction: clientFractionSchema.nullable(), updatedAt: timestamp })).optional(),
  lastReadAt: timestamp.nullable(),
  updatedAt: timestamp,
  version: z.number().int().nonnegative(),
}).superRefine((state, ctx) => {
  if (state.fractionContent && !sameClientBook(state.fractionContent.book, state.book)) ctx.addIssue({ code: 'custom', path: ['fractionContent'], message: 'Fraction basis must belong to the same book' })
  if (state.positionHistory?.some((entry) => entry.position && !sameClientBook(entry.position.content.book, state.book))) ctx.addIssue({ code: 'custom', path: ['positionHistory'], message: 'Position history must belong to the same book' })
  if (state.position && !sameClientBook(state.position.content.book, state.book)) ctx.addIssue({ code: 'custom', path: ['position'], message: 'Position must belong to the same book' })
  if (state.coverage && !sameClientBook(state.coverage.content.book, state.book)) ctx.addIssue({ code: 'custom', path: ['coverage'], message: 'Coverage must belong to the same book' })
})
export type ClientReadingState = z.infer<typeof clientReadingStateSchema>

export const clientCatalogAttributesSchema = z.object({
  metadata: bookMetadataSchema.optional(),
  shelfId: identity.nullable().optional(),
  categoryId: identity.nullable().optional(),
  tagIds: z.array(identity).optional(),
  pinnedAt: timestamp.nullable().optional(),
  hidden: z.boolean().optional(),
  coverPaletteId: z.enum(COVER_PALETTE_IDS).nullable().optional(),
})
export type ClientCatalogAttributes = z.infer<typeof clientCatalogAttributesSchema>

export const clientOrganizationSchema = z.object({
  version: z.number().int().nonnegative(),
  items: z.array(z.object({
    id: identity,
    kind: z.enum(['shelf', 'category', 'tag']),
    name: z.string().trim().min(1).max(100),
    parentId: identity.nullable(),
    pinned: z.boolean(),
    hidden: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })),
})
export type ClientOrganization = z.infer<typeof clientOrganizationSchema>

export const clientCatalogPreferencesSchema = settingsUpdateSchema.shape.library.unwrap().extend({ showHidden: z.boolean().optional() })
export type ClientCatalogPreferences = z.infer<typeof clientCatalogPreferencesSchema>

export const clientTxtPublicationSchema = z.object({
  schemaVersion: z.literal(1), fileName: identity, encoding: identity,
  ruleSelection: z.object({ patterns: tocRulePatternsSchema.nullable(), label: z.string().max(200).nullable(), auto: z.boolean() }).optional(),
  artifactVersion: z.number().int().positive(), normalizedLength: z.number().int().nonnegative(),
  chapters: z.array(z.object({
    title: z.string(), level: z.number().int().nonnegative(), startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(), contentStartOffset: z.number().int().nonnegative(),
    synthetic: z.boolean().optional(), wordCount: z.number().int().nonnegative(),
  })).min(1).max(10_000),
}).superRefine((source, ctx) => {
  for (const [index, chapter] of source.chapters.entries()) {
    if (chapter.startOffset > chapter.contentStartOffset || chapter.contentStartOffset > chapter.endOffset || chapter.endOffset > source.normalizedLength || chapter.startOffset !== (index ? source.chapters[index - 1]!.endOffset : 0)) ctx.addIssue({ code: 'custom', path: ['chapters', index], message: 'Invalid normalized chapter bounds' })
  }
  if (source.chapters.at(-1)?.endOffset !== source.normalizedLength) ctx.addIssue({ code: 'custom', path: ['chapters'], message: 'Chapters must cover normalized text' })
})
export type ClientTxtPublication = z.infer<typeof clientTxtPublicationSchema>

export const clientBookSchema = z.object({
  ref: clientBookRefSchema,
  title: z.string(),
  authors: z.array(z.string()),
  format: z.enum(['epub', 'txt']),
  fileName: identity.optional(),
  content: clientContentRefSchema.nullable(),
  availability: z.enum(['available', 'missing', 'removed']),
  deletedAt: timestamp.nullable().optional(),
  catalogRemoved: z.boolean().optional(),
  trashDeleteUserData: z.boolean().optional(),
  size: z.number().int().nonnegative().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  version: z.number().int().nonnegative(),
  catalog: clientCatalogAttributesSchema.optional(),
  textSource: clientTxtPublicationSchema.optional(),
}).superRefine((book, ctx) => {
  if (book.textSource && book.format !== 'txt') ctx.addIssue({ code: 'custom', path: ['textSource'], message: 'TXT publication belongs to TXT content' })
  if (book.content && !sameClientBook(book.content.book, book.ref)) ctx.addIssue({ code: 'custom', path: ['content'], message: 'Content must belong to the same book' })
})
export type ClientBook = z.infer<typeof clientBookSchema>

export const clientPublicationReplacementSchema = z.object({
  book: clientBookRefSchema, baseContentId: identity, contentId: identity, textSource: clientTxtPublicationSchema.optional(),
}).strict().refine((command) => command.baseContentId !== command.contentId, 'Publication replacement requires a new content identity')
export type ClientPublicationReplacement = z.infer<typeof clientPublicationReplacementSchema>

export const clientNoteImageSchema = z.object({
  id: z.string().regex(/^local-image_[A-Za-z0-9_-]{21}$/),
  name: z.string().min(1).max(255), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().min(1).max(5 * 1024 * 1024),
})
export type ClientNoteImage = z.infer<typeof clientNoteImageSchema>

const noteBase = {
  locatorHistory: z.array(clientLocatorSchema).optional(),
  id: identity,
  book: clientBookRefSchema,
  locator: clientLocatorSchema.nullable(),
  chapter: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  version: z.number().int().nonnegative(),
}
export const clientNoteSchema = z.discriminatedUnion('kind', [
  z.object({ ...noteBase, kind: z.literal('bookmark'), title: z.string(), context: z.string() }),
  z.object({ ...noteBase, kind: z.literal('highlight'), text: z.string(), color: z.string(), style: z.enum(['underline', 'squiggly', 'highlight']) }),
  z.object({ ...noteBase, kind: z.literal('idea'), body: z.string(), text: z.string(), images: z.array(clientNoteImageSchema).max(9).optional() }),
]).superRefine((note, ctx) => {
  if (note.locatorHistory?.some((locator) => !sameClientBook(locator.content.book, note.book))) ctx.addIssue({ code: 'custom', path: ['locatorHistory'], message: 'Locator history must belong to the same book' })
  if (note.locator && !sameClientBook(note.locator.content.book, note.book)) ctx.addIssue({ code: 'custom', path: ['locator'], message: 'Note location must belong to the same book' })
})
export type ClientNote = z.infer<typeof clientNoteSchema>

/**
 * A device review. It is the private half of a server review with the social
 * half deliberately absent: a device book has no source listing to publish to,
 * so visibility is always private and likes/comments do not exist.
 */
export const clientReviewSchema = z.object({
  id: identity,
  book: clientBookRefSchema,
  /** Storage unit matches the server: integer halves 0–10; null is unrated. */
  ratingHalves: z.number().int().min(0).max(10).nullable(),
  title: z.string().max(REVIEW_TITLE_MAX_LENGTH),
  body: z.string().max(REVIEW_BODY_MAX_LENGTH),
  bodyFormat: z.enum(['plain', 'markdown']),
  createdAt: timestamp,
  updatedAt: timestamp,
  version: z.number().int().nonnegative(),
}).strict()
export type ClientReview = z.infer<typeof clientReviewSchema>

/** What a composer hands the vault; the store owns ids, times and versions. */
export interface ClientReviewInput {
  id?: string
  ratingHalves: number | null
  title: string
  body: string
  bodyFormat: 'plain' | 'markdown'
}

export function clientScopeKey(scope: ClientDataScope): readonly string[] {
  switch (scope.kind) {
    case 'local': return ['local', scope.vaultId]
    case 'remote': return ['remote', scope.connectionId, scope.accountId]
    case 'remote-guest': return ['remote-guest', scope.connectionId, scope.guestScopeId]
  }
}

export function clientBookKey(ref: ClientBookRef): readonly string[] {
  return [...clientScopeKey(ref.scope), ref.bookId]
}

export function sameClientBook(left: ClientBookRef, right: ClientBookRef): boolean {
  return JSON.stringify(clientBookKey(left)) === JSON.stringify(clientBookKey(right))
}


export interface ClientBookNotesSnapshot {
  book: ClientBook
  notes: ClientNote[]
  sourceAvailable: boolean
}

export const clientReplacementSchema = z.object({
  id: identity, book: clientBookRefSchema.nullable(), contentId: identity.nullable(),
  rule: replacementCreateSchema, version: z.number().int().nonnegative(),
  createdAt: timestamp, updatedAt: timestamp,
}).superRefine((value, ctx) => {
  if ((value.rule.bookId ?? null) !== (value.book?.bookId ?? null) || value.rule.matchType === 'point' && (!value.book || !value.contentId)) ctx.addIssue({ code: 'custom', message: 'Replacement context must match its actual book and content basis' })
})
export type ClientReplacement = z.infer<typeof clientReplacementSchema>
