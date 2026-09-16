import type { AiReadingScope, AiToolName, BookFormat, ReadStatus } from './constants'
import type { ErrorCode } from './errors'
import type { AnnotationStyle, AnnotationType, TocRulePattern, ReplacementMatchType, ReplacementScope, ViewSettings } from './domain'

export interface ApiResponse<T> {
  data: T
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

export interface PaginatedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export interface HealthCheckRes {
  ok: true
}

export interface LoginReq {
  username: string
  password: string
}

export interface LoginRes {
  token: string
  user: {
    id: string
    username: string
    role: string
  }
}

export interface SetupReq {
  username: string
  password: string
}

export interface SetupRes {
  token: string
  user: {
    id: string
    username: string
    role: string
  }
}

export interface SetupRequiredRes {
  required: boolean
}

export interface MeRes {
  id: string
  username: string
  role: string
  /** Content-hash addressed avatar blob key; the client builds the file URL as `/api/v1/avatars/<avatarKey>` */
  avatarKey: string | null
  /** True when the server injected the default user for guest access (no real session). */
  guest?: boolean
}

export interface UpdateUsernameReq {
  username: string
}

/** Account-mutation responses (username change, avatar upload): the fresh self profile */
export interface AccountRes {
  id: string
  username: string
  role: string
  avatarKey: string | null
}

export interface InstanceInfoRes {
  initialized: boolean
  allowRegistration: boolean
  allowGuestAccess: boolean
}

export interface UpdateInstanceReq {
  allowRegistration?: boolean
  allowGuestAccess?: boolean
}

export interface RegisterReq {
  username: string
  password: string
}

export interface RegisterRes {
  token: string
  user: {
    id: string
    username: string
    role: string
  }
}

export interface ChangePasswordReq {
  oldPassword: string
  newPassword: string
}

export interface AdminUserRes {
  id: string
  username: string
  role: 'owner' | 'member' | 'guest'
  disabled: boolean
  createdAt: number
  bookCount: number
}

export interface UpdateUserReq {
  role?: 'owner' | 'member'
  disabled?: boolean
  newPassword?: string
}

export interface TrashSettings {
  /** Days a trashed book is kept before auto-purge; 0 disables auto-clean */
  autoCleanDays: 0 | 7 | 30
}

export interface SettingsRes {
  uiTheme?: 'system' | 'light' | 'dark'
  readingThemeId?: 'paper' | 'sepia' | 'night' | 'cream'
  lightReadingThemeId?: 'paper' | 'sepia' | 'night' | 'cream'
  /** Open font id (system stack / builtin CDN / uploaded font id), resolved client-side */
  fontFamily?: string
  /** Per-user font visibility and display-name overrides, keyed by stable font id. */
  fontPreferences?: FontPreferences
  /** Per-user display order of stable system, builtin, and uploaded font ids. */
  fontOrder?: string[]
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  paragraphSpacing?: number
  letterSpacing?: number
  indent?: number
  pageWidth?: number
  verticalPadding?: number
  horizontalPadding?: number
  // Per-mode backing values for the three layout settings above; the flat
  // fields mirror whichever readingMode is active.
  scrollPageWidth?: number
  scrollHorizontalPadding?: number
  scrollVerticalPadding?: number
  pagePageWidth?: number
  pageHorizontalPadding?: number
  pageVerticalPadding?: number
  textAlignJustify?: boolean
  overrideBookFont?: boolean
  overrideBookLayout?: boolean
  coverText?: boolean
  coverFit?: 'crop' | 'full'
  gridColumns?: string
  toolbarLocked?: boolean
  sidebarWidth?: number
  readingMode?: 'scroll' | 'page'
  pageColumns?: number
  columnGap?: number
  showHeader?: boolean
  showFooter?: boolean
  chineseConversion?: 'off' | 'simplified' | 'traditional'
  showWordCount?: boolean
  continuousScroll?: 'off' | 'snap' | 'seamless'
  pageAnimation?: boolean
  /** Reading-time accounting: automatic heuristics, manual timer pill, or off (no reading data) */
  readingTimerMode?: 'auto' | 'manual' | 'off'
  manualTimerGraceMinutes?: 1 | 5 | 10 | 30
  ttsEngine?: 'system' | 'edge' | 'service'
  ttsServiceId?: string | null
  ttsVoiceId?: string
  ttsRate?: number
  ttsAutoNext?: boolean
  ttsFollow?: boolean
  trash?: TrashSettings
  /**
   * Named reading-setting profiles (global config + presets + active pointer),
   * serialized as JSON by the web client and passed through by the server.
   */
  readingConfig?: string
  /**
   * User-created reading themes, serialized as JSON by the web client.
   * Synced because reading configs reference custom themes by id.
   */
  customThemes?: string
}

export type TtsEngine = 'system' | 'edge' | 'service'
export type TtsProvider = 'openai' | 'azure' | 'aliyun' | 'dashscope' | 'minimax' | 'mimo' | 'volcengine' | 'openai-compatible'

export interface TtsProviderRes {
  id: TtsProvider
  kind: 'native' | 'openai-compatible'
  defaultBaseUrl: string | null
  defaultModel: string | null
}

export interface TtsServiceRes {
  id: string
  name: string
  provider: TtsProvider
  baseUrl: string | null
  model: string | null
  defaultVoice: string | null
  options: Record<string, string | number | boolean>
  credentialsConfigured: boolean
  createdAt: number
  updatedAt: number
}

export interface TtsServiceCreateReq {
  name: string
  provider: TtsProvider
  baseUrl?: string | null
  model?: string | null
  defaultVoice?: string | null
  options?: Record<string, string | number | boolean>
  secrets?: Record<string, string>
}

export interface TtsServiceUpdateReq {
  name?: string
  provider?: TtsProvider
  baseUrl?: string | null
  model?: string | null
  defaultVoice?: string | null
  options?: Record<string, string | number | boolean>
  /** Empty/missing preserves existing secrets; null clears one secret. */
  secrets?: Record<string, string | null>
}

export interface TtsVoiceRes {
  id: string
  name: string
  lang: string
  gender?: string
  description?: string
}

export interface TtsSpeechReq {
  serviceId: string
  text: string
  voice?: string
  rate?: number
}

export interface TtsEdgeSpeechReq {
  text: string
  voice?: string
  rate?: number
}

export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'moonshot'
   | 'openrouter'
   | 'siliconflow'
   | 'minimax'
   | 'mimo'

export type AiProtocol = 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama'

export interface AiProviderRes {
  id: AiProvider
  name: string
  protocol: AiProtocol
  defaultBaseUrl: string | null
  defaultModel: string | null
  requiresApiKey: boolean
}

export interface AiModelCapabilities {
  vision?: boolean
  tools?: boolean
  reasoning?: boolean
  embedding?: boolean
}

export interface AiModelRes {
  id: string
  name: string
  ownedBy?: string
  capabilities?: AiModelCapabilities
}

export type AiModelKind = 'chat' | 'embedding'

export type AiPromptScope = 'selection' | 'reading' | 'both'

export interface AiPromptTemplate {
  id: string
  name: string
  prompt: string
  scope: AiPromptScope
  enabled: boolean
  order: number
  builtIn: boolean
}

export interface AiPromptTemplateInput {
  id: string
  name: string
  prompt: string
  scope?: AiPromptScope
  enabled?: boolean
  order?: number
}

export interface AiAssistantMode {
  id: string
  name: string
  prompt: string
  builtIn: boolean
}

export interface AiAssistantModeInput {
  id: string
  name: string
  prompt: string
}

export interface AiModelDiscoveryReq {
  /** Existing profile whose saved secret may be reused; omitted for new drafts. */
  profileId?: string | null
  provider: AiProvider
  baseUrl?: string | null
  kind?: AiModelKind
  apiKey?: string | null
}

export interface AiConfigTestReq {
  /** Existing profile whose saved secret may be reused; omitted for new drafts. */
  profileId?: string | null
  provider: AiProvider
  baseUrl?: string | null
  kind?: AiModelKind
  model: string
  apiKey?: string | null
}

export interface AiConnectionTestRes {
  ok: true
  provider: AiProvider
  model: string
  latencyMs: number
}

export interface AiProfileRes {
  id: string
  name: string
  provider: AiProvider
  baseUrl: string | null
  model: string | null
  models: AiModelRes[]
  embeddingModel: string | null
  embeddingModels: AiModelRes[]
  apiKeyConfigured: boolean
  createdAt: number
  updatedAt: number
}

export interface AiProfileCreateReq {
  name: string
  provider: AiProvider
  baseUrl?: string | null
  model?: string | null
  models?: AiModelRes[]
  embeddingModel?: string | null
  embeddingModels?: AiModelRes[]
  /** Credentials are accepted only for this request and never returned. */
  apiKey?: string | null
}

export interface AiProfileUpdateReq {
  name?: string
  provider?: AiProvider
  baseUrl?: string | null
  model?: string | null
  models?: AiModelRes[]
  embeddingModel?: string | null
  embeddingModels?: AiModelRes[]
  /** Missing preserves the saved key; null clears it. */
  apiKey?: string | null
}

export interface AiContextReq {
  chapterIndex: number
  chapterTitle?: string
  cfiRange: string
  selection: string
  before?: string
  /** Reader-visible paragraph containing the selection or current reading position. */
  paragraph?: string
  /** Reader transformation fingerprint used to keep book tools on visible text. */
  visibleTextVersion?: string
  /** Explicit Reader-visible chapter text attached by the user to this request. */
  chapterReferences?: AiChapterReference[]
}

export interface AiChapterReference {
  chapterIndex: number
  chapterTitle?: string
  text: string
}

export interface AiHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  /** Original reader context attached to a user turn, preserved for later turns. */
  context?: AiContextReq
}

