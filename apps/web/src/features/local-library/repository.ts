import { acceptsReadingTimerClaim, categoryTemplatePath, clientBookRefSchema, settingsUpdateSchema, clientReplacementSchema, replacementCreateSchema, replacementUpdateSchema, clientNoteImageSchema, CONTENT_DRAFT_TTL_MS, IDEA_IMAGE_MAX_COUNT, clientBookKey, clientBookSchema, clientPublicationReplacementSchema, clientCatalogAttributesSchema, clientCatalogPreferencesSchema, clientManualTimerSnapshotSchema, clientNoteSchema, clientOrganizationSchema, clientReadingCaptureGroupSchema, clientReadingCaptureSchema, clientReadingEntrySchema, clientReadingCoverageIntervalsSchema, clientReadingGroupEntrySchema, clientReadingSessionSchema, clientReadingSessionCommandSchema, clientReadingLedgerClearSchema, clientReadingSessionUpdateSchema, clientReadingRoundsSchema, clientReadingStateSchema, clientReadingTimerDraftSchema, clientReviewSchema, localDraftEnvelopeSchema, CONTENT_EDITOR_MAX_REQUEST_BYTES, mergeTimeFragments, readingTimerClaimSchema, sameClientBook, subtractTimeFragments, viewSettingsSchema } from '@bookdock/shared'
import type { ArchiveDeleteRes, TrashSettings, ClientReplacement, TextReplacementRes, ReplacementCreateReq, ReplacementUpdateReq, ClientNoteImage, ClientBook, ClientTxtPublication, LocalEditorDraftEnvelope, ClientPublicationReplacement, EditorTxtSaveRes, ClientReadingLedgerClear, ClientVaultReadingSnapshot, ClientBookNotesSnapshot, ClientBookRef, ClientCatalogAttributes, ClientCatalogPreferences, ClientManualTimerSnapshot, ClientNote, ClientOrganization, ClientReadingCapture, ClientReadingCaptureGroup, ClientReadingEntry, ClientReadingBookSnapshot, ClientReadingGroupEntry, ClientReadingLedger, ClientReadingSession, ClientReadingSessionCommand, ClientReadingSessionUpdate, ClientReadingRounds, ClientReadingRoundAction, ClientReadingState, ClientReadingTimerDraft, ClientReview, ClientReviewInput, ReadingTimerClaimInput, ReadingTimerLease, ReadStatus } from '@bookdock/shared'

import { createCoverThumbnail } from './cover-thumbnail'
import { preparePublicationRelocationInWorker } from './epub-editor-worker'
import type { PublicationRelocationSnapshot } from './publication-relocation'
import { localRecordId } from './id'
import { localTimerCaptureGroup } from './reading-capture-group'
import { projectLocalReadingBook } from './reading-projection'

const STORES = ['books', 'files', 'states', 'notes', 'reviews', 'deleted', 'settings', 'reading-sessions', 'reading-receipts'] as const
type StoreName = typeof STORES[number]

export class LocalLibraryError extends Error {
  constructor(public readonly category: 'conflict' | 'unavailable-content' | 'invalid-input' | 'storage-unavailable' | 'storage-full' | 'pending-reading', message: string, public readonly details?: unknown) {
    super(message)
  }
}

const key = (ref: ClientBookRef) => JSON.stringify(clientBookKey(ref))
const noteKey = (ref: ClientBookRef, id: string) => JSON.stringify([clientBookKey(ref), id])
const noteFingerprint = (note: ClientNote) => JSON.stringify(clientNoteSchema.parse({ ...note, createdAt: 0, updatedAt: 0, version: 0 }))

const FILE_KEY_PREFIXES = ['publication-digest:', 'publication:', 'original-digest:', 'original:', 'digest:', 'cover:', 'text:'] as const

export interface DeviceStorageSummary {
  activeBooks: number
  totalBytes: number
  browserUsage: number | null
}

export interface LocalBookTransferSnapshot {
  book: ClientBook
  file: Blob
  fileSha256: string
  cover: Blob | null
  state: ClientReadingState | null
  notes: ClientNote[]
  noteImages: Map<string, Blob>
  review: ClientReview | null
  rounds: ClientReadingRounds['rounds']
  sessions: ClientReadingSession[]
  coverageIntervals: Array<[number, number]>
  preferences: Record<string, unknown>
  pointRules: ClientReplacement[]
  replacementOverrides: Record<string, boolean>
}

function storedBlobSize(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const candidate = value as { size?: unknown; arrayBuffer?: unknown; blob?: unknown }
  if (typeof candidate.size === 'number' && typeof candidate.arrayBuffer === 'function') return candidate.size
  if ('blob' in candidate && candidate.blob !== undefined) return storedBlobSize(candidate.blob)
  return 0
}

