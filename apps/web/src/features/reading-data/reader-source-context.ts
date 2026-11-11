import { createContext, useContext } from 'react'
import type { AiMessageRes, AiThreadDetailRes, AiThreadRes, AiThreadSettings, AiThreadUpdateReq, ClientArchiveBookDetailView, AnnotationCreateReq, AnnotationRes, AnnotationUpdateReq, ReadingRecordCreateReq, ClientReadingSessionUpdate, ReadingLedgerOverview, ReadingLedgerStatsRes, ReadingLedgerSessionPage, ReadingLedgerSession, ReadingRecordBookDetailRes, ReadingRange, ClientReadingRounds, ClientReadingRoundAction, ClientLibraryDetailView, ClientPublicationStructure, ReaderBookSettings, ReadingProgressRes, ReadingProgressUpdateReq, ViewSettings } from '@bookdock/shared'
import type { ReaderBookProvider } from '../reader/content/book-provider'
import type { ClientBookRef, ClientPreferenceOwner } from '@bookdock/shared'

export interface LocalAiTurnInput {
  threadId?: string
  title?: string
  settings: AiThreadSettings
  replaceMessageCount?: number
  userMessage: Omit<AiMessageRes, 'threadId'>
  assistantMessage: Omit<AiMessageRes, 'threadId'>
}

// Existing reader presentation DTOs stay at the Web adapter boundary.
export interface LocalReaderSession {
  readonly content?: import('@bookdock/shared').ClientContentRef
  readonly ref: ClientBookRef
  readonly bookId: string
  readonly namespace: string
  readonly sourceAvailable: boolean
  readonly provider: ReaderBookProvider
  getBook(): Promise<{ data: ClientLibraryDetailView }>
  getStructure(signal: AbortSignal): Promise<ClientPublicationStructure>
  getReadingLedger(): Promise<{ data: ReadingLedgerOverview }>
  getReadingStats(range?: ReadingRange): Promise<{ data: ReadingLedgerStatsRes }>
  getReadingSessions(range?: ReadingRange, cursor?: string): Promise<{ data: ReadingLedgerSessionPage }>
  getReadingRecords(range?: ReadingRange): Promise<{ data: ReadingRecordBookDetailRes }>
  updateReadingSession(id: string, members: NonNullable<ReadingLedgerSession['clientMembers']>, body: ClientReadingSessionUpdate): Promise<void>
  deleteReadingSession(id: string, members: NonNullable<ReadingLedgerSession['clientMembers']>): Promise<void>
  addReadingRecord(body: ReadingRecordCreateReq): Promise<void>
  changeReadingRound(action: ClientReadingRoundAction): Promise<ClientReadingRounds>
  getProgress(): Promise<{ data: ReadingProgressRes | null }>
  saveProgress(body: ReadingProgressUpdateReq): Promise<{ data: ReadingProgressRes | null }>
  captureCoverage(from: number, to: number): void
  getArchiveNotes(range?: ReadingRange): Promise<{ data: ClientArchiveBookDetailView }>
  deleteNotes(notes: Array<Pick<AnnotationRes, 'id' | 'clientVersion'>>): Promise<void>
  listNotes(): Promise<{ data: AnnotationRes[] }>
  createNote(body: AnnotationCreateReq, commandId?: string): Promise<{ data: AnnotationRes }>
  updateNote(id: string, body: AnnotationUpdateReq, expectedVersion?: number): Promise<{ data: AnnotationRes }>
  deleteNote(id: string, expectedVersion?: number): Promise<void>
  saveSettings(settings: ViewSettings | null): Promise<{ data: ReaderBookSettings }>
  bindPreset(presetId: string | null, owner: ClientPreferenceOwner): Promise<void>
  listAiThreads(): Promise<{ data: AiThreadRes[] }>
  getAiThread(threadId: string): Promise<{ data: AiThreadDetailRes }>
  saveAiThreadTurn(input: LocalAiTurnInput): Promise<{ data: AiThreadDetailRes }>
  updateAiThread(threadId: string, body: AiThreadUpdateReq): Promise<{ data: AiThreadRes }>
  deleteAiThread(threadId: string): Promise<void>
}

export const LocalReaderContext = createContext<LocalReaderSession | null>(null)
export const useLocalReader = () => useContext(LocalReaderContext)