export interface AiChatReq {
  bookId: string
  /** Existing persisted conversation; omitted to create one on first send. */
  threadId?: string
  /** Replaces the latest matching user/assistant turn when retrying a response. */
  regenerate?: boolean
  /** Replaces the latest user turn with this new prompt before regenerating. */
  editMessageId?: string
  prompt: string
  context: AiContextReq
  history?: AiHistoryMessage[]
  /** Optional prompt supplied by the selected assistant mode; the server always adds its invariant core system prompt. */
  assistantModePrompt?: string
  /** User-visible assistant mode label stored in the request receipt. */
  assistantMode?: string
  /** Selected assistant mode id used to snapshot a new or updated thread. */
  assistantModeId?: string
  /** Chapter-level spoiler boundary; omitted to use the thread default. */
  readingScope?: AiReadingScope
  /** Optional per-request allowlist for the server's bounded read-only tools. */
  enabledTools?: AiToolName[]
}

export interface AiRetryRecipe {
  /** The bounded context and selected mode prompt needed to issue the same request again. */
  context: AiChatReq['context']
  readingScope: AiReadingScope
  enabledTools: AiToolName[]
  assistantMode?: string
  assistantModeId?: string
  assistantModePrompt?: string
}

export type AiGenerationState = 'preparing' | 'requesting' | 'streaming' | 'waiting_tool' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export type AiGenerationTerminalReason = 'user_cancelled' | 'client_disconnected' | 'stream_disconnected' | 'server_restarted' | 'provider_aborted' | 'timeout' | 'provider_error' | 'persistence_error'