async function computeBlobSha256(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isFileInVault(rawKey: IDBValidKey, vaultId: string): boolean {
  if (typeof rawKey !== 'string') return false
  let body = rawKey
  for (const prefix of FILE_KEY_PREFIXES) {
    if (body.startsWith(prefix)) {
      body = body.slice(prefix.length)
      break
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return false
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return false
  return (parsed[0] === 'local' && parsed[1] === vaultId)
    || (parsed[0] === 'note-image' && parsed[1] === 'local' && parsed[2] === vaultId)
}

function readingCaptureFragments(capture: ClientReadingCapture) {
  return mergeTimeFragments(capture.continuous && capture.startedAt !== null ? [{ startedAt: capture.startedAt, endedAt: capture.startedAt + capture.durationSeconds * 1000 }] : capture.fragments ?? [])
}

async function readingWriteFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

export class LocalLibraryRepository {
  private opening?: Promise<IDBDatabase>
  private changes?: BroadcastChannel
  private organizationQueue = new Map<string, Promise<void>>()
  constructor(private databaseName = 'bookdock-local-library') {}

  private withOrganizationLock<T>(vaultId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.organizationQueue.get(vaultId) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.organizationQueue.set(vaultId, settled)
    return result.finally(() => {
      if (this.organizationQueue.get(vaultId) === settled) this.organizationQueue.delete(vaultId)
    })
  }

  private database(): Promise<IDBDatabase> {
    this.opening ??= new Promise((resolve, reject) => {
      let blocked = false
      const open = indexedDB.open(this.databaseName, 4)
      open.onupgradeneeded = () => {
        for (const store of STORES) if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store)
        const notes = open.transaction!.objectStore('notes')
        if (!notes.indexNames.contains('book')) notes.createIndex('book', ['book.scope.vaultId', 'book.bookId'])
        if (!notes.indexNames.contains('book-kind')) notes.createIndex('book-kind', ['book.scope.vaultId', 'book.bookId', 'kind'])
        const reviews = open.transaction!.objectStore('reviews')
        if (!reviews.indexNames.contains('book')) reviews.createIndex('book', ['book.scope.vaultId', 'book.bookId'])
        const sessions = open.transaction!.objectStore('reading-sessions')
        if (!sessions.indexNames.contains('vault')) sessions.createIndex('vault', 'capture.book.scope.vaultId')
        if (!sessions.indexNames.contains('book')) sessions.createIndex('book', ['capture.book.scope.vaultId', 'capture.book.bookId'])
      }
      open.onsuccess = () => {
        if (blocked) { open.result.close(); return }
        if (typeof BroadcastChannel !== 'undefined' && !this.changes) {
          this.changes = new BroadcastChannel(`bookdock-local:${this.databaseName}`)
          this.changes.onmessage = (event) => {
            if (typeof window === 'undefined') return
            window.dispatchEvent(new Event('bd-local-library-changed'))
            if (event.data?.type === 'publication') {
              const ref = clientBookRefSchema.safeParse(event.data.book)
              if (ref.success && ref.data.scope.kind === 'local') window.dispatchEvent(new CustomEvent('bd-local-publication-changed', { detail: ref.data }))
            }
          }
        }
        open.result.onversionchange = () => { open.result.close(); this.opening = undefined }
        resolve(open.result)
      }
      open.onerror = () => { this.opening = undefined; reject(open.error) }
      open.onblocked = () => { blocked = true; this.opening = undefined; reject(new LocalLibraryError('storage-unavailable', 'Close other library tabs to finish the storage upgrade')) }
    })
    return this.opening
  }

  private async transaction<T>(stores: StoreName[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal, notifyChange = true): Promise<T> {
    try {
      signal?.throwIfAborted()
      const db = await this.database()
      signal?.throwIfAborted()
      const tx = db.transaction(stores, mode)
      const cancel = () => { try { tx.abort() } catch { /* A committed transaction stays successful. */ } }
      signal?.addEventListener('abort', cancel, { once: true })
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'))
        tx.onerror = () => {}
      })
      void done.catch(() => {})
      try {
        const result = await operation(tx)
        await done
        if (mode === 'readwrite' && notifyChange) {
          this.changes?.postMessage('committed')
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('bd-local-library-changed'))
        }
        return result
      } catch (error) {
        try { tx.abort() } catch { /* A completed transaction cannot be aborted. */ }
        await done.catch(() => {})
        throw error
      } finally { signal?.removeEventListener('abort', cancel) }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof LocalLibraryError) throw error
      throw new LocalLibraryError(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'storage-full' : 'storage-unavailable', error instanceof Error ? error.message : 'Local storage is unavailable')
    }
  }

  private publicationChanged(ref: ClientBookRef): void {
    this.changes?.postMessage({ type: 'publication', book: ref })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bd-local-publication-changed', { detail: ref }))
  }

  private assertLocal(ref: ClientBookRef): void {
    if (ref.scope.kind !== 'local') throw new LocalLibraryError('invalid-input', 'A local vault reference is required')
  }

  private async requireBook(tx: IDBTransaction, ref: ClientBookRef): Promise<ClientBook> {
    const book = await request<ClientBook | undefined>(tx.objectStore('books').get(key(ref)))
    if (!book) throw new LocalLibraryError('unavailable-content', 'Local book no longer exists')
    const parsed = clientBookSchema.parse(book)
    if (!sameClientBook(parsed.ref, ref)) throw new LocalLibraryError('storage-unavailable', 'Stored book identity is invalid')
    return parsed
  }

  async addBook(book: ClientBook, blob: Blob, cover?: Blob, textPublication?: { publication: Blob; normalizedText: Blob }, signal?: AbortSignal): Promise<ClientBook> {
    this.assertLocal(book.ref)
    book = clientBookSchema.parse(book)
    if (book.format === 'txt' && (!book.textSource || !textPublication?.publication.size || !textPublication.normalizedText.size)) throw new LocalLibraryError('invalid-input', 'TXT publication and normalized text are required')
    if (!book.content || !sameClientBook(book.content.book, book.ref) || book.availability !== 'available') throw new LocalLibraryError('invalid-input', 'Local content identity is required')
    const digest = await computeBlobSha256(blob)
    const publicationDigest = textPublication ? await computeBlobSha256(textPublication.publication) : null
    return this.transaction(['books', 'files', 'deleted', 'settings'], 'readwrite', async (tx) => {
      if (await request(tx.objectStore('deleted').get(key(book.ref)))) throw new LocalLibraryError('conflict', 'Deleted book identity cannot be reused')
      const existing = await request<ClientBook | undefined>(tx.objectStore('books').get(key(book.ref)))
      if (existing) {
        const storedDigest = await request<string | undefined>(tx.objectStore('files').get(`digest:${key(book.ref)}`))
        if (JSON.stringify(clientBookSchema.parse(existing)) !== JSON.stringify(book) || storedDigest !== digest) throw new LocalLibraryError('conflict', 'Book identity was already used')
        if (textPublication && (await request(tx.objectStore('files').get(`publication-digest:${key(book.ref)}`))) !== publicationDigest) throw new LocalLibraryError('conflict', 'TXT publication identity was already used')
        return existing
      }
      if (book.catalog) {
        const organization = clientOrganizationSchema.parse(await request(tx.objectStore('settings').get(this.organizationKey(book.ref.scope.kind === 'local' ? book.ref.scope.vaultId : ''))) ?? { version: 0, items: [] })
        this.validateMembership(book.catalog, organization)
      }
      await request(tx.objectStore('files').put(blob, key(book.ref)))
      await request(tx.objectStore('files').put(digest, `digest:${key(book.ref)}`))
      if (textPublication) {
        await request(tx.objectStore('files').put(textPublication.publication, `publication:${key(book.ref)}`))
        await request(tx.objectStore('files').put(publicationDigest, `publication-digest:${key(book.ref)}`))
        await request(tx.objectStore('files').put(textPublication.normalizedText, `text:${key(book.ref)}`))
      }
      if (cover) await request(tx.objectStore('files').put(cover, `cover:${key(book.ref)}`))
      await request(tx.objectStore('books').add(book, key(book.ref)))
      return book
    }, signal)
  }

  async listBooks(vaultId: string): Promise<ClientBook[]> {
    return this.transaction(['books'], 'readonly', async (tx) => {
      const books = await request<ClientBook[]>(tx.objectStore('books').getAll())
      return books.map((book) => clientBookSchema.parse(book)).filter((book) => book.ref.scope.kind === 'local' && book.ref.scope.vaultId === vaultId)
    })
  }

  private async readCatalogOnce(vaultId: string): Promise<{ books: Array<{ book: ClientBook; state: ClientReadingState | null }>; organization: ClientOrganization; needsTrashPurge: boolean }> {
    return this.transaction(['books', 'states', 'settings'], 'readonly', async (tx) => {
      const rows = await request<ClientBook[]>(tx.objectStore('books').getAll())
      const books: Array<{ book: ClientBook; state: ClientReadingState | null }> = []
      const trashed: ClientBook[] = []
      for (const raw of rows) {
        if (raw.ref.scope.kind !== 'local' || raw.ref.scope.vaultId !== vaultId) continue
        const book = clientBookSchema.parse(raw)
        if (book.deletedAt != null) trashed.push(book)
        const rawState = await request<ClientReadingState | undefined>(tx.objectStore('states').get(key(book.ref)))
        const state = rawState ? clientReadingStateSchema.parse(rawState) : null
        if (state && !sameClientBook(state.book, book.ref)) throw new LocalLibraryError('storage-unavailable', 'Stored state identity is invalid')
        books.push({ book, state })
      }
      let needsTrashPurge = false
      if (trashed.length > 0) {
        const settings = await this.trashSettingsInTx(tx, vaultId)
        const total = trashed.reduce((sum, book) => sum + (book.size ?? 0), 0)
        const now = Date.now()
        if ((settings.maxTrashBytes ?? 0) > 0 && total > settings.maxTrashBytes!) needsTrashPurge = true
        else if (settings.autoCleanDays > 0 && trashed.some((book) => book.deletedAt! < now - settings.autoCleanDays * 86_400_000)) needsTrashPurge = true
      }
      const organization = clientOrganizationSchema.parse(await request(tx.objectStore('settings').get(this.organizationKey(vaultId))) ?? { version: 0, items: [] })
      return { books, organization, needsTrashPurge }
    })
  }

  async readCatalog(vaultId: string): Promise<{ books: Array<{ book: ClientBook; state: ClientReadingState | null }>; organization: ClientOrganization }> {
    const initial = await this.readCatalogOnce(vaultId)
    if (!initial.needsTrashPurge) return { books: initial.books, organization: initial.organization }
    await this.emptyTrash(vaultId, false)
    const refreshed = await this.readCatalogOnce(vaultId)
    return { books: refreshed.books, organization: refreshed.organization }
  }

  async getBook(ref: ClientBookRef): Promise<ClientBook> {
    this.assertLocal(ref)
    return this.transaction(['books'], 'readonly', (tx) => this.requireBook(tx, ref))
  }

  async getFile(ref: ClientBookRef): Promise<Blob> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      const file = await request<Blob | undefined>(tx.objectStore('files').get(key(ref)))
      if (book.deletedAt != null || book.availability !== 'available' || !file) throw new LocalLibraryError('unavailable-content', 'Local book file is unavailable')
      return file
    })
  }

  async assertPublicationRevision(ref: ClientBookRef, contentId: string): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.content?.contentId !== contentId) throw new LocalLibraryError('conflict', 'Publication revision changed')
      if (book.availability !== 'available' || !await request(tx.objectStore('files').get(key(ref)))) throw new LocalLibraryError('unavailable-content', 'Publication source is unavailable')
    })
  }

  async saveTxtRuleSelection(ref: ClientBookRef, contentId: string, selection: ClientTxtPublication['ruleSelection'], signal?: AbortSignal): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books'], 'readwrite', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.format !== 'txt' || !book.textSource || book.availability !== 'available') throw new LocalLibraryError('unavailable-content', 'Local TXT source is unavailable')
      if (book.content?.contentId !== contentId) throw new LocalLibraryError('conflict', 'Local TXT revision changed')
      if (JSON.stringify(book.textSource.ruleSelection) === JSON.stringify(selection)) return
      const next = clientBookSchema.parse({ ...book, textSource: { ...book.textSource, ruleSelection: selection }, version: book.version + 1, updatedAt: Date.now() })
      await request(tx.objectStore('books').put(next, key(ref)))
    }, signal)
  }

  async getNormalizedTxt(ref: ClientBookRef, expectedContentId: string, signal?: AbortSignal): Promise<string> {
    this.assertLocal(ref)
    const blob = await this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.format !== 'txt' || book.availability !== 'available') throw new LocalLibraryError('unavailable-content', 'Local TXT source is unavailable')
      if (book.content?.contentId !== expectedContentId) throw new LocalLibraryError('conflict', 'Local TXT revision changed')
      const file = await request<Blob | undefined>(tx.objectStore('files').get(`text:${key(ref)}`))
      if (!file || !book.textSource) throw new LocalLibraryError('storage-unavailable', 'Local normalized TXT source is missing')
      return file
    }, signal)
    const text = await blob.text()
    signal?.throwIfAborted()
    return text
  }

  async readPublicationSaveResult(ref: ClientBookRef, contentId: string): Promise<EditorTxtSaveRes> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files', 'settings'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.availability !== 'available' || book.content?.contentId !== contentId || await request(tx.objectStore('files').getKey(key(ref))) === undefined) throw new LocalLibraryError('conflict', 'Publication save no longer owns the current content')
      const receipt = await request<{ result: EditorTxtSaveRes } | undefined>(tx.objectStore('settings').get(JSON.stringify(['publication-replacement', ...clientBookKey(ref), contentId])))
      if (!receipt) throw new LocalLibraryError('conflict', 'Publication save receipt is unavailable')
      return receipt.result
    })
  }

  async replacePublication(input: ClientPublicationReplacement, file: Blob, textPublication?: { publication: Blob; normalizedText: Blob }, signal?: AbortSignal, structuralHeadingIndexes?: number[]): Promise<EditorTxtSaveRes> {
    const command = clientPublicationReplacementSchema.parse(input)
    const { book: ref } = command
    this.assertLocal(ref)
    signal?.throwIfAborted()
    if (file.size > 512 * 1024 * 1024 || Boolean(command.textSource) !== Boolean(textPublication)) throw new LocalLibraryError('invalid-input', 'Invalid publication replacement')
    const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const [fileDigest, publicationDigest, normalizedDigest] = await Promise.all([digest(file), textPublication ? digest(textPublication.publication) : null, textPublication ? digest(textPublication.normalizedText) : null])
    if (textPublication && (normalizedDigest !== fileDigest || !textPublication.publication.size || (await textPublication.normalizedText.text()).length !== command.textSource!.normalizedLength)) throw new LocalLibraryError('invalid-input', 'Edited TXT bytes do not match the normalized source')
    const fingerprint = await readingWriteFingerprint({ command, fileDigest, publicationDigest })
    signal?.throwIfAborted()
    const receiptKey = JSON.stringify(['publication-replacement', ...clientBookKey(ref), command.contentId])
    const preparation = await this.transaction(['books', 'files', 'states', 'notes', 'settings'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.content?.contentId !== command.baseContentId) return null
      const state = await request<ClientReadingState | undefined>(tx.objectStore('states').get(key(ref))) ?? null
      const notes = (await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([ref.scope.kind === 'local' ? ref.scope.vaultId : '', ref.bookId]))).map((note) => clientNoteSchema.parse(note))
      const rounds = await this.readingRoundsInTx(tx, ref)
      const settings = await request<Record<string, unknown> | undefined>(tx.objectStore('settings').get(key(ref))) ?? {}
      const rules = await request<ClientReplacement[] | undefined>(tx.objectStore('settings').get(JSON.stringify(['replacement-rules', ref.scope.kind === 'local' ? ref.scope.vaultId : '']))) ?? []
      const points = rules.filter((row) => row.book && sameClientBook(row.book, ref) && row.rule.matchType === 'point')
      const needed = Boolean(state?.position || state?.fraction != null || state?.coverage || notes.some((note) => note.locator) || points.length || rounds.rounds.some((round) => round.coverage))
      const snapshot: PublicationRelocationSnapshot = { structuralHeadingIndexes, book: ref, baseContentId: command.baseContentId, state, notes, rounds, points, intervals: clientReadingCoverageIntervalsSchema.parse(settings.coverageIntervals ?? []) }
      const source = await request<Blob | undefined>(tx.objectStore('files').get(book.format === 'txt' ? `publication:${key(ref)}` : key(ref)))
      if (book.deletedAt != null || book.availability !== 'available' || !source) throw new LocalLibraryError('unavailable-content', 'Publication source was removed')
      return { snapshot, source, needed }
    })
    const relocation = preparation?.needed ? await preparePublicationRelocationInWorker({ operation: 'relocate', source: preparation.source, target: textPublication?.publication ?? file, snapshot: preparation.snapshot, contentId: command.contentId }, signal ?? new AbortController().signal) : null

    const result = await this.transaction(['books', 'files', 'states', 'notes', 'settings'], 'readwrite', async (tx) => {
      const current = await this.requireBook(tx, ref)
      const files = tx.objectStore('files')
      const settings = tx.objectStore('settings')
      if (current.deletedAt != null || current.availability !== 'available' || await request(files.getKey(key(ref))) === undefined || current.format === 'txt' && await request(files.getKey(`publication:${key(ref)}`)) === undefined) throw new LocalLibraryError('unavailable-content', 'Publication source was removed')
      const receipt = await request<{ fingerprint: string; result: EditorTxtSaveRes } | undefined>(settings.get(receiptKey))
      if (receipt) {
        if (receipt.fingerprint !== fingerprint || current.content?.contentId !== command.contentId) throw new LocalLibraryError('conflict', 'Publication save identity no longer owns the current content')
        return receipt.result
      }
      if (current.content?.contentId !== command.baseContentId) throw new LocalLibraryError('conflict', 'Publication changed in another editor')
      if (await request(settings.get(JSON.stringify(['publication-retired', ...clientBookKey(ref), command.contentId])))) throw new LocalLibraryError('conflict', 'Retired publication identity cannot be reused')
      if (current.format === 'epub' && !file.size) throw new LocalLibraryError('invalid-input', 'EPUB publication cannot be empty')
      if (current.availability !== 'available' || (current.format === 'txt') !== Boolean(command.textSource)) throw new LocalLibraryError('unavailable-content', 'Publication cannot be replaced in this state')
      if (!await request<Blob | undefined>(files.get(key(ref)))) throw new LocalLibraryError('unavailable-content', 'Publication source was removed')
      const rawState = await request(tx.objectStore('states').get(key(ref)))
      const state = rawState ? clientReadingStateSchema.parse(rawState) : null
      if (state && !sameClientBook(state.book, ref)) throw new LocalLibraryError('storage-unavailable', 'Stored reading state belongs to another book')
      const notes = (await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([ref.scope.kind === 'local' ? ref.scope.vaultId : '', ref.bookId]))).map((note) => clientNoteSchema.parse(note))
      if (notes.some((note) => !sameClientBook(note.book, ref))) throw new LocalLibraryError('storage-unavailable', 'Stored note belongs to another book')
      let unlocated: EditorTxtSaveRes['unlocated'] = { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 }
      if (preparation) {
        const snapshot = preparation.snapshot
        const currentRounds = await this.readingRoundsInTx(tx, ref)
        const rulesKey = JSON.stringify(['replacement-rules', ref.scope.kind === 'local' ? ref.scope.vaultId : ''])
        const rules = await request<ClientReplacement[] | undefined>(settings.get(rulesKey)) ?? []
        const points = rules.filter((row) => row.book && sameClientBook(row.book, ref) && row.rule.matchType === 'point')
        if ((state?.version ?? null) !== (snapshot.state?.version ?? null) || notes.length !== snapshot.notes.length || notes.some((note) => snapshot.notes.find((old) => old.id === note.id)?.version !== note.version)
          || JSON.stringify(currentRounds) !== JSON.stringify(snapshot.rounds) || points.length !== snapshot.points.length || points.some((row) => snapshot.points.find((old) => old.id === row.id)?.version !== row.version)) throw new LocalLibraryError('conflict', 'Reading records changed while preparing publication relocation; retry the save')
        if (relocation) {
        if (relocation.state) await request(tx.objectStore('states').put(clientReadingStateSchema.parse(relocation.state), key(ref)))
        for (const note of relocation.notes.filter((note) => note.version !== snapshot.notes.find((old) => old.id === note.id)?.version)) await request(tx.objectStore('notes').put(clientNoteSchema.parse(note), noteKey(ref, note.id)))
        await request(settings.put(clientReadingRoundsSchema.parse(relocation.rounds), JSON.stringify(['reading-rounds', ...clientBookKey(ref)])))
        const preferences = await request<Record<string, unknown> | undefined>(settings.get(key(ref))) ?? {}
        await request(settings.put({ ...preferences, coverageIntervals: relocation.intervals }, key(ref)))
        await request(settings.put(rules.map((row) => relocation.points.find((point) => point.id === row.id) ?? row), rulesKey))
        unlocated = relocation.unlocated
        }
      }
      const next = clientBookSchema.parse({ ...current, content: { book: ref, contentId: command.contentId }, ...(command.textSource ? { textSource: command.textSource } : {}), size: file.size, version: current.version + 1, updatedAt: Date.now() })
      await request(files.put(file, key(ref)))
      await request(files.put(fileDigest, `digest:${key(ref)}`))
      if (textPublication) {
        await request(files.put(textPublication.publication, `publication:${key(ref)}`))
        await request(files.put(publicationDigest, `publication-digest:${key(ref)}`))
        await request(files.put(textPublication.normalizedText, `text:${key(ref)}`))
      }
      await request(tx.objectStore('books').put(next, key(ref)))
      await request(settings.put(true, JSON.stringify(['publication-retired', ...clientBookKey(ref), command.baseContentId])))
      await this.advanceReadingVersion(tx, ref.scope.kind === 'local' ? ref.scope.vaultId : '')
      const result: EditorTxtSaveRes = { revisionId: command.contentId, changed: true, unlocated }
      await request(settings.put({ fingerprint, result }, receiptKey))
      return result
    }, signal)
    if (preparation) this.publicationChanged(ref)
    return result
  }

  private async compactCoverIfOversized(ref: ClientBookRef, blob: Blob | null): Promise<Blob | null> {
    if (!blob || blob.size <= 256 * 1024) return blob
    const thumbnail = await createCoverThumbnail(blob)
    if (!thumbnail || thumbnail.size >= blob.size) return blob
    const coverKey = `cover:${key(ref)}`
    void this.transaction(['files'], 'readwrite', async (tx) => {
      const current = await request<Blob | undefined>(tx.objectStore('files').get(coverKey))
      if (current && current.size === blob.size && current.type === blob.type) {
        await request(tx.objectStore('files').put(thumbnail, coverKey))
      }
    }).catch(() => {})
    return thumbnail
  }

  async getCover(ref: ClientBookRef): Promise<Blob | null> {
    this.assertLocal(ref)
    const blob = await this.transaction(['files'], 'readonly', async (tx) => await request<Blob | undefined>(tx.objectStore('files').get(`cover:${key(ref)}`)) ?? null)
    return this.compactCoverIfOversized(ref, blob)
  }

  async getCovers(refs: readonly ClientBookRef[]): Promise<Map<string, Blob | null>> {
    const result = new Map<string, Blob | null>()
    if (refs.length === 0) return result
    for (const ref of refs) this.assertLocal(ref)
    const raw = await this.transaction(['files'], 'readonly', async (tx) => {
      const store = tx.objectStore('files')
      return Promise.all(refs.map(async (ref) => [ref, await request<Blob | undefined>(store.get(`cover:${key(ref)}`)) ?? null] as const))
    })
    await Promise.all(raw.map(async ([ref, blob]) => {
      result.set(ref.bookId, await this.compactCoverIfOversized(ref, blob))
    }))
    return result
  }

  async getPublicationFile(ref: ClientBookRef): Promise<Blob> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      const file = await request<Blob | undefined>(tx.objectStore('files').get(book.format === 'txt' ? `publication:${key(ref)}` : key(ref)))
      if (book.deletedAt != null || book.availability !== 'available' || !file) throw new LocalLibraryError('unavailable-content', 'Local publication is unavailable')
      return file
    })
  }

  async hasPublication(ref: ClientBookRef): Promise<boolean> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.deletedAt != null || book.availability !== 'available') return false
      return await request(tx.objectStore('files').getKey(book.format === 'txt' ? `publication:${key(ref)}` : key(ref))) !== undefined
    })
  }

  async getNormalizedText(ref: ClientBookRef): Promise<Blob> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      const file = await request<Blob | undefined>(tx.objectStore('files').get(`text:${key(ref)}`))
      if (book.deletedAt != null || book.availability !== 'available' || book.format !== 'txt' || !file) throw new LocalLibraryError('unavailable-content', 'Normalized TXT content is unavailable')
      return file
    })
  }

  async getState(ref: ClientBookRef): Promise<ClientReadingState | null> {
    this.assertLocal(ref)
    return this.transaction(['states'], 'readonly', async (tx) => {
      const stored = await request<ClientReadingState | undefined>(tx.objectStore('states').get(key(ref)))
      if (!stored) return null
      const state = clientReadingStateSchema.parse(stored)
      if (!sameClientBook(state.book, ref)) throw new LocalLibraryError('storage-unavailable', 'Stored state identity is invalid')
      return state
    })
  }

  async setReadStatus(ref: ClientBookRef, readStatus: ReadStatus): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books', 'states'], 'readwrite', async (tx) => {
      await this.requireBook(tx, ref)
      const current = await request<ClientReadingState | undefined>(tx.objectStore('states').get(key(ref)))
      const next = clientReadingStateSchema.parse({ book: ref, position: null, fraction: null, coverage: null, lastReadAt: null, ...current, readStatus, updatedAt: Date.now(), version: (current?.version ?? 0) + 1 })
      await request(tx.objectStore('states').put(next, key(ref)))
    })
  }

  async saveState(state: ClientReadingState, expectedVersion: number, coverageIntervals?: Array<[number, number]>): Promise<ClientReadingState> {
    this.assertLocal(state.book)
    clientReadingStateSchema.parse(state)
    return this.transaction(['books', 'states', 'settings'], 'readwrite', async (tx) => {
      const book = await this.requireBook(tx, state.book)
      if (book.deletedAt != null || book.availability !== 'available') throw new LocalLibraryError('unavailable-content', 'Local book file is unavailable')
      if (state.position && (!sameClientBook(state.position.content.book, state.book) || state.position.content.contentId !== book.content?.contentId)) throw new LocalLibraryError('invalid-input', 'Position belongs to different content')
      if (state.coverage && (!sameClientBook(state.coverage.content.book, state.book) || state.coverage.content.contentId !== book.content?.contentId)) throw new LocalLibraryError('invalid-input', 'Coverage belongs to different content')
      const current = await request<ClientReadingState | undefined>(tx.objectStore('states').get(key(state.book)))
      if ((current?.version ?? 0) !== expectedVersion) throw new LocalLibraryError('conflict', 'Reading state was changed in another tab')
      const next = { ...state, ...(current?.positionHistory ? { positionHistory: current.positionHistory } : {}), fractionContent: state.position?.content ?? state.fractionContent ?? (state.fraction === null ? null : current?.fractionContent ?? null), version: expectedVersion + 1 }
      await request(tx.objectStore('states').put(next, key(state.book)))
      if (coverageIntervals) {
        const settings = tx.objectStore('settings')
        const existing = await request<Record<string, unknown> | undefined>(settings.get(key(state.book))) ?? {}
        await request(settings.put({ ...existing, coverageIntervals }, key(state.book)))
        const before = await this.readingRoundsInTx(tx, state.book)
        if (state.coverage && (!before.rounds.length || before.rounds.at(-1)?.coverage?.content.contentId !== state.coverage.content.contentId || JSON.stringify(existing.coverageIntervals ?? []) !== JSON.stringify(coverageIntervals))) {
          const rounds = await this.ensureReadingRoundsInTx(tx, state.book)
          const round = rounds.rounds.at(-1)!
          if (round.coverage && round.coverage.content.contentId !== state.coverage.content.contentId) round.coverageHistory = [...(round.coverageHistory ?? []), round.coverage]
          round.coverage = { content: state.coverage.content, intervals: clientReadingCoverageIntervalsSchema.parse(coverageIntervals) }
          rounds.version++
          await request(settings.put(clientReadingRoundsSchema.parse(rounds), JSON.stringify(['reading-rounds', ...clientBookKey(state.book)])))
          await this.advanceReadingVersion(tx, state.book.scope.kind === 'local' ? state.book.scope.vaultId : '')
        }
      }
      return next
    })
  }

  async readBookNotesSnapshot(ref: ClientBookRef): Promise<ClientBookNotesSnapshot> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files', 'notes'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      const publicationKey = book.format === 'txt' ? `publication:${key(ref)}` : key(ref)
      const sourceAvailable = book.deletedAt == null && book.availability === 'available' && await request(tx.objectStore('files').getKey(publicationKey)) !== undefined
      const notes = (await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([ref.scope.kind === 'local' ? ref.scope.vaultId : '', ref.bookId]))).map((note) => {
        const parsed = clientNoteSchema.parse(note)
        if (!sameClientBook(parsed.book, ref)) throw new LocalLibraryError('storage-unavailable', 'Stored note identity is invalid')
        return parsed
      })
      return { book, notes, sourceAvailable }
    })
  }

  async listNotes(ref: ClientBookRef): Promise<ClientNote[]> {
    this.assertLocal(ref)
    return this.transaction(['notes'], 'readonly', async (tx) => (await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([ref.scope.kind === 'local' ? ref.scope.vaultId : '', ref.bookId]))).map((note) => clientNoteSchema.parse(note)))
  }

  async readReplacements(vaultId: string, bookId?: string): Promise<{ data: TextReplacementRes[] }> {
    return this.transaction(['settings', 'books'], 'readonly', async (tx) => {
      const rows = (await request<ClientReplacement[] | undefined>(tx.objectStore('settings').get(JSON.stringify(['replacement-rules', vaultId]))) ?? []).map((row) => clientReplacementSchema.parse(row))
      const book = bookId ? await this.requireBook(tx, { scope: { kind: 'local', vaultId }, bookId }) : null
      const overrides = bookId ? await request<Record<string, boolean> | undefined>(tx.objectStore('settings').get(JSON.stringify(['replacement-overrides', vaultId, bookId]))) ?? {} : {}
      return { data: rows.filter((row) => row.book === null || row.book.bookId === bookId).map((row, index) => ({
        id: row.id, clientVersion: row.version, bookId: row.book?.bookId ?? null, scope: row.book ? 'book' : 'global',
        matchType: row.rule.matchType, pattern: row.rule.pattern ?? null, replacement: row.rule.replacement ?? null, isRegex: row.rule.isRegex,
        applyTo: row.rule.applyTo, enabled: row.rule.enabled, name: row.rule.name ?? null, group: row.rule.group ?? null,
        spineHref: row.rule.spineHref ?? null, textOffset: row.rule.textOffset ?? null, originalText: row.rule.originalText ?? null,
        locationAvailable: row.rule.matchType !== 'point' || row.contentId === book?.content?.contentId && book.availability === 'available',
        sortOrder: index, createdAt: row.createdAt, updatedAt: row.updatedAt,
        ...(bookId ? { effectiveEnabled: overrides[row.id] ?? row.rule.enabled, hasOverride: row.id in overrides } : {}),
      })) }
    })
  }

  /** Per-book enable/disable overrides for the rules this device can see. */
  async readReplacementOverrides(vaultId: string, bookId: string): Promise<Record<string, boolean>> {
    return this.transaction(['settings'], 'readonly', async (tx) => (
      await request<Record<string, boolean> | undefined>(tx.objectStore('settings').get(JSON.stringify(['replacement-overrides', vaultId, bookId]))) ?? {}
    ))
  }

  async mutateReplacement(vaultId: string, id: string, command: { create: ReplacementCreateReq; expectedContentId?: string } | { update: ReplacementUpdateReq; expectedVersion: number } | { delete: true; expectedVersion: number }): Promise<void> {
    await this.transaction(['books', 'settings', 'deleted'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const rulesKey = JSON.stringify(['replacement-rules', vaultId])
      const rows = (await request<ClientReplacement[] | undefined>(store.get(rulesKey)) ?? []).map((row) => clientReplacementSchema.parse(row))
      const current = rows.find((row) => row.id === id)
      if ('create' in command) {
        if (current || rows.length >= 1000 || await request(tx.objectStore('deleted').get(JSON.stringify(['replacement', vaultId, id])))) throw new LocalLibraryError('conflict', 'Replacement identity is unavailable')
        const rule = replacementCreateSchema.parse(command.create)
        const ref = rule.bookId ? { scope: { kind: 'local' as const, vaultId }, bookId: rule.bookId } : null
        const book = ref ? await this.requireBook(tx, ref) : null
        if (book && book.content?.contentId !== command.expectedContentId) throw new LocalLibraryError('conflict', 'Replacement selection belongs to an older publication')
        if (rule.matchType === 'point' && (!book?.content || book.availability !== 'available')) throw new LocalLibraryError('unavailable-content', 'Point replacement needs publication content')
        const now = Date.now()
        rows.push(clientReplacementSchema.parse({ id, book: ref, contentId: rule.matchType === 'point' ? book!.content!.contentId : null, rule, version: 1, createdAt: now, updatedAt: now }))
      } else {
        if (!current || current.version !== command.expectedVersion) throw new LocalLibraryError('conflict', 'Replacement changed in another view')
        if ('delete' in command) {
          rows.splice(rows.indexOf(current), 1)
          await request(tx.objectStore('deleted').put(true, JSON.stringify(['replacement', vaultId, id])))
        } else {
          const update = replacementUpdateSchema.parse(command.update)
          const rule = replacementCreateSchema.parse({ ...current.rule, ...update, name: update.name === null ? undefined : update.name ?? current.rule.name, group: update.group === null ? undefined : update.group ?? current.rule.group })
          rows[rows.indexOf(current)] = clientReplacementSchema.parse({ ...current, rule, updatedAt: Date.now(), version: current.version + 1 })
        }
      }
      await request(store.put(rows, rulesKey))
    })
  }

  async deleteReplacements(vaultId: string, targets: Array<{ id: string; version: number }>): Promise<void> {
    if (targets.length > 1000 || new Set(targets.map((target) => target.id)).size !== targets.length) throw new LocalLibraryError('invalid-input', 'Invalid replacement selection')
    await this.transaction(['settings', 'deleted'], 'readwrite', async (tx) => {
      const rulesKey = JSON.stringify(['replacement-rules', vaultId])
      const rows = await request<ClientReplacement[] | undefined>(tx.objectStore('settings').get(rulesKey)) ?? []
      for (const target of targets) if (rows.find((row) => row.id === target.id)?.version !== target.version) throw new LocalLibraryError('conflict', 'Replacement selection changed')
      for (const target of targets) await request(tx.objectStore('deleted').put(true, JSON.stringify(['replacement', vaultId, target.id])))
      await request(tx.objectStore('settings').put(rows.filter((row) => !targets.some((target) => target.id === row.id)), rulesKey))
    })
  }

  async overrideReplacement(vaultId: string, id: string, bookId: string, enabled: boolean | null, expectedVersion: number): Promise<void> {
    await this.transaction(['settings', 'books'], 'readwrite', async (tx) => {
      await this.requireBook(tx, { scope: { kind: 'local', vaultId }, bookId })
      const rows = await request<ClientReplacement[] | undefined>(tx.objectStore('settings').get(JSON.stringify(['replacement-rules', vaultId]))) ?? []
      const row = rows.find((row) => row.id === id)
      if (!row || row.book && row.book.bookId !== bookId || row.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Replacement changed in another view')
      const overrideKey = JSON.stringify(['replacement-overrides', vaultId, bookId])
      const overrides = await request<Record<string, boolean> | undefined>(tx.objectStore('settings').get(overrideKey)) ?? {}
      if (enabled === null) delete overrides[id]
      else overrides[id] = enabled
      await request(tx.objectStore('settings').put(overrides, overrideKey))
      row.version++
      row.updatedAt = Date.now()
      await request(tx.objectStore('settings').put(rows, JSON.stringify(['replacement-rules', vaultId])))
    })
  }

  async stageNoteImage(ref: ClientBookRef, draftId: string, targetId: string | undefined, file: File, signal: AbortSignal): Promise<ClientNoteImage> {
    this.assertLocal(ref)
    if (!draftId || file.size < 1 || file.size > 5 * 1024 * 1024 || file.name.length > 255) throw new LocalLibraryError('invalid-input', 'Invalid note image')
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
    const mimeType = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null
    if (!mimeType || file.type !== mimeType) throw new LocalLibraryError('invalid-input', 'Unsupported note image')
    const image = clientNoteImageSchema.parse({ id: `local-image_${localRecordId()}`, name: file.name, mimeType, size: file.size })
    await this.transaction(['books', 'notes', 'files'], 'readwrite', async (tx) => {
      await this.requireBook(tx, ref)
      if (targetId && !await request(tx.objectStore('notes').get(noteKey(ref, targetId)))) throw new LocalLibraryError('conflict', 'Note no longer exists')
      const store = tx.objectStore('files')
      const prefix = JSON.stringify(['note-image', ...clientBookKey(ref)]).slice(0, -1) + ','
      let count = 0
      let unclaimed = 0
      for (const entry of await request(store.getAllKeys())) {
        if (typeof entry !== 'string' || !entry.startsWith(prefix)) continue
        const row = await request<any>(store.get(entry))
        if (!row.noteId && row.createdAt + CONTENT_DRAFT_TTL_MS < Date.now()) await request(store.delete(entry))
        else { if (row.draftId === draftId) count++; if (!row.noteId) unclaimed++ }
      }
      if (count >= IDEA_IMAGE_MAX_COUNT || unclaimed >= IDEA_IMAGE_MAX_COUNT * 8) throw new LocalLibraryError('invalid-input', 'Too many note images')
      await request(store.put({ image, blob: file, draftId, targetId, createdAt: Date.now() }, JSON.stringify(['note-image', ...clientBookKey(ref), image.id])))
    }, signal, false)
    return image
  }

  async cancelNoteImages(ref: ClientBookRef, draftId: string): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['files'], 'readwrite', async (tx) => {
      const store = tx.objectStore('files')
      const prefix = JSON.stringify(['note-image', ...clientBookKey(ref)]).slice(0, -1) + ','
      for (const entry of await request(store.getAllKeys())) {
        if (typeof entry !== 'string' || !entry.startsWith(prefix)) continue
        const row = await request<any>(store.get(entry))
        if (!row.noteId && row.draftId === draftId) await request(store.delete(entry))
      }
    }, undefined, false)
  }

  async readNoteImage(ref: ClientBookRef, id: string): Promise<Blob> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      await this.requireBook(tx, ref)
      const row = await request<any>(tx.objectStore('files').get(JSON.stringify(['note-image', ...clientBookKey(ref), id])))
      if (!row || !row.noteId && row.createdAt + CONTENT_DRAFT_TTL_MS < Date.now()) throw new LocalLibraryError('unavailable-content', 'Note image is unavailable')
      return row.blob
    })
  }

  async saveNote(note: ClientNote, expectedVersion: number, replaceIds: string[] = [], association?: { imageIds?: string[]; draftId?: string }): Promise<ClientNote> {
    this.assertLocal(note.book)
    clientNoteSchema.parse(note)
    const creationFingerprint = JSON.stringify([noteFingerprint(note), [...replaceIds].sort(), association?.imageIds ?? null])
    return this.transaction(['books', 'notes', 'deleted', 'files'], 'readwrite', async (tx) => {
      const book = await this.requireBook(tx, note.book)
      const store = tx.objectStore('notes')
      if (await request(tx.objectStore('deleted').get(`note:${noteKey(note.book, note.id)}`))) throw new LocalLibraryError('conflict', 'Deleted note identity cannot be reused')
      const current = await request<(ClientNote & { creationFingerprint?: string }) | undefined>(store.get(noteKey(note.book, note.id)))
      if (note.locator && note.locator.content.contentId !== book.content?.contentId && JSON.stringify(note.locator) !== JSON.stringify(current?.locator)) throw new LocalLibraryError('invalid-input', 'Note belongs to different content')
      if (association?.imageIds !== undefined) {
        if (note.kind !== 'idea' || association.imageIds.length > IDEA_IMAGE_MAX_COUNT || new Set(association.imageIds).size !== association.imageIds.length) throw new LocalLibraryError('invalid-input', 'Invalid note image selection')
        const images: ClientNoteImage[] = []
        for (const id of association.imageIds) {
          const imageKey = JSON.stringify(['note-image', ...clientBookKey(note.book), id])
          const row = await request<any>(tx.objectStore('files').get(imageKey))
          if (!row || row.noteId && row.noteId !== note.id || !row.noteId && (row.draftId !== association.draftId || row.targetId && row.targetId !== note.id || row.createdAt + CONTENT_DRAFT_TTL_MS < Date.now())) throw new LocalLibraryError('conflict', 'Note image does not belong to this draft')
          images.push(clientNoteImageSchema.parse(row.image))
          await request(tx.objectStore('files').put({ ...row, noteId: note.id }, imageKey))
        }
        for (const old of current?.kind === 'idea' ? current.images ?? [] : []) if (!association.imageIds.includes(old.id)) await request(tx.objectStore('files').delete(JSON.stringify(['note-image', ...clientBookKey(note.book), old.id])))
        note = { ...note, images }
      } else if (note.kind === 'idea' && JSON.stringify(note.images ?? []) !== JSON.stringify(current?.kind === 'idea' ? current.images ?? [] : [])) throw new LocalLibraryError('invalid-input', 'Note images require a draft association')
      if (expectedVersion === 0 && current?.version === 1 && current.creationFingerprint === creationFingerprint) return clientNoteSchema.parse(current)
      if ((current?.version ?? 0) !== expectedVersion) throw new LocalLibraryError('conflict', 'Note was changed in another tab')
      if (replaceIds.length && note.kind !== 'highlight') throw new LocalLibraryError('invalid-input', 'Only highlights replace highlights')
      for (const id of replaceIds) {
        const replaced = await request<ClientNote | undefined>(store.get(noteKey(note.book, id)))
        if (!replaced || replaced.kind !== 'highlight') throw new LocalLibraryError('conflict', 'Replacement highlight is unavailable')
        await request(store.delete(noteKey(note.book, id)))
        await request(tx.objectStore('deleted').put(true, `note:${noteKey(note.book, id)}`))
      }
      const next = { ...note, ...(current?.locatorHistory ? { locatorHistory: current.locatorHistory } : {}), version: expectedVersion + 1, ...(expectedVersion === 0 ? { creationFingerprint } : {}) }
      await request(store.put(next, noteKey(note.book, note.id)))
      return clientNoteSchema.parse(next)
    })
  }

  async deleteNotes(ref: ClientBookRef, targets: Array<Pick<ClientNote, 'id'> & Partial<Pick<ClientNote, 'version'>>>): Promise<void> {
    this.assertLocal(ref)
    if (targets.length > 1000 || targets.some((target) => !target.id || target.version !== undefined && (!Number.isSafeInteger(target.version) || target.version < 0))) throw new LocalLibraryError('invalid-input', 'Invalid note deletion targets')
    await this.transaction(['books', 'notes', 'deleted', 'files'], 'readwrite', async (tx) => {
      await this.requireBook(tx, ref)
      const notes = tx.objectStore('notes')
      const deleted = tx.objectStore('deleted')
      for (const target of targets) {
        const stored = await request<ClientNote | undefined>(notes.get(noteKey(ref, target.id)))
        if (stored && (!sameClientBook(clientNoteSchema.parse(stored).book, ref) || target.version !== undefined && stored.version !== target.version)) throw new LocalLibraryError('conflict', 'Note changed in another view')
        if (!stored && target.version !== undefined && !await request(deleted.get(`note:${noteKey(ref, target.id)}`))) throw new LocalLibraryError('conflict', 'Note no longer exists')
        if (stored?.kind === 'idea') for (const image of stored.images ?? []) await request(tx.objectStore('files').delete(JSON.stringify(['note-image', ...clientBookKey(ref), image.id])))
        await request(notes.delete(noteKey(ref, target.id)))
        await request(deleted.put(true, `note:${noteKey(ref, target.id)}`))
      }
    })
  }

  async deleteNote(ref: ClientBookRef, id: string, expectedVersion?: number): Promise<void> {
    await this.deleteNotes(ref, [{ id, version: expectedVersion }])
  }

  /**
   * A device book carries at most one review (the server's `own` row shape).
   * It never publishes: the vault has no source listing to share to.
   */
  async getReview(ref: ClientBookRef): Promise<ClientReview | null> {
    return this.transaction(['reviews'], 'readonly', async (tx) => {
      const row = await request<ClientReview | undefined>(tx.objectStore('reviews').get(key(ref)))
      return row ? clientReviewSchema.parse(row) : null
    })
  }

  async saveReview(ref: ClientBookRef, input: ClientReviewInput, expectedVersion?: number): Promise<ClientReview> {
    this.assertLocal(ref)
    return this.transaction(['reviews', 'books'], 'readwrite', async (tx) => {
      await this.requireBook(tx, ref)
      const store = tx.objectStore('reviews')
      const current = await request<ClientReview | undefined>(store.get(key(ref)))
      if (current && expectedVersion !== undefined && current.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Review was changed in another tab')
      const now = Date.now()
      const next = clientReviewSchema.parse({
        id: current?.id ?? input.id ?? localRecordId(),
        book: ref,
        ratingHalves: input.ratingHalves,
        title: input.title,
        body: input.body,
        bodyFormat: input.bodyFormat,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        version: (current?.version ?? -1) + 1,
      })
      await request(store.put(next, key(ref)))
      return next
    })
  }

  async deleteReview(ref: ClientBookRef, expectedVersion?: number): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['reviews'], 'readwrite', async (tx) => {
      const store = tx.objectStore('reviews')
      const current = await request<ClientReview | undefined>(store.get(key(ref)))
      if (!current) return
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Review was changed in another tab')
      await request(store.delete(key(ref)))
    })
  }

  async updateMetadata(ref: ClientBookRef, patch: Partial<Pick<ClientBook, 'title' | 'authors'>> & { catalog?: Partial<ClientCatalogAttributes>; categoryTemplateKey?: string }, expectedVersion: number, cover?: Blob | null): Promise<ClientBook> {
    this.assertLocal(ref)
    return this.transaction(['books', 'files', 'settings'], 'readwrite', (tx) => this.updateMetadataInTx(tx, ref, patch, expectedVersion, cover))
  }

  private async updateMetadataInTx(tx: IDBTransaction, ref: ClientBookRef, patch: Parameters<LocalLibraryRepository['updateMetadata']>[1], expectedVersion: number, cover?: Blob | null): Promise<ClientBook> {
    const catalog = patch.catalog === undefined ? undefined : clientCatalogAttributesSchema.strict().parse(patch.catalog)
    const template = patch.categoryTemplateKey === undefined ? undefined : categoryTemplatePath(patch.categoryTemplateKey)
    if (patch.categoryTemplateKey !== undefined && !template) throw new LocalLibraryError('invalid-input', 'Unknown category template')
    const current = await this.requireBook(tx, ref)
    if (current.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Book was changed in another tab')
    let attributes = catalog
    if (catalog || template) {
      const organizationKey = this.organizationKey(ref.scope.kind === 'local' ? ref.scope.vaultId : '')
      const organization = clientOrganizationSchema.parse(await request(tx.objectStore('settings').get(organizationKey)) ?? { version: 0, items: [] })
      if (template) {
        let parentId: string | null = null
        let created = false
        for (const name of template) {
          let item = organization.items.find((entry) => entry.kind === 'category' && entry.parentId === parentId && entry.name === name)
          if (!item) {
            const now = Date.now()
            item = { id: localRecordId(), kind: 'category', name, parentId, pinned: false, hidden: false, sortOrder: Math.max(-1, ...organization.items.filter((entry) => entry.kind === 'category').map((entry) => entry.sortOrder)) + 1, createdAt: now, updatedAt: now }
            organization.items.push(item)
            created = true
          }
          parentId = item.id
        }
        attributes = { ...catalog, categoryId: parentId }
        if (created) await request(tx.objectStore('settings').put({ ...organization, version: organization.version + 1 }, organizationKey))
      }
      this.validateMembership(attributes ?? {}, organization)
    }
    const next = clientBookSchema.parse({ ...current,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.authors === undefined ? {} : { authors: patch.authors }),
      ...(attributes === undefined ? {} : { catalog: { ...current.catalog, ...attributes } }),
      updatedAt: Date.now(), version: current.version + 1 })
    if (cover === null) await request(tx.objectStore('files').delete(`cover:${key(ref)}`))
    else if (cover !== undefined) await request(tx.objectStore('files').put(cover, `cover:${key(ref)}`))
    await request(tx.objectStore('books').put(next, key(ref)))
    return next
  }

  async updateBooksMetadata(changes: Array<{ ref: ClientBookRef; patch: Parameters<LocalLibraryRepository['updateMetadata']>[1]; expectedVersion: number }>): Promise<void> {
    if (!changes.length || changes.length > 2000 || new Set(changes.map((change) => key(change.ref))).size !== changes.length) throw new LocalLibraryError('invalid-input', 'Invalid book selection')
    for (const change of changes) {
      this.assertLocal(change.ref)
      if (JSON.stringify(change.ref.scope) !== JSON.stringify(changes[0].ref.scope)) throw new LocalLibraryError('invalid-input', 'Selection spans multiple vaults')
    }
    await this.transaction(['books', 'files', 'settings'], 'readwrite', async (tx) => {
      for (const change of changes) await this.updateMetadataInTx(tx, change.ref, change.patch, change.expectedVersion)
    })
  }

  private organizationKey(vaultId: string): string {
    if (!vaultId) throw new LocalLibraryError('invalid-input', 'A local vault identity is required')
    return JSON.stringify(['organization', vaultId])
  }

  async getCatalogPreferences(vaultId: string): Promise<ClientCatalogPreferences> {
    this.organizationKey(vaultId)
    return this.transaction(['settings'], 'readonly', async (tx) => clientCatalogPreferencesSchema.parse(await request(tx.objectStore('settings').get(JSON.stringify(['catalog-preferences', vaultId]))) ?? {}))
  }

  async patchCatalogPreferences(vaultId: string, patch: ClientCatalogPreferences): Promise<void> {
    this.organizationKey(vaultId)
    const parsed = clientCatalogPreferencesSchema.parse(patch)
    await this.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const preferenceKey = JSON.stringify(['catalog-preferences', vaultId])
      const current = clientCatalogPreferencesSchema.parse(await request(store.get(preferenceKey)) ?? {})
      await request(store.put({ ...current, ...parsed }, preferenceKey))
    })
  }

  async toggleCatalogHidden(vaultId: string): Promise<void> {
    this.organizationKey(vaultId)
    await this.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const preferenceKey = JSON.stringify(['catalog-preferences', vaultId])
      const current = clientCatalogPreferencesSchema.parse(await request(store.get(preferenceKey)) ?? {})
      await request(store.put({ ...current, showHidden: !current.showHidden }, preferenceKey))
    })
  }

  private validateMembership(catalog: Partial<ClientCatalogAttributes>, organization: ClientOrganization): void {
    for (const [kind, ids] of [
      ['shelf', catalog.shelfId ? [catalog.shelfId] : []],
      ['category', catalog.categoryId ? [catalog.categoryId] : []],
      ['tag', catalog.tagIds ?? []],
    ] as const) {
      if (ids.some((id) => !organization.items.some((item) => item.id === id && item.kind === kind))) throw new LocalLibraryError('invalid-input', 'Organization does not belong to this vault')
    }
  }

  async getOrganization(vaultId: string): Promise<ClientOrganization> {
    return this.transaction(['settings'], 'readonly', async (tx) => clientOrganizationSchema.parse(await request(tx.objectStore('settings').get(this.organizationKey(vaultId))) ?? { version: 0, items: [] }))
  }

  /**
   * Cache the tree the user is looking at. A device book may sit on a shelf
   * that only the server knows, so the shelf ids a device book can carry are
   * exactly the ones written here; membership validation then stays strict and
   * the vault still refuses ids nobody owns. Nodes created on this device are
   * never removed by a mirror.
   */
  async mirrorOrganization(vaultId: string, items: readonly ClientOrganization['items'][number][]): Promise<void> {
    await this.withOrganizationLock(vaultId, () => this.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const current = clientOrganizationSchema.parse(await request(store.get(this.organizationKey(vaultId))) ?? { version: 0, items: [] })
      const byId = new Map(current.items.map((item) => [item.id, item]))
      let changed = false
      for (const item of items) {
        if (byId.get(item.id)?.kind === item.kind && JSON.stringify(byId.get(item.id)) === JSON.stringify(item)) continue
        byId.set(item.id, item)
        changed = true
      }
      if (!changed) return
      await request(store.put(clientOrganizationSchema.parse({ version: current.version + 1, items: [...byId.values()] }), this.organizationKey(vaultId)))
    }))
  }

  private validateOrganizationStructure(parsed: ClientOrganization): Set<string> {
    const ids = new Set(parsed.items.map((item) => item.id))
    if (ids.size !== parsed.items.length) throw new LocalLibraryError('invalid-input', 'Organization identities must be unique')
    for (const item of parsed.items) {
      const seen = new Set([item.id])
      let parentId = item.parentId
      if (item.kind !== 'category' && parentId !== null) throw new LocalLibraryError('invalid-input', 'Only categories may have parents')
      while (parentId !== null) {
        const parent = parsed.items.find((candidate) => candidate.id === parentId && candidate.kind === 'category')
        if (!parent || seen.has(parentId)) throw new LocalLibraryError('invalid-input', 'Category ancestry is invalid')
        seen.add(parentId)
        parentId = parent.parentId
      }
    }
    return ids
  }

  private async saveOrganizationInTx(tx: IDBTransaction, vaultId: string, parsed: ClientOrganization, ids: Set<string>, expectedVersion: number): Promise<ClientOrganization> {
    const store = tx.objectStore('settings')
    const current = clientOrganizationSchema.parse(await request(store.get(this.organizationKey(vaultId))) ?? { version: 0, items: [] })
    if (current.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Organization was changed in another tab')
    const next = { ...parsed, version: expectedVersion + 1 }
    const books = await request<ClientBook[]>(tx.objectStore('books').getAll())
    for (const raw of books) {
      if (raw.ref.scope.kind !== 'local' || raw.ref.scope.vaultId !== vaultId) continue
      const book = clientBookSchema.parse(raw)
      if (!book.catalog) continue
      const catalog = { ...book.catalog,
        ...(book.catalog.shelfId && !ids.has(book.catalog.shelfId) ? { shelfId: null } : {}),
        ...(book.catalog.categoryId && !ids.has(book.catalog.categoryId) ? { categoryId: null } : {}),
        ...(book.catalog.tagIds ? { tagIds: book.catalog.tagIds.filter((id) => ids.has(id)) } : {}),
      }
      this.validateMembership(catalog, next)
      if (JSON.stringify(catalog) === JSON.stringify(book.catalog)) continue
      await request(tx.objectStore('books').put({ ...book, catalog, version: book.version + 1, updatedAt: Date.now() }, key(book.ref)))
    }
    await request(store.put(next, this.organizationKey(vaultId)))
    return next
  }

  async saveOrganization(vaultId: string, value: ClientOrganization, expectedVersion: number): Promise<ClientOrganization> {
    const parsed = clientOrganizationSchema.parse(value)
    const ids = this.validateOrganizationStructure(parsed)
    return this.withOrganizationLock(vaultId, () => this.transaction(['settings', 'books'], 'readwrite', (tx) => this.saveOrganizationInTx(tx, vaultId, parsed, ids, expectedVersion)))
  }

  private taxonomyMirrorKey(vaultId: string): string {
    return JSON.stringify(['account-taxonomy-mirror', vaultId])
  }

  /**
   * Mirrors the signed-in account's taxonomy into the vault organization so
   * device books can join account groups: mirror entries carry the server
   * ids, names follow the account, and local pin/hide preferences survive.
   * Mirrors that the account removed are dropped (membership cleanup rides
   * on saveOrganizationInTx) inside one serialized transaction.
   */
  async syncAccountTaxonomy(vaultId: string, accountItems: Array<{ id: string; kind: 'shelf' | 'tag'; name: string; sortOrder: number }>): Promise<void> {
    await this.withOrganizationLock(vaultId, async () => {
      const { org, mirrored } = await this.transaction(['settings'], 'readonly', async (tx) => {
        const store = tx.objectStore('settings')
        const org = clientOrganizationSchema.parse(await request(store.get(this.organizationKey(vaultId))) ?? { version: 0, items: [] })
        const mirrored = (await request<unknown>(store.get(this.taxonomyMirrorKey(vaultId)))) as string[] | undefined ?? []
        return { org, mirrored }
      })
      const now = Date.now()
      const accountIds = new Set(accountItems.map((item) => item.id))
      const nextMirror = [...accountIds]
      const mirroredChanged = mirrored.length !== nextMirror.length || mirrored.some((id, index) => id !== nextMirror[index])
      let orgChanged = false
      const items = org.items.map((item) => ({ ...item }))
      for (const [index, account] of accountItems.entries()) {
        const existing = items.find((item) => item.id === account.id)
        if (existing) {
          if (existing.kind !== account.kind || existing.name !== account.name) {
            existing.kind = account.kind
            existing.name = account.name
            existing.updatedAt = now
            orgChanged = true
          }
        } else {
          items.push({ id: account.id, kind: account.kind, name: account.name, parentId: null, pinned: false, hidden: false, sortOrder: index, createdAt: now, updatedAt: now })
          orgChanged = true
        }
      }
      const removedMirrors = new Set(mirrored.filter((id) => !accountIds.has(id)))
      const nextItems = items.filter((item) => !removedMirrors.has(item.id) || item.kind === 'category')
      if (nextItems.length !== items.length) orgChanged = true
      if (!orgChanged && !mirroredChanged) return
      if (!orgChanged) {
        await this.transaction(['settings'], 'readwrite', async (tx) => {
          await request(tx.objectStore('settings').put(nextMirror, this.taxonomyMirrorKey(vaultId)))
        }, undefined, false)
        return
      }
      const parsed = clientOrganizationSchema.parse({ version: org.version, items: nextItems })
      const ids = this.validateOrganizationStructure(parsed)
      await this.transaction(['settings', 'books'], 'readwrite', async (tx) => {
        await this.saveOrganizationInTx(tx, vaultId, parsed, ids, org.version)
        await request(tx.objectStore('settings').put(nextMirror, this.taxonomyMirrorKey(vaultId)))
      })
    })
  }

  async readEditorDraft(ref: ClientBookRef, format: 'txt' | 'epub'): Promise<unknown> {
    this.assertLocal(ref)
    return this.transaction(['books', 'settings'], 'readonly', async (tx) => {
      await this.requireBook(tx, ref)
      return request(tx.objectStore('settings').get(JSON.stringify(['editor-draft', ...clientBookKey(ref), format])))
    })
  }

  async replaceEditorDraft(ref: ClientBookRef, format: 'txt' | 'epub', expectedToken: string | null, record: LocalEditorDraftEnvelope | null, canWrite: () => boolean): Promise<boolean> {
    this.assertLocal(ref)
    const parsed = record === null ? null : localDraftEnvelopeSchema.parse(record)
    const keyText = JSON.stringify([ref.scope, format, ref.bookId, null])
    if (parsed && (parsed.key !== keyText || new Blob([JSON.stringify(parsed)]).size > CONTENT_EDITOR_MAX_REQUEST_BYTES)) throw new LocalLibraryError('invalid-input', 'Invalid local editor draft')
    return this.transaction(['books', 'settings'], 'readwrite', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.availability !== 'available' || book.format !== format) throw new LocalLibraryError('unavailable-content', 'Local editor source was removed')
      const store = tx.objectStore('settings')
      const draftKey = JSON.stringify(['editor-draft', ...clientBookKey(ref), format])
      const value = await request<LocalEditorDraftEnvelope | undefined>(store.get(draftKey))
      if (!canWrite() || (value?.token ?? null) !== expectedToken) return false
      if (parsed && !value) {
        const prefix = `${JSON.stringify(['editor-draft', ...clientBookKey(ref).slice(0, -1)]).slice(0, -1)},`
        const count = await request(store.count(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))
        if (count >= 8) throw new LocalLibraryError('storage-full', 'Local editor draft quota reached')
      }
      if (!canWrite()) return false
      if (parsed) await request(store.put(parsed, draftKey))
      else await request(store.delete(draftKey))
      return true
    }, undefined, false)
  }

  async getPreferences(ref: ClientBookRef): Promise<Record<string, unknown>> {
    this.assertLocal(ref)
    return this.transaction(['settings'], 'readonly', async (tx) => await request<Record<string, unknown> | undefined>(tx.objectStore('settings').get(key(ref))) ?? {})
  }

  private async advanceReadingVersion(tx: IDBTransaction, vaultId: string): Promise<void> {
    const store = tx.objectStore('settings')
    const versionKey = JSON.stringify(['reading-ledger-version', vaultId])
    const version = await request<number | undefined>(store.get(versionKey)) ?? 0
    if (!Number.isSafeInteger(version) || version < 0) throw new LocalLibraryError('storage-unavailable', 'Stored reading ledger version is invalid')
    await request(store.put(version + 1, versionKey))
  }

  async enqueueReadingCapture(input: ClientReadingCapture): Promise<void> {
    const capture = clientReadingCaptureSchema.parse(input)
    this.assertLocal(capture.book)
    const vaultId = capture.book.scope.kind === 'local' ? capture.book.scope.vaultId : ''
    const pendingKey = JSON.stringify(['reading-pending', vaultId, capture.book.bookId, capture.requestId])
    await this.transaction(['books', 'settings'], 'readwrite', async (tx) => {
      await this.requireBook(tx, capture.book)
      const store = tx.objectStore('settings')
      const existing = await request<ClientReadingCapture | undefined>(store.get(pendingKey))
      if (existing && JSON.stringify(clientReadingCaptureSchema.parse(existing)) !== JSON.stringify(capture)) throw new LocalLibraryError('conflict', 'Pending reading request identity was already used')
      await request(store.put(capture, pendingKey))
    }, undefined, false)
  }

  async enqueueReadingCaptureGroup(input: ClientReadingCaptureGroup, updatedAt: number): Promise<void> {
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new LocalLibraryError('invalid-input', 'Capture finalization time is invalid')
    const group = clientReadingCaptureGroupSchema.parse(input)
    this.assertLocal(group.book)
    const vaultId = group.book.scope.kind === 'local' ? group.book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint(group)
    const receiptKey = JSON.stringify(['reading-group', vaultId, group.id])
    const pendingKey = JSON.stringify(['reading-pending-group', vaultId, group.book.bookId, group.id])
    await this.transaction(['books', 'settings', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, group.book)
      const receipts = tx.objectStore('reading-receipts')
      const receipt = await request<{ fingerprint: string; status: string } | undefined>(receipts.get(receiptKey))
      if (receipt && receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading capture group identity was already used')
      if (receipt) return
      if (await request(receipts.get(JSON.stringify(['reading-manual-finalized', vaultId, group.id])))) throw new LocalLibraryError('conflict', 'Discarded manual timer cannot settle')
      if (group.captures.length > 1) for (const capture of group.captures) if (await request(receipts.get(JSON.stringify(['reading-write', vaultId, capture.requestId])))) throw new LocalLibraryError('conflict', 'Reading chunk was already settled outside this group')
      const store = tx.objectStore('settings')
      const draftKey = JSON.stringify(['reading-draft', vaultId, group.book.bookId, group.captures[0]!.source])
      const stored = await request(store.get(draftKey))
      if (stored) {
        const draft = clientReadingTimerDraftSchema.parse(stored)
        if (draft.capture.requestId !== group.id || draft.updatedAt > updatedAt) throw new LocalLibraryError('conflict', 'A newer timer draft owns this capture')
        if (draft.phase === 'queued' && (group.captures.length !== 1 || JSON.stringify(draft.capture) !== JSON.stringify(group.captures[0]))) throw new LocalLibraryError('conflict', 'Queued timer capture cannot acquire more time')
        await request(store.delete(draftKey))
      }
      if (group.captures[0]!.source === 'manual') {
        const manualKey = JSON.stringify(['reading-manual', vaultId, group.book.bookId, group.captures[0]!.deviceId ?? ''])
        const value = await request(store.get(manualKey))
        if (value) {
          const snapshot = clientManualTimerSnapshotSchema.parse(value)
          if (snapshot.requestId !== group.id || snapshot.updatedAt > updatedAt) throw new LocalLibraryError('conflict', 'A newer manual timer owns this capture')
          await request(store.delete(manualKey))
        }
      }
      await request(store.put(group, pendingKey))
      await request(receipts.put({ fingerprint, status: 'pending' }, receiptKey))
    }, undefined, false)
  }

  async listPendingReadingCaptureGroups(vaultId: string): Promise<ClientReadingCaptureGroup[]> {
    const prefix = `${JSON.stringify(['reading-pending-group', vaultId]).slice(0, -1)},`
    return this.transaction(['settings'], 'readonly', async (tx) => {
      const store = tx.objectStore('settings')
      const groups: ClientReadingCaptureGroup[] = []
      for (const entry of await request(store.getAllKeys())) {
        if (typeof entry !== 'string' || !entry.startsWith(prefix)) continue
        const group = clientReadingCaptureGroupSchema.parse(await request(store.get(entry)))
        if (group.book.scope.kind !== 'local' || group.book.scope.vaultId !== vaultId || entry !== JSON.stringify(['reading-pending-group', vaultId, group.book.bookId, group.id])) throw new LocalLibraryError('storage-unavailable', 'Stored reading capture group identity is invalid')
        groups.push(group)
      }
      return groups
    })
  }

  private async writeReadingCaptureGroupInTx(tx: IDBTransaction, group: ClientReadingCaptureGroup, chunkFingerprints: string[]): Promise<void> {
    const vaultId = group.book.scope.kind === 'local' ? group.book.scope.vaultId : ''
    const receipts = tx.objectStore('reading-receipts')
    if (group.captures.length > 1) for (const capture of group.captures) if (await request(receipts.get(JSON.stringify(['reading-write', vaultId, capture.requestId])))) throw new LocalLibraryError('conflict', 'Reading chunk was already settled outside this group')
    const prior = await request<ClientReadingSession[]>(tx.objectStore('reading-sessions').index('vault').getAll(vaultId))
    let excluded = prior.flatMap((session) => clientReadingSessionSchema.parse(session).acceptedFragments)
    let acceptedMilliseconds = 0
    for (const capture of group.captures) {
      const accepted = subtractTimeFragments(readingCaptureFragments(capture), excluded)
      acceptedMilliseconds += accepted.reduce((sum, fragment) => sum + fragment.endedAt - fragment.startedAt, 0)
      excluded = mergeTimeFragments([...excluded, ...accepted])
    }
    // A transport-sized tail still belongs to the accepted logical capture.
    const minimum = acceptedMilliseconds >= 60_000 ? 0 : 60
    for (let index = 0; index < group.captures.length; index++) await this.writeReadingSessionInTx(tx, group.captures[index]!, chunkFingerprints[index]!, undefined, minimum, group.id)
  }

  async commitReadingCaptureGroup(input: ClientReadingCaptureGroup): Promise<void> {
    const group = clientReadingCaptureGroupSchema.parse(input)
    this.assertLocal(group.book)
    const vaultId = group.book.scope.kind === 'local' ? group.book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint(group)
    const chunkFingerprints = await Promise.all(group.captures.map((capture) => readingWriteFingerprint({ capture, expected: null })))
    await this.transaction(['books', 'states', 'settings', 'reading-sessions', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, group.book)
      const receiptKey = JSON.stringify(['reading-group', vaultId, group.id])
      const receipts = tx.objectStore('reading-receipts')
      const receipt = await request<{ fingerprint: string; status: string } | undefined>(receipts.get(receiptKey))
      if (!receipt || receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading capture group is not queued with this payload')
      if (receipt.status === 'committed') return
      await this.writeReadingCaptureGroupInTx(tx, group, chunkFingerprints)
      await request(receipts.put({ fingerprint, status: 'committed' }, receiptKey))
    })
  }

  async acknowledgeReadingCaptureGroup(book: ClientBookRef, id: string): Promise<void> {
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    await this.transaction(['settings'], 'readwrite', async (tx) => { await request(tx.objectStore('settings').delete(JSON.stringify(['reading-pending-group', vaultId, book.bookId, id]))) }, undefined, false)
  }

  private async readingRoundsInTx(tx: IDBTransaction, book: ClientBookRef): Promise<ClientReadingRounds> {
    const value = await request(tx.objectStore('settings').get(JSON.stringify(['reading-rounds', ...clientBookKey(book)])))
    if (!value) return { book, version: 0, rounds: [] }
    const history = clientReadingRoundsSchema.parse(value)
    if (!sameClientBook(history.book, book)) throw new LocalLibraryError('storage-unavailable', 'Stored reading rounds belong to another book')
    return history
  }

  private async ensureReadingRoundsInTx(tx: IDBTransaction, book: ClientBookRef): Promise<ClientReadingRounds> {
    const history = await this.readingRoundsInTx(tx, book)
    if (!history.rounds.length) {
      const state = await request<ClientReadingState | undefined>(tx.objectStore('states').get(key(book)))
      const status = state?.readStatus === 'finished' || state?.readStatus === 'abandoned' ? state.readStatus : 'reading'
      const preferences = await request<Record<string, unknown> | undefined>(tx.objectStore('settings').get(key(book)))
      const coverage = state?.coverage ? { content: state.coverage.content, intervals: clientReadingCoverageIntervalsSchema.parse(preferences?.coverageIntervals ?? []) } : undefined
      history.rounds.push({ id: localRecordId(), ordinal: 1, status, startedAt: null, endedAt: null, ...(coverage ? { coverage } : {}) })
      await request(tx.objectStore('settings').put(history, JSON.stringify(['reading-rounds', ...clientBookKey(book)])))
    }
    return history
  }

  async readReadingRounds(book: ClientBookRef): Promise<ClientReadingRounds> {
    this.assertLocal(book)
    return this.transaction(['books', 'settings'], 'readonly', async (tx) => {
      await this.requireBook(tx, book)
      return this.readingRoundsInTx(tx, book)
    })
  }

  private async changeReadingRoundInTx(tx: IDBTransaction, book: ClientBookRef, history: ClientReadingRounds, action: ClientReadingRoundAction): Promise<ClientReadingRounds> {
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    let round = history.rounds.at(-1)!
    const now = Date.now()
    if (action === 'reread') {
      if (round.status === 'reading') { round.status = 'abandoned'; round.endedAt = now }
      round = { id: localRecordId(), ordinal: round.ordinal + 1, status: 'reading', startedAt: now, endedAt: null }
      history.rounds.push(round)
    } else {
      const sessions = await request<ClientReadingSession[]>(tx.objectStore('reading-sessions').index('book').getAll([vaultId, book.bookId]))
      const undo = action === 'continue' && round.status === 'reading' && round.ordinal > 1 && !round.coverage?.intervals.some(([start, end]) => start !== end) && !sessions.some((session) => clientReadingSessionSchema.parse(session).roundId === round.id)
      if (undo) { history.rounds.pop(); round = history.rounds.at(-1)! }
      else { round.status = action === 'finish' ? 'finished' : action === 'abandon' ? 'abandoned' : 'reading'; round.endedAt = round.status === 'reading' ? null : now }
    }
    history.version++
    const parsed = clientReadingRoundsSchema.parse(history)
    const states = tx.objectStore('states')
    const current = await request<ClientReadingState | undefined>(states.get(key(book)))
    const roundCoverage = round.coverage
    const coverage = roundCoverage ? { content: roundCoverage.content, fraction: roundCoverage.intervals.reduce((sum, [start, end]) => sum + end - start, 0), available: true } : null
    const state = clientReadingStateSchema.parse({ book, position: null, fraction: null, coverage: null, lastReadAt: null, ...current, ...(action === 'reread' || action === 'continue' ? { coverage } : {}), readStatus: round.status, updatedAt: now, version: (current?.version ?? 0) + 1 })
    if (action === 'reread' || action === 'continue') {
      const preferences = await request<Record<string, unknown> | undefined>(tx.objectStore('settings').get(key(book))) ?? {}
      await request(tx.objectStore('settings').put({ ...preferences, coverageIntervals: roundCoverage?.intervals ?? [] }, key(book)))
    }
    await request(states.put(state, key(book)))
    await request(tx.objectStore('settings').put(parsed, JSON.stringify(['reading-rounds', ...clientBookKey(book)])))
    return parsed
  }

  async changeReadingRound(book: ClientBookRef, action: ClientReadingRoundAction, expectedVersion: number, requestId: string): Promise<ClientReadingRounds> {
    this.assertLocal(book)
    if (!['reread', 'continue', 'finish', 'abandon'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !requestId || requestId.length > 100) throw new LocalLibraryError('invalid-input', 'Reading round command is invalid')
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint({ book: clientBookKey(book), action, expectedVersion })
    const receiptKey = JSON.stringify(['reading-round', vaultId, requestId])
    return this.transaction(['books', 'states', 'settings', 'reading-sessions', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      const receipts = tx.objectStore('reading-receipts')
      const receipt = await request<{ fingerprint: string } | undefined>(receipts.get(receiptKey))
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading round command identity was already used')
        return this.readingRoundsInTx(tx, book)
      }
      const history = await this.ensureReadingRoundsInTx(tx, book)
      if (history.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Reading round changed in another view')
      const parsed = await this.changeReadingRoundInTx(tx, book, history, action)
      await request(receipts.put({ fingerprint }, receiptKey))
      await this.advanceReadingVersion(tx, vaultId)
      return parsed
    })
  }

  async addReadingEntry(input: ClientReadingEntry): Promise<ClientReadingSession | null> {
    const entry = clientReadingEntrySchema.parse(input)
    const { capture } = entry
    this.assertLocal(capture.book)
    const vaultId = capture.book.scope.kind === 'local' ? capture.book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint(entry)
    return this.transaction(['books', 'states', 'settings', 'reading-sessions', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, capture.book)
      const receipts = tx.objectStore('reading-receipts')
      const receiptKey = JSON.stringify(['reading-write', vaultId, capture.requestId])
      const prior = await request(receipts.get(receiptKey))
      if (prior) return this.writeReadingSessionInTx(tx, capture, fingerprint)
      const history = await this.ensureReadingRoundsInTx(tx, capture.book)
      const supplied = readingCaptureFragments(capture)
      const overlap = (fragments: ClientReadingSession['acceptedFragments']) => fragments.some((a) => supplied.some((b) => a.startedAt < b.endedAt && a.endedAt > b.startedAt))
      const sessions = tx.objectStore('reading-sessions')
      if (entry.replaceSessionIds?.length) {
        if (capture.source !== 'retroactive' || !supplied.length) throw new LocalLibraryError('invalid-input', 'Only timed retroactive entries can replace overlapping sessions')
        for (const id of new Set(entry.replaceSessionIds)) {
          const value = await request(sessions.get(noteKey(capture.book, id)))
          const existing = value ? clientReadingSessionSchema.parse(value) : undefined
          if (!existing || !sameClientBook(existing.capture.book, capture.book) || (existing.roundId ?? history.rounds[0]!.id) !== history.rounds.at(-1)!.id || !overlap(existing.acceptedFragments)) throw new LocalLibraryError('invalid-input', 'Only overlapping sessions in the current book and round can be replaced')
          await request(sessions.delete(noteKey(capture.book, id)))
        }
      }
      if (capture.source === 'retroactive' && supplied.length) {
        const conflicts = (await request<ClientReadingSession[]>(sessions.index('vault').getAll(vaultId))).map((value) => clientReadingSessionSchema.parse(value)).filter((value) => overlap(value.acceptedFragments))
        if (conflicts.length) {
          const hasUnreplaceableConflicts = conflicts.some((value) => !sameClientBook(value.capture.book, capture.book) || (value.roundId ?? history.rounds[0]!.id) !== history.rounds.at(-1)!.id)
          throw new LocalLibraryError('conflict', 'Reading interval overlaps existing records', { conflictingSessionIds: hasUnreplaceableConflicts ? [] : conflicts.map((value) => value.id), hasUnreplaceableConflicts })
        }
      }
      const result = await this.writeReadingSessionInTx(tx, capture, fingerprint)
      if (result && entry.finished) await this.changeReadingRoundInTx(tx, capture.book, history, 'finish')
      const manualKey = JSON.stringify(['reading-manual', vaultId, capture.book.bookId, capture.deviceId ?? ''])
      const manualValue = await request(tx.objectStore('settings').get(manualKey))
      if (manualValue) {
        const snapshot = clientManualTimerSnapshotSchema.parse(manualValue)
        if (snapshot.requestId === capture.requestId) {
          if (snapshot.updatedAt !== entry.expectedManualUpdatedAt || snapshot.phase !== 'paused') throw new LocalLibraryError('conflict', 'Manual timer changed while its entry was being saved')
          await request(tx.objectStore('settings').delete(manualKey))
        }
      }
      return result
    })
  }

  async addReadingGroupEntry(input: ClientReadingGroupEntry): Promise<void> {
    const entry = clientReadingGroupEntrySchema.parse(input)
    const { group } = entry
    this.assertLocal(group.book)
    const vaultId = group.book.scope.kind === 'local' ? group.book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint(entry)
    const fingerprints = await Promise.all(group.captures.map((capture) => readingWriteFingerprint({ capture, expected: null })))
    await this.transaction(['books', 'states', 'settings', 'reading-sessions', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, group.book)
      const receipts = tx.objectStore('reading-receipts')
      const receiptKey = JSON.stringify(['reading-group', vaultId, group.id])
      const receipt = await request<{ fingerprint: string; status: string } | undefined>(receipts.get(receiptKey))
      if (receipt) {
        if (receipt.fingerprint !== fingerprint || receipt.status !== 'committed') throw new LocalLibraryError('conflict', 'Reading capture group identity was already used')
        return
      }
      if (await request(receipts.get(JSON.stringify(['reading-manual-finalized', vaultId, group.id])))) throw new LocalLibraryError('conflict', 'Discarded manual timer cannot settle')
      const manualKey = JSON.stringify(['reading-manual', vaultId, group.book.bookId, group.captures[0]!.deviceId ?? ''])
      const settings = tx.objectStore('settings')
      const value = await request(settings.get(manualKey))
      if (value) {
        const snapshot = clientManualTimerSnapshotSchema.parse(value)
        if (snapshot.requestId !== group.id || snapshot.updatedAt !== entry.expectedManualUpdatedAt || snapshot.phase !== 'paused') throw new LocalLibraryError('conflict', 'Manual timer changed while its entry was being saved')
      }
      for (const capture of group.captures) if (await request(receipts.get(JSON.stringify(['reading-write', vaultId, capture.requestId])))) throw new LocalLibraryError('conflict', 'Reading chunk was already settled outside this group')
      await this.writeReadingCaptureGroupInTx(tx, group, fingerprints)
      if (entry.finished) await this.changeReadingRoundInTx(tx, group.book, await this.ensureReadingRoundsInTx(tx, group.book), 'finish')
      if (value) await request(settings.delete(manualKey))
      await request(receipts.put({ fingerprint, status: 'committed' }, receiptKey))
    })
  }

  async saveManualTimerSnapshot(input: ClientManualTimerSnapshot): Promise<boolean> {
    const snapshot = clientManualTimerSnapshotSchema.parse(input)
    const { book } = snapshot
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const snapshotKey = JSON.stringify(['reading-manual', vaultId, book.bookId, snapshot.deviceId ?? ''])
    return this.transaction(['books', 'settings', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      if (await request(tx.objectStore('reading-receipts').get(JSON.stringify(['reading-manual-finalized', vaultId, snapshot.requestId]))) || await request(tx.objectStore('reading-receipts').get(JSON.stringify(['reading-group', vaultId, snapshot.requestId]))) || await request(tx.objectStore('reading-receipts').get(JSON.stringify(['reading-write', vaultId, snapshot.requestId])))) throw new LocalLibraryError('conflict', 'Finalized manual timer cannot resume')
      const store = tx.objectStore('settings')
      const value = await request(store.get(snapshotKey))
      if (value) {
        const current = clientManualTimerSnapshotSchema.parse(value)
        if (current.requestId !== snapshot.requestId || current.updatedAt > snapshot.updatedAt) return false
      }
      await request(store.put(snapshot, snapshotKey))
      return true
    }, undefined, false)
  }

  async listManualTimerSnapshots(vaultId: string): Promise<ClientManualTimerSnapshot[]> {
    const prefix = `${JSON.stringify(['reading-manual', vaultId]).slice(0, -1)},`
    return this.transaction(['settings'], 'readonly', async (tx) => {
      const store = tx.objectStore('settings')
      const snapshots: ClientManualTimerSnapshot[] = []
      for (const entry of await request(store.getAllKeys())) {
        if (typeof entry !== 'string' || !entry.startsWith(prefix)) continue
        const snapshot = clientManualTimerSnapshotSchema.parse(await request(store.get(entry)))
        const { book } = snapshot
        if (book.scope.kind !== 'local' || book.scope.vaultId !== vaultId || entry !== JSON.stringify(['reading-manual', vaultId, book.bookId, snapshot.deviceId ?? ''])) throw new LocalLibraryError('storage-unavailable', 'Stored manual timer identity is invalid')
        snapshots.push(snapshot)
      }
      return snapshots
    })
  }

  async acknowledgeManualTimerSnapshot(input: ClientManualTimerSnapshot): Promise<void> {
    const snapshot = clientManualTimerSnapshotSchema.parse(input)
    this.assertLocal(snapshot.book)
    const vaultId = snapshot.book.scope.kind === 'local' ? snapshot.book.scope.vaultId : ''
    const snapshotKey = JSON.stringify(['reading-manual', vaultId, snapshot.book.bookId, snapshot.deviceId ?? ''])
    const fingerprint = await readingWriteFingerprint(snapshot)
    await this.transaction(['settings', 'reading-receipts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const current = await request(store.get(snapshotKey))
      if (current && JSON.stringify(clientManualTimerSnapshotSchema.parse(current)) === JSON.stringify(snapshot)) {
        await request(store.delete(snapshotKey))
        await request(tx.objectStore('reading-receipts').put({ fingerprint }, JSON.stringify(['reading-manual-finalized', vaultId, snapshot.requestId])))
      }
    }, undefined, false)
  }

  async saveReadingTimerDraft(input: ClientReadingTimerDraft): Promise<boolean> {
    const draft = clientReadingTimerDraftSchema.parse(input)
    const { book, source } = draft.capture
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const draftKey = JSON.stringify(['reading-draft', vaultId, book.bookId, source])
    return this.transaction(['books', 'settings', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      if (await request(tx.objectStore('reading-receipts').get(JSON.stringify(['reading-group', vaultId, draft.capture.requestId])))) throw new LocalLibraryError('conflict', 'Finalized timer capture cannot resume')
      const store = tx.objectStore('settings')
      const value = await request(store.get(draftKey))
      if (value) {
        const current = clientReadingTimerDraftSchema.parse(value)
        if (current.capture.requestId !== draft.capture.requestId || current.updatedAt > draft.updatedAt) return false
        if (current.phase === 'queued' && (draft.phase !== 'queued' || JSON.stringify(current.capture) !== JSON.stringify(draft.capture))) throw new LocalLibraryError('conflict', 'Queued timer capture cannot acquire more time')
      }
      await request(store.put(draft, draftKey))
      return true
    }, undefined, false)
  }

  async listReadingTimerDrafts(vaultId: string): Promise<ClientReadingTimerDraft[]> {
    const prefix = `${JSON.stringify(['reading-draft', vaultId]).slice(0, -1)},`
    return this.transaction(['settings'], 'readonly', async (tx) => {
      const store = tx.objectStore('settings')
      const drafts: ClientReadingTimerDraft[] = []
      for (const entry of await request(store.getAllKeys())) {
        if (typeof entry !== 'string' || !entry.startsWith(prefix)) continue
        const draft = clientReadingTimerDraftSchema.parse(await request(store.get(entry)))
        const { book, source } = draft.capture
        if (book.scope.kind !== 'local' || book.scope.vaultId !== vaultId || entry !== JSON.stringify(['reading-draft', vaultId, book.bookId, source])) throw new LocalLibraryError('storage-unavailable', 'Stored timer draft identity is invalid')
        drafts.push(draft)
      }
      return drafts
    })
  }

  async acknowledgeReadingTimerDraft(input: ClientReadingTimerDraft): Promise<void> {
    const draft = clientReadingTimerDraftSchema.parse(input)
    const { book, source } = draft.capture
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const draftKey = JSON.stringify(['reading-draft', vaultId, book.bookId, source])
    await this.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const current = await request(store.get(draftKey))
      if (current && JSON.stringify(clientReadingTimerDraftSchema.parse(current)) === JSON.stringify(draft)) await request(store.delete(draftKey))
    }, undefined, false)
  }

  async listPendingReadingCaptures(vaultId: string): Promise<ClientReadingCapture[]> {
    const prefix = `${JSON.stringify(['reading-pending', vaultId]).slice(0, -1)},`
    return this.transaction(['settings'], 'readonly', async (tx) => {
      const store = tx.objectStore('settings')
      const keys = (await request(store.getAllKeys())).filter((entry) => typeof entry === 'string' && entry.startsWith(prefix))
      const captures: ClientReadingCapture[] = []
      for (const entry of keys) {
        const capture = clientReadingCaptureSchema.parse(await request(store.get(entry)))
        if (capture.book.scope.kind !== 'local' || capture.book.scope.vaultId !== vaultId || entry !== JSON.stringify(['reading-pending', vaultId, capture.book.bookId, capture.requestId])) throw new LocalLibraryError('storage-unavailable', 'Stored pending reading identity is invalid')
        captures.push(capture)
      }
      return captures
    })
  }

  async acknowledgeReadingCapture(book: ClientBookRef, requestId: string): Promise<void> {
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    await this.transaction(['settings'], 'readwrite', async (tx) => { await request(tx.objectStore('settings').delete(JSON.stringify(['reading-pending', vaultId, book.bookId, requestId]))) }, undefined, false)
  }

  async claimReadingTimer(vaultId: string, value: ReadingTimerClaimInput): Promise<boolean> {
    const input = readingTimerClaimSchema.parse(value)
    return this.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const leaseKey = JSON.stringify(['reading-timer-lease', vaultId])
      const prior = await request<ReadingTimerLease | undefined>(store.get(leaseKey))
      if (prior && (!readingTimerClaimSchema.safeParse(prior).success || !Number.isSafeInteger(prior.expiresAt) || prior.expiresAt < 0)) throw new LocalLibraryError('storage-unavailable', 'Stored reading timer lease is invalid')
      const now = Date.now()
      if (!acceptsReadingTimerClaim(prior, input, now)) return false
      await request(store.put({ deviceId: input.deviceId, mode: input.mode, activityAt: Math.min(input.activityAt, now), expiresAt: now + 30_000 } satisfies ReadingTimerLease, leaseKey))
      return true
    }, undefined, false)
  }

  async releaseReadingTimer(vaultId: string, deviceId: string, activityAt: number): Promise<void> {
    await this.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.objectStore('settings')
      const leaseKey = JSON.stringify(['reading-timer-lease', vaultId])
      const current = await request<ReadingTimerLease | undefined>(store.get(leaseKey))
      if (current?.deviceId === deviceId && current.activityAt <= activityAt) await request(store.delete(leaseKey))
    }, undefined, false)
  }

  private async readingBookSnapshotInTx(tx: IDBTransaction, ref: ClientBookRef): Promise<ClientReadingBookSnapshot> {
    const vaultId = ref.scope.kind === 'local' ? ref.scope.vaultId : ''
    const book = await this.requireBook(tx, ref)
    const rawState = await request(tx.objectStore('states').get(key(ref)))
    const state = rawState ? clientReadingStateSchema.parse(rawState) : null
    if (state && !sameClientBook(state.book, ref)) throw new LocalLibraryError('storage-unavailable', 'Stored reading state belongs to another book')
    const settings = tx.objectStore('settings')
    const preferences = await request<Record<string, unknown> | undefined>(settings.get(key(ref)))
    const coverageIntervals = clientReadingCoverageIntervalsSchema.parse(preferences?.coverageIntervals ?? [])
    const sessions = (await request<ClientReadingSession[]>(tx.objectStore('reading-sessions').index('book').getAll([vaultId, ref.bookId]))).map((value) => {
      const session = clientReadingSessionSchema.parse(value)
      if (!sameClientBook(session.capture.book, ref)) throw new LocalLibraryError('storage-unavailable', 'Stored reading session belongs to another book')
      return session
    })
    const version = await request<number | undefined>(settings.get(JSON.stringify(['reading-ledger-version', vaultId]))) ?? 0
    if (!Number.isSafeInteger(version) || version < 0) throw new LocalLibraryError('storage-unavailable', 'Stored reading ledger version is invalid')
    return { book, state, coverageIntervals, rounds: await this.readingRoundsInTx(tx, ref), ledger: { sessions, version } }
  }

  async readReadingBookSnapshot(ref: ClientBookRef): Promise<ClientReadingBookSnapshot> {
    this.assertLocal(ref)
    return this.transaction(['books', 'states', 'settings', 'reading-sessions'], 'readonly', (tx) => this.readingBookSnapshotInTx(tx, ref))
  }

  async readVaultReadingSnapshot(vaultId: string): Promise<ClientVaultReadingSnapshot> {
    return this.transaction(['books', 'states', 'settings', 'reading-sessions', 'notes', 'reviews'], 'readonly', async (tx) => {
      const rows = await request<ClientBook[]>(tx.objectStore('books').getAll())
      const books: ClientReadingBookSnapshot[] = []
      const notes: ClientNote[] = []
      const reviews: ClientReview[] = []
      for (const raw of rows) {
        if (raw.ref.scope.kind !== 'local' || raw.ref.scope.vaultId !== vaultId) continue
        const book = clientBookSchema.parse(raw)
        books.push(await this.readingBookSnapshotInTx(tx, book.ref))
        for (const row of await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([vaultId, book.ref.bookId]))) {
          const note = clientNoteSchema.parse(row)
          if (!sameClientBook(note.book, book.ref)) throw new LocalLibraryError('storage-unavailable', 'Stored note belongs to another book')
          notes.push(note)
        }
        const review = await request<ClientReview | undefined>(tx.objectStore('reviews').get(key(book.ref)))
        if (review) {
          const parsed = clientReviewSchema.parse(review)
          if (!sameClientBook(parsed.book, book.ref)) throw new LocalLibraryError('storage-unavailable', 'Stored review belongs to another book')
          reviews.push(parsed)
        }
      }
      const organization = clientOrganizationSchema.parse(await request(tx.objectStore('settings').get(this.organizationKey(vaultId))) ?? { version: 0, items: [] })
      return { books, notes, organization, reviews }
    })
  }

  async readReadingLedger(vaultId: string, book?: ClientBookRef): Promise<ClientReadingLedger> {
    if (book) {
      this.assertLocal(book)
      if (book.scope.kind !== 'local' || book.scope.vaultId !== vaultId) throw new LocalLibraryError('invalid-input', 'Reading book belongs to another vault')
    }
    return this.transaction(['reading-sessions', 'settings'], 'readonly', async (tx) => {
      const index = tx.objectStore('reading-sessions').index(book ? 'book' : 'vault')
      const rows = await request<unknown[]>(index.getAll(book ? [vaultId, book.bookId] : vaultId))
      const sessions = rows.map((row) => {
        const parsed = clientReadingSessionSchema.safeParse(row)
        if (!parsed.success || parsed.data.capture.book.scope.kind !== 'local' || parsed.data.capture.book.scope.vaultId !== vaultId || book && !sameClientBook(parsed.data.capture.book, book)) throw new LocalLibraryError('storage-unavailable', 'Stored reading session is invalid')
        return parsed.data
      })
      const version = await request<number | undefined>(tx.objectStore('settings').get(JSON.stringify(['reading-ledger-version', vaultId]))) ?? 0
      if (!Number.isSafeInteger(version) || version < 0) throw new LocalLibraryError('storage-unavailable', 'Stored reading ledger version is invalid')
      return { version, sessions }
    })
  }

  async writeReadingSession(input: ClientReadingCapture, expected?: { id: string; version: number }): Promise<ClientReadingSession | null> {
    const parsed = clientReadingCaptureSchema.safeParse(input)
    if (!parsed.success) throw new LocalLibraryError('invalid-input', 'Invalid reading capture')
    const capture = parsed.data
    this.assertLocal(capture.book)
    const fingerprint = await readingWriteFingerprint({ capture, expected: expected ? { id: expected.id, version: expected.version } : null })
    return this.transaction(['books', 'states', 'reading-sessions', 'reading-receipts', 'settings'], 'readwrite', (tx) => this.writeReadingSessionInTx(tx, capture, fingerprint, expected))
  }

  private async writeReadingSessionInTx(tx: IDBTransaction, capture: ClientReadingCapture, fingerprint: string, expected?: { id: string; version: number }, automaticMinimumSeconds = 60, groupId?: string, retained?: { roundId: string; revisionId?: string }): Promise<ClientReadingSession | null> {
    const vaultId = capture.book.scope.kind === 'local' ? capture.book.scope.vaultId : ''
    const receiptKey = JSON.stringify(['reading-write', vaultId, capture.requestId])
    const book = await this.requireBook(tx, capture.book)
    const sessions = tx.objectStore('reading-sessions')
    const receipts = tx.objectStore('reading-receipts')
    const receipt = await request<{ fingerprint: string; sessionId: string | null } | undefined>(receipts.get(receiptKey))
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading request identity was already used')
      const previous = receipt.sessionId ? await request(sessions.get(noteKey(capture.book, receipt.sessionId))) : null
      if (!previous) return null
      const replay = clientReadingSessionSchema.parse(previous)
      if (!sameClientBook(replay.capture.book, capture.book) || replay.id !== receipt.sessionId) throw new LocalLibraryError('storage-unavailable', 'Stored reading session identity is invalid')
      return replay
    }
    const existing = expected ? await request<ClientReadingSession | undefined>(sessions.get(noteKey(capture.book, expected.id))) : undefined
    if (existing && (!sameClientBook(clientReadingSessionSchema.parse(existing).capture.book, capture.book) || existing.id !== expected?.id)) throw new LocalLibraryError('storage-unavailable', 'Stored reading session identity is invalid')
    if (expected && (!existing || existing.version !== expected.version)) throw new LocalLibraryError('conflict', 'Reading session changed in another view')
    if (existing && (existing.capture.source === 'auto' || existing.capture.source !== capture.source)) throw new LocalLibraryError('invalid-input', 'Automatic capture and session source cannot be edited')
    if (capture.revisionId && book.content?.contentId !== capture.revisionId && existing?.capture.revisionId !== capture.revisionId && retained?.revisionId !== capture.revisionId) throw new LocalLibraryError('invalid-input', 'Unknown reading content revision')
    const supplied = readingCaptureFragments(capture)
    const suppliedSeconds = supplied.reduce((sum, fragment) => sum + fragment.endedAt - fragment.startedAt, 0) / 1000
    if (supplied.length && (suppliedSeconds > 86400 || Math.abs(suppliedSeconds - capture.durationSeconds) >= 1)) throw new LocalLibraryError('invalid-input', 'Reading duration does not match active fragments')
    const prior = await request<ClientReadingSession[]>(sessions.index('vault').getAll(vaultId))
    const acceptedFragments = subtractTimeFragments(supplied, prior.filter((session) => session.id !== existing?.id).flatMap((session) => clientReadingSessionSchema.parse(session).acceptedFragments))
    if (capture.source === 'retroactive' && JSON.stringify(supplied) !== JSON.stringify(acceptedFragments)) throw new LocalLibraryError('conflict', 'Reading interval overlaps existing records')
    const durationSeconds = supplied.length ? acceptedFragments.reduce((sum, fragment) => sum + fragment.endedAt - fragment.startedAt, 0) / 1000 : capture.durationSeconds
    if (!durationSeconds || capture.source === 'auto' && durationSeconds < automaticMinimumSeconds) {
      if (existing) throw new LocalLibraryError('invalid-input', 'Edited reading session has no accepted time')
      await request(receipts.put({ fingerprint, sessionId: null }, receiptKey))
      return null
    }
    const now = Date.now()
    const rounds = await this.ensureReadingRoundsInTx(tx, capture.book)
    const session = clientReadingSessionSchema.parse({ id: existing?.id ?? localRecordId(), ...(groupId || existing?.groupId ? { groupId: groupId ?? existing!.groupId } : {}), roundId: retained?.roundId ?? existing?.roundId ?? (existing ? rounds.rounds[0]!.id : rounds.rounds.at(-1)!.id), capture, acceptedFragments, durationSeconds, version: existing ? existing.version + 1 : 0, createdAt: existing?.createdAt ?? now, updatedAt: now })
    await request(sessions.put(session, noteKey(capture.book, session.id)))
    await request(receipts.put({ fingerprint, sessionId: session.id }, receiptKey))
    await this.advanceReadingVersion(tx, vaultId)
    return session
  }

  async updateReadingLogicalSession(input: ClientReadingSessionCommand, changes: ClientReadingSessionUpdate): Promise<void> {
    const command = clientReadingSessionCommandSchema.parse(input)
    const body = clientReadingSessionUpdateSchema.parse(changes)
    const { book } = command
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint({ ...command, operation: 'update', body })
    const receiptKey = JSON.stringify(['reading-session-command', vaultId, command.requestId])
    const replay = await this.transaction(['books', 'reading-receipts'], 'readonly', async (tx) => {
      await this.requireBook(tx, book)
      const receipt = await request<{ fingerprint: string } | undefined>(tx.objectStore('reading-receipts').get(receiptKey))
      if (receipt && receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading session command identity was already used')
      return Boolean(receipt)
    })
    if (replay) return
    const snapshot = await this.readReadingBookSnapshot(book)
    const view = projectLocalReadingBook(snapshot).sessions.find((session) => session.id === command.id)
    const members = snapshot.ledger.sessions.filter((row) => (row.groupId ?? row.id) === command.id)
    if (!view || members.length !== command.members.length || members.some((row) => !command.members.some((expected) => expected.id === row.id && expected.version === row.version))) throw new LocalLibraryError('conflict', 'Reading session changed in another view')
    if (view.source === 'auto') throw new LocalLibraryError('invalid-input', 'Automatic reading sessions cannot be edited')
    const first = members[0]!.capture
    const timingChanged = body.durationSeconds !== undefined || body.startedAt !== undefined || body.endedAt !== undefined || body.date !== undefined || body.continuous === false || body.timezone !== undefined
    const progressChanged = body.startFraction !== undefined || body.endFraction !== undefined
    const startFraction = body.startFraction === undefined ? view.startFraction : body.startFraction
    const endFraction = body.endFraction === undefined ? view.endFraction : body.endFraction
    const startedAt = body.startedAt === undefined ? view.startedAt : body.startedAt
    const durationSeconds = body.durationSeconds ?? view.durationSeconds
    const fragments = timingChanged ? body.continuous && startedAt !== null ? [{ startedAt, endedAt: startedAt + durationSeconds * 1000 }] : [] : view.fragments
    const source = fragments.length && view.source === 'manual' ? 'manual' as const : 'retroactive' as const
    if (!fragments.length && durationSeconds > 86400) throw new LocalLibraryError('invalid-input', 'Untimed reading entries cannot exceed one day')
    const record = {
      bookId: book.bookId, requestId: command.requestId, source, date: body.date ?? view.date, durationSeconds,
      startedAt: fragments.length ? startedAt : null,
      ...(fragments.length ? { endedAt: fragments.at(-1)!.endedAt, fragments, continuous: false } : {}),
      ...(body.timezone ?? first.timezone ? { timezone: body.timezone ?? first.timezone } : {}),
      ...(first.deviceId ? { deviceId: first.deviceId } : {}),
      ...(first.revisionId ? { revisionId: first.revisionId } : {}),
      ...(view.wordCount !== null ? { wordCount: view.wordCount } : {}),
      ...(progressChanged ? { coverage: startFraction !== null && endFraction !== null ? [[startFraction, endFraction] as [number, number]] : [] } : members.some((row) => row.capture.coverage !== undefined) ? { coverage: view.coverage } : {}),
      ...(startFraction !== null ? { startFraction } : {}), ...(endFraction !== null ? { endFraction } : {}),
      ...(body.startCfi ? { startCfi: body.startCfi } : body.startFraction === undefined && view.startCfi ? { startCfi: view.startCfi } : {}),
      ...(body.endCfi ? { endCfi: body.endCfi } : body.endFraction === undefined && view.endCfi ? { endCfi: view.endCfi } : {}),
      ...(body.startChapterIndex !== undefined ? { startChapterIndex: body.startChapterIndex } : body.startFraction === undefined && view.startChapterIndex != null ? { startChapterIndex: view.startChapterIndex } : {}),
      ...(body.endChapterIndex !== undefined ? { endChapterIndex: body.endChapterIndex } : body.endFraction === undefined && view.endChapterIndex != null ? { endChapterIndex: view.endChapterIndex } : {}),
    }
    const { bookId: _bookId, ...captureFields } = record
    const captures = source === 'manual' ? localTimerCaptureGroup(book, record).captures : [clientReadingCaptureSchema.parse({ ...captureFields, book })]
    const hashes = await Promise.all(captures.map((capture) => readingWriteFingerprint({ capture, expected: null })))
    await this.transaction(['books', 'states', 'settings', 'reading-sessions', 'reading-receipts'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      const receipts = tx.objectStore('reading-receipts')
      const prior = await request<{ fingerprint: string } | undefined>(receipts.get(receiptKey))
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading session command identity was already used')
        return
      }
      const currentRows = (await request<ClientReadingSession[]>(tx.objectStore('reading-sessions').index('vault').getAll(vaultId))).map((row) => clientReadingSessionSchema.parse(row))
      const currentMembers = currentRows.filter((row) => sameClientBook(row.capture.book, book) && (row.groupId ?? row.id) === command.id)
      if (currentMembers.length !== command.members.length || currentMembers.some((row) => !command.members.some((expected) => expected.id === row.id && expected.version === row.version))) throw new LocalLibraryError('conflict', 'Reading session changed in another view')
      if (!Object.values(body).some((value) => value !== undefined)) { await request(receipts.put({ fingerprint }, receiptKey)); return }
      if (timingChanged && fragments.length) {
        const others = currentRows.filter((row) => !currentMembers.some((member) => member.id === row.id)).flatMap((row) => row.acceptedFragments)
        if (JSON.stringify(subtractTimeFragments(fragments, others)) !== JSON.stringify(mergeTimeFragments(fragments))) throw new LocalLibraryError('conflict', 'Corrected reading time overlaps existing records')
      }
      const history = await this.ensureReadingRoundsInTx(tx, book)
      const retained = { roundId: view.roundId ?? history.rounds[0]!.id, revisionId: first.revisionId }
      for (const member of members) await request(tx.objectStore('reading-sessions').delete(noteKey(book, member.id)))
      for (let index = 0; index < captures.length; index++) {
        if (!await this.writeReadingSessionInTx(tx, captures[index]!, hashes[index]!, undefined, 0, command.id, retained)) throw new LocalLibraryError('invalid-input', 'Edited reading session has no accepted time')
      }
      await request(receipts.put({ fingerprint }, receiptKey))
    })
  }

  async clearReadingLedger(input: Omit<ClientReadingLedgerClear, 'scope'>): Promise<void> {
    await this.clearBookArchive({ ...input, scope: 'time' })
  }

  async clearBookArchive(input: ClientReadingLedgerClear): Promise<ArchiveDeleteRes> {
    const command = clientReadingLedgerClearSchema.parse(input)
    const scope = command.scope ?? 'time'
    const { book } = command
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint(command)
    const receiptKey = JSON.stringify(['reading-ledger-clear', vaultId, command.requestId])
    return this.transaction(['books', 'states', 'settings', 'reading-sessions', 'reading-receipts', 'notes', 'reviews', 'deleted', 'files'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      const receipts = tx.objectStore('reading-receipts')
      const receipt = await request<{ fingerprint: string } | undefined>(receipts.get(receiptKey))
      const hasRemaining = async () => {
        const remainingSessions = await request<ClientReadingSession[]>(tx.objectStore('reading-sessions').index('book').getAll([vaultId, book.bookId]))
        const remainingNotes = await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([vaultId, book.bookId]))
        const remainingReview = await request<ClientReview | undefined>(tx.objectStore('reviews').get(key(book)))
        return remainingSessions.length > 0 || remainingNotes.length > 0 || Boolean(remainingReview)
      }
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading clear command identity was already used')
        return { ok: true, remaining: await hasRemaining() }
      }

      if (scope !== 'notes') {
        const snapshot = await this.readingBookSnapshotInTx(tx, book)
        if (snapshot.ledger.version !== command.expectedVersion) throw new LocalLibraryError('conflict', 'Reading history changed in another view')
        const settings = tx.objectStore('settings')
        const lease = await request<ReadingTimerLease | undefined>(settings.get(JSON.stringify(['reading-timer-lease', vaultId])))
        if (lease && lease.expiresAt > Date.now()) throw new LocalLibraryError('pending-reading', 'Stop active reading timers before clearing history')
        const prefixes = ['reading-pending', 'reading-pending-group', 'reading-draft', 'reading-manual'].map((kind) => `${JSON.stringify([kind, vaultId, book.bookId]).slice(0, -1)},`)
        if ((await request(settings.getAllKeys())).some((entry) => typeof entry === 'string' && prefixes.some((prefix) => entry.startsWith(prefix)))) throw new LocalLibraryError('pending-reading', 'Settle pending reading captures before clearing history')
        for (const session of snapshot.ledger.sessions) await request(tx.objectStore('reading-sessions').delete(noteKey(book, session.id)))
        await request(settings.delete(JSON.stringify(['reading-rounds', ...clientBookKey(book)])))
        const preferences = await request<Record<string, unknown> | undefined>(settings.get(key(book)))
        if (preferences) await request(settings.put({ ...preferences, coverageIntervals: [] }, key(book)))
        if (snapshot.state) await request(tx.objectStore('states').put({ ...snapshot.state, coverage: null, version: snapshot.state.version + 1, updatedAt: Date.now() }, key(book)))
        await this.advanceReadingVersion(tx, vaultId)
      }

      if (scope !== 'time') {
        const notesStore = tx.objectStore('notes')
        const deletedStore = tx.objectStore('deleted')
        const filesStore = tx.objectStore('files')
        const storedNotes = await request<ClientNote[]>(notesStore.index('book').getAll([vaultId, book.bookId]))
        for (const note of storedNotes) {
          if (note.kind === 'idea') {
            for (const image of note.images ?? []) {
              await request(filesStore.delete(JSON.stringify(['note-image', ...clientBookKey(book), image.id])))
            }
          }
          await request(notesStore.delete(noteKey(book, note.id)))
          await request(deletedStore.put(true, `note:${noteKey(book, note.id)}`))
        }
        await request(tx.objectStore('reviews').delete(key(book)))
      }

      await request(receipts.put({ fingerprint }, receiptKey))
      return { ok: true, remaining: await hasRemaining() }
    })
  }

  async deleteReadingLogicalSession(input: ClientReadingSessionCommand): Promise<void> {
    const command = clientReadingSessionCommandSchema.parse(input)
    const { book } = command
    this.assertLocal(book)
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint({ ...command, operation: 'delete' })
    const receiptKey = JSON.stringify(['reading-session-command', vaultId, command.requestId])
    await this.transaction(['books', 'reading-sessions', 'reading-receipts', 'settings'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      const receipts = tx.objectStore('reading-receipts')
      const receipt = await request<{ fingerprint: string } | undefined>(receipts.get(receiptKey))
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading session command identity was already used')
        return
      }
      const sessions = tx.objectStore('reading-sessions')
      const members = (await request<ClientReadingSession[]>(sessions.index('book').getAll([vaultId, book.bookId]))).map((row) => clientReadingSessionSchema.parse(row)).filter((row) => (row.groupId ?? row.id) === command.id)
      if (members.length !== command.members.length || members.some((row) => !sameClientBook(row.capture.book, book) || !command.members.some((expected) => expected.id === row.id && expected.version === row.version))) throw new LocalLibraryError('conflict', 'Reading session changed in another view')
      for (const member of members) await request(sessions.delete(noteKey(book, member.id)))
      await request(receipts.put({ fingerprint }, receiptKey))
      await this.advanceReadingVersion(tx, vaultId)
    })
  }

  async deleteReadingSession(book: ClientBookRef, id: string, version: number, requestId: string): Promise<void> {
    this.assertLocal(book)
    if (!requestId || requestId.length > 100) throw new LocalLibraryError('invalid-input', 'Reading request identity is required')
    const vaultId = book.scope.kind === 'local' ? book.scope.vaultId : ''
    const fingerprint = await readingWriteFingerprint({ book: clientBookKey(book), id, version, operation: 'delete' })
    const receiptKey = JSON.stringify(['reading-write', vaultId, requestId])
    await this.transaction(['books', 'states', 'reading-sessions', 'reading-receipts', 'settings'], 'readwrite', async (tx) => {
      await this.requireBook(tx, book)
      const receipts = tx.objectStore('reading-receipts')
      const receipt = await request<{ fingerprint: string } | undefined>(receipts.get(receiptKey))
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new LocalLibraryError('conflict', 'Reading request identity was already used')
        return
      }
      const sessions = tx.objectStore('reading-sessions')
      const existing = await request<ClientReadingSession | undefined>(sessions.get(noteKey(book, id)))
      if (existing && (!sameClientBook(clientReadingSessionSchema.parse(existing).capture.book, book) || existing.id !== id)) throw new LocalLibraryError('storage-unavailable', 'Stored reading session identity is invalid')
      if (!existing || existing.version !== version) throw new LocalLibraryError('conflict', 'Reading session changed in another view')
      await request(sessions.delete(noteKey(book, id)))
      await request(receipts.put({ fingerprint, sessionId: null }, receiptKey))
      await this.advanceReadingVersion(tx, vaultId)
    })
  }

  async patchPreferences(ref: ClientBookRef, patch: Record<string, unknown>): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books', 'settings'], 'readwrite', async (tx) => {
      await this.requireBook(tx, ref)
      const store = tx.objectStore('settings')
      const current = await request<Record<string, unknown> | undefined>(store.get(key(ref))) ?? {}
      const next = { ...current, ...patch }
      if ('viewSettings' in patch) {
        if (patch.viewSettings === null) delete next.viewSettings
        else next.viewSettings = viewSettingsSchema.parse({ ...(current.viewSettings as object | undefined), ...viewSettingsSchema.parse(patch.viewSettings) })
      }
      await request(store.put(next, key(ref)))
    })
  }

  private async trashSettingsInTx(tx: IDBTransaction, vaultId: string): Promise<TrashSettings> {
    return { enabled: true, autoCleanDays: 30, maxTrashBytes: 0, ...settingsUpdateSchema.shape.trash.unwrap().parse(await request(tx.objectStore('settings').get(JSON.stringify(['trash-settings', vaultId]))) ?? {}) }
  }

  async getTrashSettings(vaultId: string): Promise<TrashSettings> {
    return this.transaction(['settings'], 'readonly', (tx) => this.trashSettingsInTx(tx, vaultId))
  }

  async patchTrashSettings(vaultId: string, patch: Partial<TrashSettings>): Promise<void> {
    const parsed = settingsUpdateSchema.shape.trash.unwrap().strict().parse(patch)
    await this.transaction(['books', 'files', 'states', 'notes', 'reviews', 'deleted', 'settings', 'reading-sessions'], 'readwrite', async (tx) => {
      const settingsKey = JSON.stringify(['trash-settings', vaultId])
      const previous = await this.trashSettingsInTx(tx, vaultId)
      const next: TrashSettings = { ...previous, ...parsed }
      await request(tx.objectStore('settings').put(next, settingsKey))
      await this.purgeTrashInTx(tx, vaultId, next, !next.enabled)
    })
  }

  async trashBook(ref: ClientBookRef, deleteUserData = false): Promise<{ version: number } | null> {
    this.assertLocal(ref)
    const vaultId = ref.scope.kind === 'local' ? ref.scope.vaultId : ''
    const result = await this.transaction(['books', 'files', 'states', 'notes', 'reviews', 'deleted', 'settings', 'reading-sessions'], 'readwrite', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.deletedAt != null || book.catalogRemoved) throw new LocalLibraryError('conflict', 'Book is no longer in the active library')
      const settings = await this.trashSettingsInTx(tx, vaultId)
      if (!settings.enabled) { await this.removeBookInTx(tx, ref, deleteUserData, undefined, true); return null }
      await request(tx.objectStore('books').put({ ...book, deletedAt: Date.now(), trashDeleteUserData: deleteUserData, version: book.version + 1 }, key(ref)))
      await this.purgeTrashInTx(tx, vaultId, settings)
      const retained = await request<ClientBook | undefined>(tx.objectStore('books').get(key(ref)))
      return retained?.deletedAt != null ? { version: retained.version } : null
    })
    this.publicationChanged(ref)
    return result
  }

  async restoreBook(ref: ClientBookRef, expectedVersion?: number): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books'], 'readwrite', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.deletedAt == null || expectedVersion !== undefined && book.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Trashed book changed')
      await request(tx.objectStore('books').put({ ...book, deletedAt: null, trashDeleteUserData: false, updatedAt: Date.now(), version: book.version + 1 }, key(ref)))
    })
    this.publicationChanged(ref)
  }

  async restoreSelection(vaultId: string, targets: Array<{ id: string; version: number }>): Promise<void> {
    if (!targets.length || targets.length > 2000 || new Set(targets.map((target) => target.id)).size !== targets.length) throw new LocalLibraryError('invalid-input', 'Invalid trash selection')
    await this.transaction(['books'], 'readwrite', async (tx) => {
      for (const target of targets) {
        const ref = { scope: { kind: 'local' as const, vaultId }, bookId: target.id }
        const book = await this.requireBook(tx, ref)
        if (book.deletedAt == null || book.version !== target.version) throw new LocalLibraryError('conflict', 'Trashed selection changed')
        await request(tx.objectStore('books').put({ ...book, deletedAt: null, trashDeleteUserData: false, updatedAt: Date.now(), version: book.version + 1 }, key(ref)))
      }
    })
    for (const target of targets) this.publicationChanged({ scope: { kind: 'local', vaultId }, bookId: target.id })
  }

  private async purgeTrashInTx(tx: IDBTransaction, vaultId: string, settings: TrashSettings, all = false): Promise<number> {
    const books = (await request<ClientBook[]>(tx.objectStore('books').getAll())).filter((book) => book.ref.scope.kind === 'local' && book.ref.scope.vaultId === vaultId && book.deletedAt != null).sort((left, right) => left.deletedAt! - right.deletedAt! || left.ref.bookId.localeCompare(right.ref.bookId))
    let total = books.reduce((sum, book) => sum + (book.size ?? 0), 0)
    let count = 0
    for (const book of books) {
      const expired = settings.autoCleanDays > 0 && book.deletedAt! < Date.now() - settings.autoCleanDays * 86_400_000
      if (!all && !expired && !((settings.maxTrashBytes ?? 0) > 0 && total > settings.maxTrashBytes!)) continue
      await this.removeBookInTx(tx, book.ref, book.trashDeleteUserData === true, book.version)
      total -= book.size ?? 0
      count++
    }
    return count
  }

  async purgeBook(ref: ClientBookRef, expectedVersion?: number): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books', 'files', 'states', 'notes', 'reviews', 'deleted', 'settings', 'reading-sessions'], 'readwrite', async (tx) => {
      if ((await this.requireBook(tx, ref)).deletedAt == null) throw new LocalLibraryError('conflict', 'Book is no longer in trash')
      await this.removeBookInTx(tx, ref, false, expectedVersion)
    })
    this.publicationChanged(ref)
  }

  async emptyTrash(vaultId: string, all = true): Promise<number> {
    const count = await this.transaction(['books', 'files', 'states', 'notes', 'reviews', 'deleted', 'settings', 'reading-sessions'], 'readwrite', async (tx) => this.purgeTrashInTx(tx, vaultId, await this.trashSettingsInTx(tx, vaultId), all), undefined, false)
    if (count) { this.changes?.postMessage('committed'); if (typeof window !== 'undefined') window.dispatchEvent(new Event('bd-local-library-changed')) }
    return count
  }

  async removeBook(ref: ClientBookRef, complete = false, expectedVersion?: number): Promise<void> {
    this.assertLocal(ref)
    await this.transaction(['books', 'files', 'states', 'notes', 'reviews', 'deleted', 'settings', 'reading-sessions'], 'readwrite', (tx) => this.removeBookInTx(tx, ref, complete, expectedVersion))
    this.publicationChanged(ref)
  }

  private async removeBookInTx(tx: IDBTransaction, ref: ClientBookRef, complete: boolean, expectedVersion?: number, unlist = false): Promise<void> {
  const book = await this.requireBook(tx, ref)
    if (expectedVersion !== undefined && book.version !== expectedVersion) throw new LocalLibraryError('conflict', 'Book changed since trash selection')
    complete ||= book.trashDeleteUserData === true
  await request(tx.objectStore('files').delete(key(ref)))
  await request(tx.objectStore('files').delete(`digest:${key(ref)}`))
  await request(tx.objectStore('files').delete(`publication:${key(ref)}`))
  await request(tx.objectStore('files').delete(`publication-digest:${key(ref)}`))
  await request(tx.objectStore('files').delete(`text:${key(ref)}`))
  for (const format of ['txt', 'epub']) await request(tx.objectStore('settings').delete(JSON.stringify(['editor-draft', ...clientBookKey(ref), format])))
  const draftImagePrefix = JSON.stringify(['note-image', ...clientBookKey(ref)]).slice(0, -1) + ','
  for (const imageKey of await request(tx.objectStore('files').getAllKeys())) {
    if (typeof imageKey !== 'string' || !imageKey.startsWith(draftImagePrefix)) continue
    const row = await request<any>(tx.objectStore('files').get(imageKey))
    if (!row.noteId) await request(tx.objectStore('files').delete(imageKey))
  }
  if (!complete) {
    await request(tx.objectStore('books').put({ ...book, catalogRemoved: unlist || book.deletedAt != null || book.catalogRemoved === true, deletedAt: null, trashDeleteUserData: false, availability: 'removed', version: book.version + 1 }, key(ref)))
    return
  }
  const rulesKey = JSON.stringify(['replacement-rules', ref.scope.kind === 'local' ? ref.scope.vaultId : ''])
  const rules = await request<ClientReplacement[] | undefined>(tx.objectStore('settings').get(rulesKey)) ?? []
  await request(tx.objectStore('settings').put(rules.filter((row) => !row.book || !sameClientBook(row.book, ref)), rulesKey))
  await request(tx.objectStore('settings').delete(JSON.stringify(['replacement-overrides', ref.scope.kind === 'local' ? ref.scope.vaultId : '', ref.bookId])))
  const imagePrefix = JSON.stringify(['note-image', ...clientBookKey(ref)]).slice(0, -1) + ','
  for (const imageKey of await request(tx.objectStore('files').getAllKeys())) if (typeof imageKey === 'string' && imageKey.startsWith(imagePrefix)) await request(tx.objectStore('files').delete(imageKey))
  await request(tx.objectStore('books').delete(key(ref)))
  await request(tx.objectStore('files').delete(`cover:${key(ref)}`))
  await request(tx.objectStore('states').delete(key(ref)))
  await request(tx.objectStore('settings').delete(key(ref)))
  await request(tx.objectStore('settings').delete(JSON.stringify(['reading-rounds', ...clientBookKey(ref)])))
  const vaultId = ref.scope.kind === 'local' ? ref.scope.vaultId : ''
  const capturePrefixes = ['reading-pending', 'reading-pending-group', 'reading-draft', 'reading-manual', 'upload-migration'].map((tag) => `${JSON.stringify([tag, vaultId, ref.bookId]).slice(0, -1)},`)
  for (const entry of await request(tx.objectStore('settings').getAllKeys())) if (typeof entry === 'string' && capturePrefixes.some((prefix) => entry.startsWith(prefix))) await request(tx.objectStore('settings').delete(entry))
  const sessions = await request<ClientReadingSession[]>(tx.objectStore('reading-sessions').index('book').getAll([vaultId, ref.bookId]))
  for (const session of sessions) await request(tx.objectStore('reading-sessions').delete(noteKey(ref, session.id)))
  if (sessions.length) await this.advanceReadingVersion(tx, vaultId)
  for (const note of await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([ref.scope.kind === 'local' ? ref.scope.vaultId : '', ref.bookId]))) await request(tx.objectStore('notes').delete(noteKey(ref, note.id)))
  await request(tx.objectStore('reviews').delete(key(ref)))
  await request(tx.objectStore('deleted').put(true, key(ref)))
  }

  async findDuplicateBookByFile(vaultId: string, file: Blob, signal?: AbortSignal): Promise<ClientBook | null> {
    const digest = await computeBlobSha256(file)
    signal?.throwIfAborted()
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const books = await request<ClientBook[]>(tx.objectStore('books').getAll())
      const files = tx.objectStore('files')
      for (const raw of books) {
        if (raw.ref.scope.kind !== 'local' || raw.ref.scope.vaultId !== vaultId) continue
        const book = clientBookSchema.parse(raw)
        if (book.deletedAt != null || book.catalogRemoved || book.availability !== 'available') continue
        const bookKey = key(book.ref)
        const storedDigest = await request<string | undefined>(files.get(`digest:${bookKey}`))
        if (storedDigest === digest) return book
      }
      return null
    }, signal)
  }

  async getUploadMigrationReceipt(ref: ClientBookRef, accountId: string): Promise<string | null> {
    this.assertLocal(ref)
    const vaultId = ref.scope.kind === 'local' ? ref.scope.vaultId : ''
    const receiptKey = JSON.stringify(['upload-migration', vaultId, ref.bookId, accountId])
    return this.transaction(['settings'], 'readonly', async (tx) => {
      const value = await request<{ requestId?: unknown } | undefined>(tx.objectStore('settings').get(receiptKey))
      return typeof value?.requestId === 'string' && value.requestId ? value.requestId : null
    })
  }

  async setUploadMigrationReceipt(ref: ClientBookRef, accountId: string, requestId: string): Promise<void> {
    this.assertLocal(ref)
    const vaultId = ref.scope.kind === 'local' ? ref.scope.vaultId : ''
    const receiptKey = JSON.stringify(['upload-migration', vaultId, ref.bookId, accountId])
    await this.transaction(['books', 'settings'], 'readwrite', async (tx) => {
      await this.requireBook(tx, ref)
      await request(tx.objectStore('settings').put({ requestId, updatedAt: Date.now() }, receiptKey))
    })
  }

  async exportBookTransferSnapshot(ref: ClientBookRef): Promise<LocalBookTransferSnapshot> {
    this.assertLocal(ref)
    const result = await this.transaction(['books', 'files', 'states', 'notes', 'reviews', 'settings', 'reading-sessions'], 'readonly', async (tx) => {
      const book = await this.requireBook(tx, ref)
      if (book.deletedAt != null || book.availability !== 'available') {
        throw new LocalLibraryError('unavailable-content', 'Local book file is unavailable')
      }
      const vaultId = ref.scope.kind === 'local' ? ref.scope.vaultId : ''
      const settingsStore = tx.objectStore('settings')
      const lease = await request<ReadingTimerLease | undefined>(settingsStore.get(JSON.stringify(['reading-timer-lease', vaultId])))
      if (lease && lease.expiresAt > Date.now()) {
        throw new LocalLibraryError('pending-reading', 'Stop active reading timers before uploading this book')
      }
      const pendingPrefixes = ['reading-pending', 'reading-pending-group', 'reading-draft', 'reading-manual']
        .map((kind) => `${JSON.stringify([kind, vaultId, ref.bookId]).slice(0, -1)},`)
      if ((await request(settingsStore.getAllKeys())).some((entry) => typeof entry === 'string' && pendingPrefixes.some((prefix) => entry.startsWith(prefix)))) {
        throw new LocalLibraryError('pending-reading', 'Settle pending reading captures before uploading this book')
      }

      const filesStore = tx.objectStore('files')
      const file = await request<Blob | undefined>(filesStore.get(key(ref)))
      if (!file) throw new LocalLibraryError('unavailable-content', 'Local book file is unavailable')
      const storedDigest = await request<string | undefined>(filesStore.get(`digest:${key(ref)}`))
      const cover = await request<Blob | undefined>(filesStore.get(`cover:${key(ref)}`)) ?? null
      const snapshot = await this.readingBookSnapshotInTx(tx, ref)
      const notes = (await request<ClientNote[]>(tx.objectStore('notes').index('book').getAll([vaultId, ref.bookId])))
        .map((note) => clientNoteSchema.parse(note))
      const noteImages = new Map<string, Blob>()
      for (const note of notes) {
        if (note.kind !== 'idea' || !note.images?.length) continue
        for (const image of note.images) {
          const row = await request<{ blob?: Blob } | undefined>(filesStore.get(JSON.stringify(['note-image', ...clientBookKey(ref), image.id])))
          if (row?.blob) noteImages.set(image.id, row.blob)
        }
      }
      const rawReview = await request<ClientReview | undefined>(tx.objectStore('reviews').get(key(ref)))
      const review = rawReview ? clientReviewSchema.parse(rawReview) : null
      const preferences = await request<Record<string, unknown> | undefined>(settingsStore.get(key(ref))) ?? {}
      const coverageIntervals = clientReadingCoverageIntervalsSchema.parse(preferences.coverageIntervals ?? [])
      const allRules = await request<ClientReplacement[] | undefined>(settingsStore.get(JSON.stringify(['replacement-rules', vaultId]))) ?? []
      const pointRules = allRules
        .map((row) => clientReplacementSchema.parse(row))
        .filter((row) => row.book && sameClientBook(row.book, ref) && row.rule.matchType === 'point')
      const replacementOverrides = await request<Record<string, boolean> | undefined>(
        settingsStore.get(JSON.stringify(['replacement-overrides', vaultId, ref.bookId])),
      ) ?? {}

      return {
        book,
        file,
        storedDigest,
        cover,
        state: snapshot.state,
        notes,
        noteImages,
        review,
        rounds: snapshot.rounds.rounds,
        sessions: snapshot.ledger.sessions,
        coverageIntervals,
        preferences,
        pointRules,
        replacementOverrides,
      }
    })
    const fileSha256 = result.storedDigest ?? await computeBlobSha256(result.file)
    return {
      book: result.book,
      file: result.file,
      fileSha256,
      cover: result.cover,
      state: result.state,
      notes: result.notes,
      noteImages: result.noteImages,
      review: result.review,
      rounds: result.rounds,
      sessions: result.sessions,
      coverageIntervals: result.coverageIntervals,
      preferences: result.preferences,
      pointRules: result.pointRules,
      replacementOverrides: result.replacementOverrides,
    }
  }

  async inspectStorage(vaultId: string): Promise<DeviceStorageSummary> {
    const vaultStats = await this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const books = await request<ClientBook[]>(tx.objectStore('books').getAll())
      let activeBooks = 0
      for (const raw of books) {
        if (raw.ref.scope.kind !== 'local' || raw.ref.scope.vaultId !== vaultId) continue
        const book = clientBookSchema.parse(raw)
        if (!book.catalogRemoved && book.deletedAt == null) activeBooks++
      }
      let totalBytes = 0
      await new Promise<void>((resolve, reject) => {
        const cursorReq = tx.objectStore('files').openCursor()
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor) { resolve(); return }
          if (isFileInVault(cursor.key, vaultId)) totalBytes += storedBlobSize(cursor.value)
          cursor.continue()
        }
        cursorReq.onerror = () => reject(cursorReq.error)
      })
      return { activeBooks, totalBytes }
    })

    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
    let browserUsage: number | null = null
    if (storage?.estimate) {
      try {
        const estimate = await storage.estimate()
        browserUsage = estimate?.usage ?? null
      } catch {
        // Capacity estimates are optional.
      }
    }
    return { ...vaultStats, browserUsage }
  }

  async close(): Promise<void> {
    const db = await this.opening?.catch(() => undefined)
    db?.close()
    this.changes?.close()
    this.changes = undefined
    this.opening = undefined
  }
}

export const localLibraryRepository = new LocalLibraryRepository()