export interface AiToolEvent {
  type: 'tool'
  name: string
  phase: 'start' | 'result'
  chapterIndex?: number
  resultChars?: number
}

export interface AiCitationEvent {
  type: 'citation'
  citationId: string
}

export type AiNormalizedEvent = AiToolEvent | AiCitationEvent
export type AiGenerationEvent = AiNormalizedEvent

export interface AiGenerationUsage {
  inputTokens?: number
  outputTokens?: number
}

export type AiRetrievalSource = 'fts' | 'like' | 'hybrid' | 'none'
export type AiRetrievalCandidateSource = 'lexical' | 'semantic' | 'hybrid'
export type AiRetrievalFallbackReason = 'not_configured' | 'not_ready' | 'provider_mismatch' | 'timeout' | 'error' | 'invalid_response'

export interface AiRetrievalTopResult {
  id: string
  source: AiRetrievalCandidateSource
  score: number
  lexicalRank?: number
  semanticRank?: number
}

export interface AiRetrievalDiagnostics {
  source: AiRetrievalSource
  lexicalCandidateCount: number
  semanticCandidateCount: number
  fusedCandidateCount: number
  selectedCount: number
  embeddingAttempted: boolean
  embeddingUsed: boolean
  embeddingFallbackReason?: AiRetrievalFallbackReason
  topResults: AiRetrievalTopResult[]
}

export interface AiGenerationDiagnostics {
  provider: AiProvider
  model?: string
  providerRequestCount: number
  timeToFirstTokenMs?: number
  totalDurationMs?: number
  contextChars?: number
  sentMessageChars?: number
  droppedHistoryChars?: number
  toolSteps: number
  toolCalls: number
  toolResultChars: number
  retrievalQueries: number
  retrievalLexicalCandidates: number
  retrievalSemanticCandidates: number
  retrievalSelectedResults: number
  retrievalFallbacks: number
  outputChars: number
}

export interface AiGenerationRunRes {
  id: string
  requestId: string
  threadId: string
  targetMessageId: string | null
  state: AiGenerationState
  stateRevision: number
  checkpointSeq: number
  checkpointText: string
  checkpointEvents: AiNormalizedEvent[]
  checkpointUsage: AiGenerationUsage | null
  diagnostics: AiGenerationDiagnostics | null
  errorCode: ErrorCode | null
  reason: AiGenerationTerminalReason | null
  createdAt: number
  updatedAt: number
  terminalAt: number | null
}

export interface AiMessageEventRes {
  id: string
  sequence: number
  event: AiNormalizedEvent
  createdAt: number
}

export interface AiCitation {
  id: string
  chapterIndex: number
  chapterId: string
  chapterTitle: string
  startOffset: number
  endOffset: number
  excerpt: string
  sourceType?: 'book' | 'annotation'
  sourceCfi?: string
}

export interface AiMessageRes {
  id: string
  threadId: string
  role: 'user' | 'assistant'
  revisionGroupId: string | null
  revision: number
  content: string
  context: AiContextReceipt | null
  retry: AiRetryRecipe | null
  citations: AiCitation[]
  events: AiMessageEventRes[]
  createdAt: number
  aborted: boolean
}

export interface AiMessageRevisionRes {
  id: string
  revisionGroupId: string
  revision: number
  content: string
  citations: AiCitation[]
  events: AiMessageEventRes[]
  createdAt: number
  aborted: boolean
  selected: boolean
}

export interface AiThreadRes {
  id: string
  bookId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  settings: AiThreadSettings
}

export interface AiThreadDetailRes extends AiThreadRes {
  messages: AiMessageRes[]
  generation: AiGenerationRunRes | null
}

export interface AiThreadCreateReq {
  bookId: string
  title?: string
  settings?: AiThreadSettings
}

export interface AiThreadUpdateReq {
  title?: string
  settings?: AiThreadSettings
}

export interface AiThreadSettings {
  readingScope: AiReadingScope
  enabledTools: AiToolName[]
  /** Optional when the built-in assistant mode is selected. */
  assistantModeId?: string
}

export interface AiConversationSettings {
  readingScope: AiReadingScope
  enabledTools: AiToolName[]
  assistantModeId: string
}

export interface AiThreadListReq {
  bookId: string
  limit?: number
}

export type AiIndexStatus = 'not_indexed' | 'indexing' | 'ready' | 'failed' | 'stale'

export type AiEmbeddingStatus = 'not_indexed' | 'indexing' | 'ready' | 'failed' | 'unavailable'

export interface AiIndexChapter {
  /** Server chapter position; text is produced by the visible Reader pipeline. */
  chapterIndex: number
  text: string
}

export interface AiIndexReq {
  bookId: string
  force?: boolean
  /** Reader transformation fingerprint; omitted by server-only source fallback. */
  visibleTextVersion?: string
  /** Complete transformed corpus for an explicit Reader-triggered build. */
  chapters?: AiIndexChapter[]
}

export interface AiIndexRes {
  bookId: string
  /** Opaque source fingerprint used to decide whether a derived index is stale. */
  sourceVersion?: string
  status: AiIndexStatus
  embeddingStatus: AiEmbeddingStatus
  embeddingProvider?: AiProvider
  embeddingModel?: string
  embeddingDim?: number
  /** Current user-visible build progress, from 0 to 100. */
  progress: number
  chunkCount: number
  updatedAt: number | null
  error?: string
}

export interface AiSearchReq {
  bookId: string
  query: string
  limit?: number
  minChapterIndex?: number
  maxChapterIndex?: number
}

export interface AiSearchResultRes extends AiCitation {
  score: number
}

export interface AiSearchRes {
  status: 'ready' | 'empty'
  results: AiSearchResultRes[]
  reason?: 'visible_index_unavailable'
  diagnostics?: AiRetrievalDiagnostics
}

export interface AiStatusRes {
  enabled: boolean
  provider: AiProvider
  model?: string
  models: AiModelRes[]
  prompts: AiPromptTemplate[]
  modes: AiAssistantMode[]
  lastUsedConversationSettings: AiConversationSettings
  embeddingProfileId: string | null
  embeddingProvider: AiProvider | null
  embeddingModel: string | null
  embeddingModels: AiModelRes[]
  embeddingConfigured: boolean
  activeProfileId: string | null
}

export interface AiConfigRes {
  activeProfileId: string | null
  profiles: AiProfileRes[]
  provider: AiProvider
  baseUrl: string | null
  model: string | null
  models: AiModelRes[]
  prompts: AiPromptTemplate[]
  modes: AiAssistantMode[]
  lastUsedConversationSettings: AiConversationSettings
  embeddingProfileId: string | null
  embeddingProvider: AiProvider | null
  embeddingModel: string | null
  embeddingModels: AiModelRes[]
  embeddingConfigured: boolean
  apiKeyConfigured: boolean
  configuredByUser: boolean
}

export interface AiConfigUpdateReq {
  /** Switches the active profile without changing its fields. */
  activeProfileId?: string | null
  /** Explicitly selects the profile used by the selected embedding model; null disables semantic retrieval. */
  embeddingProfileId?: string | null
  /** Explicitly selects an embedding model from that profile; null disables semantic retrieval. */
  embeddingModel?: string | null
  /** Replaces the user's bounded quick-prompt template list; null restores defaults. */
  prompts?: AiPromptTemplateInput[] | null
  /** Replaces the bounded user-authored assistant mode list; null clears custom modes. */
  modes?: AiAssistantModeInput[] | null
  /** Updates the built-in assistant mode; null restores its default name and prompt. */
  defaultAssistantMode?: AiAssistantModeInput | null
  /** Updates the user-level snapshot copied into newly created AI threads. */
  lastUsedConversationSettings?: AiConversationSettings
}

export type AiContextTruncationReason = 'history' | 'tool_results'

export interface AiContextPlan {
  maxChars: number
  modeChars: number
  coreSystemChars: number
  systemChars: number
  currentRequestChars: number
  directContextChars: number
  historyBudgetChars: number
  historyChars: number
  historyMessageCount: number
  droppedHistoryChars: number
  droppedHistoryMessageCount: number
  toolResultChars: number
  toolResultTrimmedChars: number
  providerInputChars: number
  historyTurnCount: number
  droppedHistoryTurnCount: number
  truncationReasons: AiContextTruncationReason[]
  sentMessageChars: number
  historyTruncated: boolean
  readingBoundary?: { minChapterIndex: number; maxChapterIndex: number; readingScope: AiReadingScope }
  visibleTextVersion?: string
}

export interface AiContextReceipt {
  /** Character count of the current user question. */
  questionChars?: number
  selectionChars: number
  beforeChars: number
  /** Character count of the direct Reader-visible paragraph context. */
  paragraphChars?: number
  /** Character count of chapter text returned by a read tool. */
  chapterChars?: number
  /** Character count of explicitly attached chapter context. */
  directChapterChars?: number
  /** Metadata for explicitly attached chapter context; chapter text is never persisted. */
  directChapterReferences?: Array<{ chapterIndex: number; chapterTitle?: string }>
  /** Character count of book-search results returned by a retrieval tool. */
  ragChars?: number
  /** Character count of note-search results returned by a retrieval tool. */
  notesChars?: number
  /** Direct context plus bounded tool results; excludes the question itself. */
  contextChars: number
  chapterTitle: string | null
  sourceCfi: string
  /** Effective chapter-level reading boundary used for this request. */
  readingScope?: AiReadingScope
  /** Effective fixed read-only tools exposed to the provider. */
  enabledTools?: AiToolName[]
  /** Provider model used for this request; never contains credentials or endpoints. */
  model?: string
  /** User-visible mode identifier or bounded mode label, not the hidden system prompt. */
  assistantMode?: string
  /** Bounded diagnostics describing how the provider context was assembled. */
  contextPlan?: AiContextPlan
}

export interface SettingsUpdateReq {
  settings: SettingsRes
}

export type FontScope = 'user' | 'instance'

export interface FontPreference {
  enabled?: boolean
  displayName?: string
}

export type FontPreferences = Record<string, FontPreference>

export interface FontListItem {
  id: string
  /** Family name parsed from the sfnt name table, falling back to the file name */
  family: string
  fileName: string
  format: 'ttf' | 'otf' | 'woff' | 'woff2'
  size: number
  scope: FontScope
  /** True when the requesting user uploaded this font */
  mine: boolean
  createdAt: number
}

export interface ShelfListItem {
  id: string
  userId: string
  name: string
  sortOrder: number
  createdAt: number
  bookCount: number
}

export interface ShelfCreateReq {
  name: string
}

export interface ShelfUpdateReq {
  name: string
}

/** Full ordered shelf id list; the server rewrites each shelf's sortOrder to its index. */
export interface ShelfReorderReq {
  shelfIds: string[]
}

export interface TagListItem {
  id: string
  userId: string
  name: string
  sortOrder: number
  bookCount: number
}

export interface TagCreateReq {
  name: string
}

export interface TagUpdateReq {
  name: string
}

/** Full ordered tag id list; the server rewrites each tag's sortOrder to its index. */
export interface TagReorderReq {
  tagIds: string[]
}

export interface BookMembershipReq {
  /** Single-shelf membership: string = move into shelf, null = remove from shelf, absent = unchanged */
  shelfId?: string | null
  tagIds?: string[]
}

export interface BookListItem {
  id: string
  title: string
  author: string
  format: BookFormat
  coverKey: string | null
  size: number
  readStatus: ReadStatus
  progress: number | null
  pinnedAt?: number | null
  lastReadAt?: number | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  /** Single-shelf membership; null = uncategorized. Drives drag-to-shelf no-op checks. */
  shelfId: string | null
  /** Resolved shelf name (null when uncategorized); list view info line only */
  shelfName?: string | null
  /** Tag names attached to the book; list view info line only */
  tags?: string[]
}

export interface BookContributor {
  name: string
  role?: string
  sortAs?: string
}

export interface BookSubject {
  name: string
  term?: string
  authority?: string
}

export interface BookMetadata {
  publisher?: string
  published?: string
  modified?: string
  isbn?: string
  identifier?: string
  language?: string
  languages?: string[]
  subtitle?: string
  sortAs?: string
  authorSortAs?: string
  rights?: string
  source?: string
  subjects?: string[]
  subjectDetails?: BookSubject[]
  contributors?: BookContributor[]
  description?: string
  series?: string
  seriesIndex?: number
}

export interface BookMeta {
  chapters?: Chapter[]
  bookmeta?: BookMetadata
  /** Total word count of the book (sum of chapter word counts) */
  wordCount?: number
  /** Per-book reading-setting overrides (F1), see ViewSettings */
  viewSettings?: ViewSettings
  /** Reading preset bound to this book (reading-profile id); a dangling id
   * (preset deleted) falls back to the device resolution chain */
  boundPresetId?: string
  /** TOC rule pinned to this book (id); dangling id falls back to auto-scoring
   * then the built-in default patterns. `tocRuleAuto` records that the pin was
   * chosen by auto-scoring, not by the user. */
  tocRuleId?: string
  tocRuleAuto?: boolean
  /** Book-specific TOC patterns when not using a global preset */
  customTocPatterns?: TocRulePattern[]
  /** Detected chapter boundaries suppressed for this book only */
  tocExcludedChapterIds?: string[]
  /** Internal source-order preservation for a suppressed synthetic preface */
  tocExcludedLeadingText?: string
}

export interface BookDetailRes extends BookListItem {
  filePath: string
  meta: BookMeta
}

export interface Chapter {
  id: string
  title: string
  level: number
  startOffset: number
  endOffset: number
  contentStartOffset?: number
  contentRanges?: Array<{ startOffset: number; endOffset: number }>
  wordCount?: number
}

export interface ChapterListRes {
  data: Chapter[]
}

export interface UploadBookRes {
  id: string
  title: string
  format: BookFormat
  size: number
}

/** POST /books response: `duplicated` is true when the upload hit content-hash dedup
 * and the existing book row was returned instead of creating a new one. */
export interface BookUploadRes {
  data: BookListItem
  duplicated: boolean
}

/** A reading-speed sample: book-wide position at a wall-clock time (unix ms) */
export interface RateSample {
  fraction: number
  at: number
}

export interface ReadingProgressUpdateReq {
  cfi?: string
  chapter?: string
  /** Zero-based chapter position from the current book TOC, when known */
  chapterIndex?: number
  percent: number
  /** Book-wide position 0-1 reported by the reader engine */
  fraction?: number
  /** Start fraction of the current uninterrupted reading segment */
  segmentStartFraction?: number
  /** Speed sample from a continuous reading stretch (client-side filtered) */
  sample?: RateSample
}

export interface ReadingProgressRes {
  id: string
  bookId: string
  cfi: string | null
  chapter: string | null
  /** Zero-based chapter position from the current book TOC. */
  chapterIndex?: number | null
  percent: number
  fraction?: number | null
  /** Total union length of read intervals, 0-1. */
  readFraction: number
  /** Sliding window of reading-speed samples (most recent last) */
  rateSamples?: RateSample[]
  updatedAt: number
}

export interface ReadingRecordCreateReq {
  bookId: string
  /** Local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
  /** Unix ms when the session block started; defaults to server receive time.
   * Explicit null = retroactive entry without a known start time (endedAt then required) */
  startedAt?: number | null
  /** Manual-mode sessions only: exact end time and bounds in every display unit */
  endedAt?: number
  startCfi?: string
  endCfi?: string
  /** Book-wide position 0-1 (percent is derived by ×100 at display time) */
  startFraction?: number
  endFraction?: number
  startChapterIndex?: number
  endChapterIndex?: number
}

/** One row of the per-book session list; auto-mode blocks have null bounds */
export interface ReadingSessionItem {
  id: string
  bookId: string
  /** Client-local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  startedAt: number
  durationSeconds: number
  endedAt: number | null
  startCfi: string | null
  endCfi: string | null
  startFraction: number | null
  endFraction: number | null
  startChapterIndex: number | null
  endChapterIndex: number | null
}

export interface ReadingSessionUpdateReq {
  durationSeconds?: number
  startedAt?: number
  endedAt?: number
  date?: string
  startFraction?: number
  endFraction?: number
  startChapterIndex?: number
  endChapterIndex?: number
  startCfi?: string
  endCfi?: string
}

export interface ReadingRecordSummaryRes {
  totalSeconds: number
  totalBooks: number
  totalDays: number
  todaySeconds: number
  currentStreak: number
  longestStreak: number
  /** This calendar week (Mon–today) vs the previous full week, client-local days */
  weekSeconds: number
  prevWeekSeconds: number
  /** This calendar month (1st–today) vs the previous full month, client-local days */
  monthSeconds: number
  prevMonthSeconds: number
  /** Sum over books of readFraction × wordCount, rounded */
  totalWordsRead: number
}

export interface ReadingRecordDailyItem {
  date: string
  durationSeconds: number
}

export interface ReadingRecordHourlyItem {
  /** Client-local hour of day, 0-23 */
  hour: number
  durationSeconds: number
}

export interface ReadingRecordBookItem {
  bookId: string
  title: string
  author: string
  coverKey: string | null
  progress: number
  durationSeconds: number
  /** Distinct days with recorded reading in the range */
  days: number
  readStatus: ReadStatus
}

export interface ReadingRecordBookDetailRes {
  totalSeconds: number
  records: ReadingRecordDailyItem[]
}

/** Manual session row of the per-book mixed detail feed (same fields as the session list) */
export interface ReadingDetailManualItem extends Omit<ReadingSessionItem, 'startedAt'> {
  kind: 'manual'
  /** Null for retroactive entries recorded without a start time */
  startedAt: number | null
}

/** Auto-mode day row of the mixed detail feed: the day's total minus its manual sessions */
export interface ReadingDetailAutoDayItem {
  kind: 'autoDay'
  /** Client-local calendar day, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
}

export type ReadingDetailItem = ReadingDetailManualItem | ReadingDetailAutoDayItem

export interface ReadingRecordTagItem {
  tagId: string
  name: string
  durationSeconds: number
}

export type ReplacementCreateReq = {
  /**
   * Pattern rules with a bookId are book-scoped ("all matches in this book");
   * without it they are user-global. Point patches are inherently
   * single-book: bookId is required.
   */
  bookId?: string | null
  matchType?: ReplacementMatchType
  pattern?: string
  /** Null/empty = delete (hide) the matched content */
  replacement?: string | null
  isRegex?: boolean
  applyTo?: 'content' | 'title' | 'both'
  enabled?: boolean
  name?: string
  group?: string
  spineHref?: string
  textOffset?: number
  originalText?: string
}

export type ReplacementUpdateReq = {
  name?: string | null
  group?: string | null
  pattern?: string
  replacement?: string | null
  isRegex?: boolean
  applyTo?: 'content' | 'title' | 'both'
  enabled?: boolean
  /** Type conversion: point → pattern only (the snapshot becomes the pattern).
   *  pattern → point is rejected — point patches need anchors from a selection. */
  matchType?: ReplacementMatchType
  /** Scope conversion: null = user-global; a value = bind to a book */
  bookId?: string | null
  /** Point-patch snapshot edit (anchor offset is kept where the user selected) */
  originalText?: string
}

export interface TextReplacementRes {
  id: string
  /** Null = user-global pattern rule; set = book-scoped (point patches always carry their book) */
  bookId: string | null
  scope: ReplacementScope
  matchType: ReplacementMatchType
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  applyTo: 'content' | 'title' | 'both'
  /** Global default switch: applies to every book unless overridden per book */
  enabled: boolean
  /** Effective value for the queried book after applying its override; only set on `GET /replacements?bookId=` */
  effectiveEnabled?: boolean | null
  /** Whether a per-book override row exists; only set on `GET /replacements?bookId=` */
  hasOverride?: boolean
  name: string | null
  group: string | null
  spineHref: string | null
  textOffset: number | null
  originalText: string | null
  createdAt: number
  updatedAt: number
}

/** Per-book override for a pattern rule: boolean upserts the override, null deletes it (restore inheritance) */
export type ReplacementOverrideReq = {
  bookId: string
  enabled: boolean | null
}

export type TocRuleCreateReq = {
  name: string
  enabled?: boolean
  sortOrder?: number
  patterns: TocRulePattern[]
}

export type TocRuleUpdateReq = {
  name?: string
  enabled?: boolean
  sortOrder?: number
  patterns?: TocRulePattern[]
}

export type TocRuleReorderReq = {
  tocRuleIds: string[]
}

export interface TocRuleRes {
  id: string
  name: string
  enabled: boolean
  sortOrder: number
  patterns: TocRulePattern[]
  builtIn: boolean
  createdAt: number
  updatedAt: number
}

export interface TocRuleListRes {
  data: TocRuleRes[]
}

export interface TocPreviewReq {
  tocRuleId?: string | null
  customPatterns?: TocRulePattern[]
  excludedChapterIds?: string[]
  limit?: number
  offset?: number
}

export interface TocPreviewChapter {
  id: string
  title: string
  level: number
  wordCount: number
  excluded: boolean
  canExclude: boolean
}

export interface TocPreviewRes {
  ruleId: string | null
  ruleName?: string
  autoScored: boolean
  fallback: boolean
  totalChapters: number
  matchedTotalChapters: number
  currentTotalChapters: number
  levelCounts: Record<number, number>
  excludedChapterIds: string[]
  chapters: TocPreviewChapter[]
}

export interface ReTocReq {
  tocRuleId?: string | null
  customPatterns?: TocRulePattern[]
  excludedChapterIds?: string[]
}

/** JSON form of TXT append requests; file uploads use the same field name in multipart form data. */
export interface AppendContentReq {
  text?: string
  startOffset?: number
}

export interface AppendContentCandidate {
  title: string
  level: number
  wordCount: number
  startOffset: number
}

export interface AppendContentPreviewRes {
  originalChapterCount: number
  originalWordCount: number
  newChapterCount: number
  newWordCount: number
  addedChapterCount: number
  addedWordCount: number
  candidateTextLength: number
  candidateChapters: AppendContentCandidate[]
  predictedStartIndex: number
  addedChapters: Array<{
    title: string
    level: number
    wordCount: number
  }>
  appendedToLastChapter: boolean
  lastChapterTitle?: string
}

export type AnnotationCreateReq = {
  cfiRange: string
  cfiAnchor?: string
  type: AnnotationType
  color?: string
  style?: AnnotationStyle
  text?: string
  note?: string
  chapter?: string
}

export type AnnotationUpdateReq = {
  color?: string
  style?: AnnotationStyle
  note?: string
  text?: string
}

export interface AnnotationRes {
  id: string
  bookId: string
  cfiRange: string
  cfiAnchor: string | null
  type: AnnotationType
  color: string
  style: AnnotationStyle
  text: string
  note: string | null
  chapter: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}
