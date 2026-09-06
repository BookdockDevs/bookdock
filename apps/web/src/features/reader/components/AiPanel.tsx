import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { AI_DEFAULT_ASSISTANT_MODE_PROMPT, AI_DEFAULT_READING_SCOPE, AI_MAX_CHAT_PROMPT_CHARS, AI_TOOL_NAMES, isAiEmbeddingModel } from '@bookdock/shared'
import type { AiAssistantMode, AiChapterReference, AiChatReq, AiCitation, AiContextReceipt, AiConversationSettings, AiHistoryMessage, AiMessageRes, AiReadingScope, AiRetryRecipe, AiStatusRes, AiThreadRes, AiToolName } from '@bookdock/shared'

import { apiGet, apiStreamAiChat, ApiError } from '@/api/client'
import { AI_THREADS_KEY, useAiIndexStatus, useAiThread, useAiThreads, useCancelAiBookIndex, useClearAiBookIndex, useDeleteAiThread, useIndexAiBook, useUpdateAiConfig, useUpdateAiThread } from '@/api/hooks/useAi'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import Modal from '@/components/ui/Modal'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { preloadAiBrandIcons } from '@/lib/aiBrandIcons'
import { getUserDisplayName, useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'
import { useUiStore } from '@/stores/ui.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useBookChapters } from '../hooks/useBookChapters'
import { useAiQuickCommands, type AiQuickCommand } from '../hooks/useAiQuickCommands'
import { useIsTouch } from '../hooks/useIsTouch'
import { useAnnotations, useCreateAnnotation } from '../hooks/useAnnotations'
import { readAiPanelMemory, writeAiPanelMemory, type AiPanelMemory } from '../lib/ai-panel-memory'
import { expandAiPrompt } from '../lib/ai-quick-commands'
import { useReaderState } from '../state/reader-state'
import { BulbIcon, CheckIcon, CloseIcon, SelectedPositionIcon } from './annotation-icons'

interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  context: AiContextReceipt | null
  aborted: boolean
  citations: AiCitation[]
  retry?: AiRetryRecipe | null
  ideaTarget?: { cfiRange: string; text: string; chapter?: string }
  savedAsIdea: boolean
}

interface AiRequest {
  threadId?: string
  regenerate?: boolean
  prompt: string
  context: AiChatReq['context']
  history: AiHistoryMessage[]
  enabledTools: AiToolName[]
  readingScope: AiReadingScope
  assistantModeId: string
  assistantMode?: string
  assistantModePrompt?: string
}

interface AssistantModeForm {
  id: string | null
  name: string
  prompt: string
}

interface ChapterReferenceNode {
  index: number
  parent: number | null
  depth: number
  hasChildren: boolean
}

const DEFAULT_ASSISTANT_MODE: AiAssistantMode = { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }
const DEFAULT_CONVERSATION_SETTINGS: AiConversationSettings = { readingScope: AI_DEFAULT_READING_SCOPE, enabledTools: [...AI_TOOL_NAMES], assistantModeId: DEFAULT_ASSISTANT_MODE.id }
const COMPOSER_MIN_HEIGHT = 48
const COMPOSER_MAX_HEIGHT = 144
const READ_SCROLLBAR_CLASSES = '[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--bd-read-sub)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--bd-read-sub)]/50'

const AI_PERMISSION_OPTIONS: ReadonlyArray<{ id: string; toolNames: AiToolName[]; label: string; description: string }> = [
  { id: 'book-content', toolNames: ['get_chapter_content', 'search_book'], label: '阅读与搜索正文', description: '读取章节并检索当前书的正文' },
  { id: 'book-toc', toolNames: ['get_book_toc'], label: '查看书籍目录', description: '了解可读取的章节结构' },
  { id: 'book-notes', toolNames: ['search_notes'], label: '搜索笔记与划线', description: '检索当前书的笔记、划线和书签' },
]

const READING_SCOPE_OPTIONS: ReadonlyArray<{ id: AiReadingScope; label: string }> = [
  { id: 'to_here', label: '读到这里' },
  { id: 'current_chapter', label: '当前章节' },
  { id: 'full_book', label: '全书' },
]

function readingScopeLabel(scope: AiReadingScope | undefined) {
  return READING_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? '当前范围'
}

function messageId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function fromPersistedMessage(message: AiMessageRes): AiMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    context: message.context,
    aborted: message.aborted,
    citations: message.citations ?? [],
    retry: message.retry ?? null,
    savedAsIdea: false,
  }
}

function ChapterReferenceIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
    </svg>
  )
}

function AttachmentIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8.5 12.5 6.8-6.8a3.2 3.2 0 0 1 4.5 4.5L10.5 19.5a5 5 0 0 1-7.1-7.1l9-9" />
      <path d="m6.5 14.5 8.8-8.8" />
    </svg>
  )
}

function ReadingScopeIcon({ scope }: { scope: AiReadingScope }) {
  if (scope === 'current_chapter') {
    return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 12h6M9 15.5h4" /></svg>
  }
  if (scope === 'full_book') {
    return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 5.5c3.2-.8 6-.1 8.5 2v12c-2.5-2.1-5.3-2.8-8.5-2zM20.5 5.5c-3.2-.8-6-.1-8.5 2v12c2.5-2.1 5.3-2.8 8.5-2z" /></svg>
  }
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5c3-.8 5.7-.1 8 2v12c-2.3-2.1-5-2.8-8-2zM20 5.5c-3-.8-5.7-.1-8 2v12c2.3-2.1 5-2.8 8-2z" /><path d="M7 12h3M7 15h2" /></svg>
}

function ChatIcon() {
  return (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11.5a8 8 0 0 1-8 8 8.3 8.3 0 0 1-3.5-.8L4 20l1.3-4A8 8 0 1 1 20 11.5Z" />
      <circle cx="8.5" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="11" r=".7" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 4 16 8-16 8 3-8Z" />
      <path d="M7 12h13" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

function RetryIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.8-3.9L3 9" />
      <path d="M3 4.5V9h4.5M4 13a8 8 0 0 0 14.8 3.9L21 15M21 19.5V15h-4.5" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 16 9.5-9.5a2.1 2.1 0 0 1 3 3L7 19H4v-3Z" />
      <path d="m13.5 7.5 3 3" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  )
}

function ToolsIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5 5l-6.2 6.2a2.1 2.1 0 0 0 3 3l6.2-6.2a4 4 0 0 0 5-5l-2.4 2.4-3-3z" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
    </svg>
  )
}

function renderInline(value: string, citations: AiCitation[] = [], onCitationClick?: (citation: AiCitation) => void): ReactNode[] {
  const tokenPattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[\d+\]|【\d+】|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g
  return value.split(tokenPattern).map((part, index) => {
    if (!part) return null
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{link[1]}</a>
    }
    const citationNumber = part.match(/^\[(\d+)\]$/)?.[1] ?? part.match(/^【(\d+)】$/)?.[1]
    if (citationNumber) {
      const citation = citations[Number(citationNumber) - 1]
      if (citation && onCitationClick) {
        return <button key={index} type="button" onClick={() => onCitationClick(citation)} title={citation.excerpt} aria-label={`跳转到依据 ${citationNumber}`} className="relative -top-0.5 mx-0.5 align-baseline text-[10px] text-[var(--bd-read-primary)] underline decoration-dotted underline-offset-2">[{citationNumber}]</button>
      }
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-stone-500/10 px-1 py-0.5 text-[.9em]">{part.slice(1, -1)}</code>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={index}>{part.slice(1, -1)}</em>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function MarkdownText({ content, citations, onCitationClick }: { content: string; citations?: AiCitation[]; onCitationClick?: (citation: AiCitation) => void }) {
  const blocks = content.split(/\n{2,}/)
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const lines = block.split('\n')
        const heading = lines.length === 1 ? lines[0]?.match(/^#{1,3}\s+(.+)$/) : null
        if (heading) return <p key={index} className="font-medium">{renderInline(heading[1] ?? '', citations, onCitationClick)}</p>
        if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={index} className="list-disc space-y-1 pl-5">{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.replace(/^[-*]\s+/, ''), citations, onCitationClick)}</li>)}</ul>
        }
        return <p key={index}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line, citations, onCitationClick)}</Fragment>)}</p>
      })}
    </div>
  )
}

export default function AiPanel({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const memoryUserId = user?.id ?? 'anonymous'
  const initialMemoryRef = useRef<AiPanelMemory | null>(null)
  if (initialMemoryRef.current === null) initialMemoryRef.current = readAiPanelMemory(memoryUserId, bookId)
  const initialMemory = initialMemoryRef.current
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const aiContext = useReaderState((s) => s.aiContext)
  const setAiContext = useReaderState((s) => s.setAiContext)
  const aiPendingPrompt = useReaderState((s) => s.aiPendingPrompt)
  const setAiPendingPrompt = useReaderState((s) => s.setAiPendingPrompt)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const { renderer } = useReaderApi()
  const isTouch = useIsTouch()
  const toolbarLocked = useUiStore((s) => s.toolbarLocked)
  const annotationsQuery = useAnnotations(bookId)
  const createAnnotation = useCreateAnnotation(bookId)
  const [prompt, setPrompt] = useState(initialMemory.prompt)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [threadId, setThreadId] = useState<string | null>(initialMemory.activeThreadId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AiThreadRes | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelMenuPosition, setModelMenuPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [quickCommandMenuOpen, setQuickCommandMenuOpen] = useState(false)
  const [quickCommandIndex, setQuickCommandIndex] = useState(0)
 const [assistantModeMenuOpen, setAssistantModeMenuOpen] = useState(false)
 const [assistantModeForm, setAssistantModeForm] = useState<AssistantModeForm | null>(null)
  const [assistantModeDeleteTarget, setAssistantModeDeleteTarget] = useState<AiAssistantMode | null>(null)
  const [assistantModeRestoreOpen, setAssistantModeRestoreOpen] = useState(false)
 const [assistantModes, setAssistantModes] = useState<AiAssistantMode[]>([DEFAULT_ASSISTANT_MODE])
  const [selectedAssistantModeId, setSelectedAssistantModeId] = useState(DEFAULT_ASSISTANT_MODE.id)
  const [selectedChapterReferences, setSelectedChapterReferences] = useState<number[]>(initialMemory.chapterReferences)
  const [collapsedChapterReferences, setCollapsedChapterReferences] = useState<Set<number>>(new Set())
  const [preparingReferences, setPreparingReferences] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [enabledTools, setEnabledTools] = useState<AiToolName[]>(DEFAULT_CONVERSATION_SETTINGS.enabledTools)
  const [readingScope, setReadingScope] = useState<AiReadingScope>(DEFAULT_CONVERSATION_SETTINGS.readingScope)
  const [retryRequest, setRetryRequest] = useState<AiRequest | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [clearIndexOpen, setClearIndexOpen] = useState(false)
  const [preparingIndex, setPreparingIndex] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null)
  const [openBasisId, setOpenBasisId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const indexAbortRef = useRef<AbortController | null>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const modelMenuPopupRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const quickCommandMenuRef = useRef<HTMLDivElement>(null)
  const quickCommandIndexRef = useRef(0)
  const assistantModeMenuRef = useRef<HTMLDivElement>(null)
  const assistantModesInitializedRef = useRef(false)
  const attachmentRef = useRef<HTMLElement>(null)
  const attachmentButtonRef = useRef<HTMLButtonElement>(null)
  const toolsRef = useRef<HTMLElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const composerFormRef = useRef<HTMLFormElement>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const promptEditRevisionRef = useRef(0)
  const copiedMessageTimerRef = useRef<number | null>(null)
  const requestGenerationRef = useRef(0)
  const sendRef = useRef<(promptOverride?: string) => Promise<void>>(async () => undefined)
  const skipMemoryWriteRef = useRef(true)
  const conversationSettingsHydratedRef = useRef(false)
  const latestConversationSettingsRef = useRef<AiConversationSettings>(DEFAULT_CONVERSATION_SETTINGS)
  const memorySnapshotRef = useRef<{ userId: string; bookId: string; memory: AiPanelMemory } | null>(null)

  const threadsQuery = useAiThreads(bookId)
  const rememberedThreadExists = Boolean(threadId && Array.isArray(threadsQuery.data?.data) && threadsQuery.data.data.some((thread) => thread.id === threadId))
  const threadQuery = useAiThread(threadId, { enabled: !streaming && rememberedThreadExists })
  const indexQuery = useAiIndexStatus(bookId)
  const indexBook = useIndexAiBook()
  const cancelIndex = useCancelAiBookIndex()
  const clearIndex = useClearAiBookIndex()
  const updateAiConfig = useUpdateAiConfig()
  const { mutate: updateThreadSettings } = useUpdateAiThread()
  const renameThread = useUpdateAiThread()
  const deleteThread = useDeleteAiThread()
  const chaptersQuery = useBookChapters(bookId)
  const { commands: quickCommands } = useAiQuickCommands()

  const statusQuery = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => apiGet<{ data: AiStatusRes }>('/ai/status'),
  })

  useEffect(() => () => {
    abortRef.current?.abort()
    indexAbortRef.current?.abort()
  }, [])
  useEffect(() => {
    const memory = readAiPanelMemory(memoryUserId, bookId)
    conversationSettingsHydratedRef.current = false
    skipMemoryWriteRef.current = true
    requestGenerationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    indexAbortRef.current?.abort()
    indexAbortRef.current = null
    setPreparingIndex(false)
    setThreadId(memory.activeThreadId)
    setMessages([])
    setPrompt(memory.prompt)
    setStreaming(false)
    setToolStatus(null)
    setHistoryOpen(false)
    setQuickCommandMenuOpen(false)
    setAssistantModeMenuOpen(false)
    setAssistantModeForm(null)
    setAttachmentOpen(false)
    setToolsOpen(false)
    setMoreOpen(false)
    setEnabledTools([...DEFAULT_CONVERSATION_SETTINGS.enabledTools])
    setReadingScope(DEFAULT_CONVERSATION_SETTINGS.readingScope)
    setSelectedAssistantModeId(DEFAULT_CONVERSATION_SETTINGS.assistantModeId)
    setSelectedChapterReferences(memory.chapterReferences)
    setCollapsedChapterReferences(new Set())
    setPreparingReferences(false)
    setRenameThreadId(null)
    setDeleteTarget(null)
    setClearIndexOpen(false)
    setOpenQuoteId(null)
    setOpenBasisId(null)
  }, [bookId, memoryUserId])
  useEffect(() => {
    const threads = threadsQuery.data?.data
    if (streaming || threadsQuery.isFetching || !threadId || !Array.isArray(threads) || threads.some((thread) => thread.id === threadId)) return
    if (messages.at(-1)?.role === 'assistant' && messages.at(-1)?.content.trim()) return
    setThreadId(null)
    setMessages([])
  }, [messages, streaming, threadId, threadsQuery.data, threadsQuery.isFetching])
  useEffect(() => {
    const chapterCount = chaptersQuery.data?.data.length
    if (chapterCount == null) return
    setSelectedChapterReferences((current) => {
      const valid = current.filter((index) => index < chapterCount)
      return valid.length === current.length ? current : valid
    })
  }, [chaptersQuery.data])
  useEffect(() => {
    if (streaming || !threadId || threadQuery.data?.data.id !== threadId) return
    const restoredMessages = threadQuery.data.data.messages.map(fromPersistedMessage)
    const lastMessage = restoredMessages.at(-1)
    const previousMessage = restoredMessages.at(-2)
    const recipe = lastMessage?.role === 'assistant' && previousMessage?.role === 'user' ? previousMessage.retry : null
    if (recipe && lastMessage && previousMessage) {
      const selectedText = recipe.context.selection.trim()
      const ideaTarget = selectedText && recipe.context.cfiRange !== 'selection'
        ? { cfiRange: recipe.context.cfiRange, text: selectedText.slice(0, 500), ...(recipe.context.chapterTitle ? { chapter: recipe.context.chapterTitle } : {}) }
        : undefined
      if (ideaTarget) {
        const annotations = Array.isArray(annotationsQuery.data?.data) ? annotationsQuery.data.data : []
        const savedAsIdea = annotations.some((annotation) => annotation.type === 'note'
          && annotation.cfiRange === ideaTarget.cfiRange
          && annotation.note?.trim() === lastMessage.content.trim())
        restoredMessages[restoredMessages.length - 1] = { ...lastMessage, ideaTarget, savedAsIdea }
      }
      const assistantModePrompt = recipe.assistantModePrompt
        ?? (recipe.assistantMode === DEFAULT_ASSISTANT_MODE.name ? DEFAULT_ASSISTANT_MODE.prompt : undefined)
      setRetryRequest({
        threadId,
        regenerate: true,
        prompt: previousMessage.content,
        context: recipe.context,
        history: [],
        enabledTools: [...recipe.enabledTools],
        readingScope: recipe.readingScope,
        assistantModeId: recipe.assistantModeId ?? threadQuery.data.data.settings?.assistantModeId ?? DEFAULT_ASSISTANT_MODE.id,
        ...(recipe.assistantMode ? { assistantMode: recipe.assistantMode } : {}),
        ...(assistantModePrompt ? { assistantModePrompt } : {}),
      })
    } else {
      setRetryRequest(null)
    }
    setMessages((current) => {
      const currentLast = current.at(-1)
      const restoredLast = restoredMessages.at(-1)
      const currentAnswerWasNotPersisted = currentLast?.role === 'assistant'
        && currentLast.content.trim()
        && (restoredMessages.length < current.length || restoredLast?.role !== 'assistant' || restoredLast.content !== currentLast.content)
      return currentAnswerWasNotPersisted ? current : restoredMessages
    })
    if (threadQuery.data.data.settings) {
      conversationSettingsHydratedRef.current = true
      setReadingScope(threadQuery.data.data.settings.readingScope)
      setEnabledTools(threadQuery.data.data.settings.enabledTools)
      setSelectedAssistantModeId(threadQuery.data.data.settings.assistantModeId ?? DEFAULT_ASSISTANT_MODE.id)
    }
  }, [annotationsQuery.data, streaming, threadId, threadQuery.data])
  useEffect(() => {
    const savedSettings = threadQuery.data?.data.settings
    if (streaming || !threadId || threadQuery.data?.data.id !== threadId || !savedSettings) return
    const toolsMatch = savedSettings.enabledTools.length === enabledTools.length && savedSettings.enabledTools.every((name, index) => name === enabledTools[index])
    const modeMatch = (savedSettings.assistantModeId ?? DEFAULT_ASSISTANT_MODE.id) === selectedAssistantModeId
    if (savedSettings.readingScope === readingScope && toolsMatch && modeMatch) return
    const timer = window.setTimeout(() => {
      updateThreadSettings({ id: threadId, body: { settings: { readingScope, enabledTools, assistantModeId: selectedAssistantModeId } } }, {
        onError: (error) => addToast(error.message, 'error'),
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [addToast, enabledTools, readingScope, selectedAssistantModeId, streaming, threadId, threadQuery.data, updateThreadSettings])
  useEffect(() => {
    const memory: AiPanelMemory = {
      activeThreadId: threadId,
      prompt,
      chapterReferences: selectedChapterReferences,
    }
    if (skipMemoryWriteRef.current) {
      skipMemoryWriteRef.current = false
      return
    }
    memorySnapshotRef.current = { userId: memoryUserId, bookId, memory }
    const timer = window.setTimeout(() => writeAiPanelMemory(memoryUserId, bookId, memory), 200)
    return () => window.clearTimeout(timer)
  }, [bookId, memoryUserId, prompt, selectedChapterReferences, threadId])
  useEffect(() => () => {
    const snapshot = memorySnapshotRef.current
    if (snapshot) writeAiPanelMemory(snapshot.userId, snapshot.bookId, snapshot.memory)
  }, [])
  useEffect(() => {
    setRetryRequest(null)
  }, [aiContext?.cfiRange])
  useEffect(() => {
    const modes = statusQuery.data?.data.modes
    if (!assistantModesInitializedRef.current && Array.isArray(modes)) {
      const availableModes = modes.length > 0 ? modes : [DEFAULT_ASSISTANT_MODE]
      setAssistantModes(availableModes)
      setSelectedAssistantModeId((current) => availableModes.some((mode) => mode.id === current) ? current : DEFAULT_ASSISTANT_MODE.id)
      assistantModesInitializedRef.current = true
    }
  }, [statusQuery.data?.data.modes])
  useEffect(() => {
    const settings = statusQuery.data?.data.lastUsedConversationSettings ?? DEFAULT_CONVERSATION_SETTINGS
    latestConversationSettingsRef.current = settings
    if (streaming || conversationSettingsHydratedRef.current || !statusQuery.isFetched || !threadsQuery.isFetched || threadId) return
    conversationSettingsHydratedRef.current = true
    setReadingScope(settings.readingScope)
    setEnabledTools(settings.enabledTools)
    setSelectedAssistantModeId(settings.assistantModeId)
  }, [bookId, statusQuery.data?.data.lastUsedConversationSettings, statusQuery.isFetched, streaming, threadId, threadsQuery.isFetched])
  useEffect(() => {
    if (!modelMenuOpen) {
      setModelMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const button = modelButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setModelMenuPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || modelMenuRef.current?.contains(target) || modelMenuPopupRef.current?.contains(target)) return
      setModelMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelMenuOpen(false)
    }

    updatePosition()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (composerFormRef.current) resizeObserver?.observe(composerFormRef.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [modelMenuOpen])
  useEffect(() => {
    if (!attachmentOpen) return
    const isInsideAttachment = (event: Event) => {
      const target = event.target
      return target instanceof Node && (attachmentRef.current?.contains(target) || attachmentButtonRef.current?.contains(target))
    }
    const closeIfOutside = (event: PointerEvent) => {
      if (!isInsideAttachment(event)) setAttachmentOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttachmentOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [attachmentOpen])
  useEffect(() => {
    if (!toolsOpen) return
    const isInsideTools = (event: Event) => {
      const target = event.target
      return target instanceof Node && (toolsRef.current?.contains(target) || toolsButtonRef.current?.contains(target))
    }
    const closeIfOutside = (event: PointerEvent) => {
      if (!isInsideTools(event)) setToolsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [toolsOpen])
  useEffect(() => {
    if (!moreOpen) return
    const isInsideMore = (event: Event) => {
      const target = event.target
      return target instanceof Node && (moreRef.current?.contains(target) || moreButtonRef.current?.contains(target))
    }
    const closeIfOutside = (event: PointerEvent) => {
      if (!isInsideMore(event)) setMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])
  useEffect(() => {
    if (!historyOpen) return
    const isInsideHistory = (event: Event) => {
      const target = event.target
      return target instanceof Node && (historyRef.current?.contains(target) || historyButtonRef.current?.contains(target))
    }
    const closeIfOutside = (event: PointerEvent) => {
      if (!isInsideHistory(event)) setHistoryOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [historyOpen])
  useLayoutEffect(() => {
    const textarea = promptTextareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    const contentHeight = textarea.scrollHeight
    textarea.style.height = `${Math.min(Math.max(contentHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT)}px`
    textarea.style.overflowY = contentHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [prompt])
  useEffect(() => () => {
    if (copiedMessageTimerRef.current !== null) window.clearTimeout(copiedMessageTimerRef.current)
  }, [])

  const selection = aiContext?.rawText?.trim() || aiContext?.text.trim() || ''
  const selectionPreview = selection.replace(/\s+/g, ' ')
  const currentParagraph = !selection ? renderer?.getCurrentParagraphText?.()?.trim() ?? '' : ''
  const chapterTitle = aiContext?.chapterTitle ?? currentChapter
  const chapterIndex = aiContext?.chapterIndex ?? currentChapterIndex ?? -1
  const modelReady = Boolean(statusQuery.data?.data.enabled)
  const modelLabel = modelReady ? statusQuery.data?.data.model ?? '当前模型' : '选择模型'
  const modelOptions = useMemo(() => {
    const models = (statusQuery.data?.data.models ?? []).filter((model) => !isAiEmbeddingModel(model))
    const currentModel = statusQuery.data?.data.model
    if (currentModel && !isAiEmbeddingModel({ id: currentModel, name: currentModel }) && !models.some((model) => model.id === currentModel)) return [{ id: currentModel, name: currentModel }, ...models]
    return models
  }, [statusQuery.data])
  const selectedModel = modelOptions.find((model) => model.id === statusQuery.data?.data.model)
  const selectedModelLabel = selectedModel
    ? selectedModel.name === selectedModel.id ? selectedModel.id : `${selectedModel.name} · ${selectedModel.id}`
    : modelLabel
  const embeddingConfigMismatch = useMemo(() => {
    const index = indexQuery.data?.data
    const status = statusQuery.data?.data
    if (!index || index.status !== 'ready' || index.embeddingStatus !== 'ready' || !status?.embeddingConfigured) return false
    return index.embeddingProvider !== status.embeddingProvider || index.embeddingModel !== status.embeddingModel
  }, [indexQuery.data, statusQuery.data])
  const visibleTextVersion = renderer?.getAiCorpusVersion?.() ?? null
  const visibleCorpusMismatch = useMemo(() => {
    const index = indexQuery.data?.data
    if (!visibleTextVersion || !index || index.status !== 'ready' || !index.sourceVersion) return false
    return !index.sourceVersion.endsWith(`:visible:${visibleTextVersion}`)
  }, [indexQuery.data, visibleTextVersion])
  const availableAssistantModes = assistantModes.length > 0 ? assistantModes : [DEFAULT_ASSISTANT_MODE]
  const selectedAssistantMode = availableAssistantModes.find((mode) => mode.id === selectedAssistantModeId) ?? DEFAULT_ASSISTANT_MODE
  const chapters = useMemo(() => Array.isArray(chaptersQuery.data?.data) ? chaptersQuery.data.data : [], [chaptersQuery.data])
  const chapterReferenceNodes = useMemo(() => {
    const nodes: ChapterReferenceNode[] = chapters.map((_chapter, index) => ({ index, parent: null, depth: 0, hasChildren: false }))
    const stack: number[] = []
    for (let index = 0; index < chapters.length; index++) {
      while (stack.length > 0 && chapters[stack[stack.length - 1]]!.level >= chapters[index]!.level) stack.pop()
      const parent = stack[stack.length - 1] ?? null
      nodes[index]!.parent = parent
      nodes[index]!.depth = parent === null ? 0 : nodes[parent]!.depth + 1
      if (parent !== null) nodes[parent]!.hasChildren = true
      stack.push(index)
    }
    return nodes
  }, [chapters])
  const visibleChapterReferenceNodes = useMemo(() => chapterReferenceNodes.filter((node) => {
    let parent = node.parent
    while (parent !== null) {
      if (collapsedChapterReferences.has(parent)) return false
      parent = chapterReferenceNodes[parent]!.parent
    }
    return true
  }), [chapterReferenceNodes, collapsedChapterReferences])
  const canSend = modelReady && Boolean(prompt.trim()) && !streaming && !preparingReferences
  const slashQuery = prompt.startsWith('/') ? prompt.slice(1).trim().toLocaleLowerCase() : null
  const visibleQuickCommands = useMemo(
    () => slashQuery === null
      ? []
      : quickCommands.filter((command) => !slashQuery || command.name.toLocaleLowerCase().includes(slashQuery)),
    [quickCommands, slashQuery],
  )
  useEffect(() => {
    quickCommandIndexRef.current = 0
    setQuickCommandIndex(0)
  }, [quickCommandMenuOpen, slashQuery])
  useEffect(() => {
    preloadAiBrandIcons(modelOptions)
  }, [modelOptions])
  useDismissiblePopup(quickCommandMenuOpen, quickCommandMenuRef, () => setQuickCommandMenuOpen(false))
  useDismissiblePopup(assistantModeMenuOpen, assistantModeMenuRef, () => setAssistantModeMenuOpen(false))
  const indexStatus = indexQuery.data?.data.status
  const indexActionVisible = Boolean(visibleCorpusMismatch || embeddingConfigMismatch || ['not_indexed', 'stale', 'failed', 'indexing'].includes(indexStatus ?? '') || indexQuery.data?.data.embeddingStatus === 'failed')
  const indexActionLabel = preparingIndex
    ? _('reader.aiIndexPreparing')
    : indexStatus === 'indexing' || indexBook.isPending
      ? _('reader.aiIndexCancel')
      : visibleCorpusMismatch
        ? _('reader.aiCorpusRebuild')
        : embeddingConfigMismatch
          ? _('reader.aiEmbeddingRebuild')
          : indexQuery.data?.data.embeddingStatus === 'failed'
            ? _('reader.aiEmbeddingRetry')
            : indexStatus === 'failed'
              ? _('reader.aiIndexRebuild')
              : _('reader.aiIndexBuild')

  function updateAssistant(id: string, update: (message: AiMessage) => AiMessage) {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message))
  }

  function startNewChat() {
    if (streaming) return
    const settings = latestConversationSettingsRef.current
    conversationSettingsHydratedRef.current = true
    setThreadId(null)
    setMessages([])
    setRetryRequest(null)
    setToolStatus(null)
    setPrompt('')
    setAiPendingPrompt(null)
    setQuickCommandMenuOpen(false)
    setAssistantModeMenuOpen(false)
    setAttachmentOpen(false)
    setToolsOpen(false)
    setMoreOpen(false)
    setEnabledTools([...settings.enabledTools])
    setReadingScope(settings.readingScope)
    setSelectedAssistantModeId(settings.assistantModeId)
    setSelectedChapterReferences([])
    setAiContext(null)
    setHistoryOpen(false)
  }

  function selectThread(id: string) {
    if (streaming) return
    if (id === threadId) {
      if (threadQuery.data?.data.id === id) setMessages(threadQuery.data.data.messages.map(fromPersistedMessage))
      else void threadQuery.refetch()
      setHistoryOpen(false)
      return
    }
    setThreadId(id)
    setMessages([])
    setPrompt('')
    setAiPendingPrompt(null)
    setQuickCommandMenuOpen(false)
    setAttachmentOpen(false)
    setToolsOpen(false)
    setRetryRequest(null)
    setHistoryOpen(false)
  }

  function togglePermission(toolNames: AiToolName[]) {
    const enabled = toolNames.every((name) => enabledTools.includes(name))
    const nextTools = enabled ? enabledTools.filter((name) => !toolNames.includes(name)) : AI_TOOL_NAMES.filter((name) => enabledTools.includes(name) || toolNames.includes(name))
    setEnabledTools(nextTools)
    rememberLatestConversationSettings({ enabledTools: nextTools })
  }

  function rememberLatestConversationSettings(patch: Partial<AiConversationSettings>) {
    const nextSettings: AiConversationSettings = {
      readingScope,
      enabledTools: [...enabledTools],
      assistantModeId: selectedAssistantModeId,
      ...patch,
    }
    conversationSettingsHydratedRef.current = true
    latestConversationSettingsRef.current = nextSettings
    updateAiConfig.mutate({
      lastUsedConversationSettings: nextSettings,
    }, {
      onError: (error) => addToast(error.message, 'error'),
    })
  }

  function cycleReadingScope() {
    const nextScope = readingScope === 'to_here'
      ? 'current_chapter'
      : readingScope === 'current_chapter'
        ? 'full_book'
        : 'to_here'
    setReadingScope(nextScope)
    rememberLatestConversationSettings({ readingScope: nextScope })
    setAttachmentOpen(false)
    setToolsOpen(false)
    setHistoryOpen(false)
    setMoreOpen(false)
    addToast(nextScope === 'full_book'
      ? '阅读范围：全书，可能包含未读内容'
      : `阅读范围：${readingScopeLabel(nextScope)}`)
  }

  function toggleChapterReference(chapterIndex: number) {
    setSelectedChapterReferences((current) => current.includes(chapterIndex) ? current.filter((index) => index !== chapterIndex) : [...current, chapterIndex])
  }

  function toggleChapterReferenceGroup(chapterIndex: number) {
    setCollapsedChapterReferences((current) => {
      const next = new Set(current)
      if (next.has(chapterIndex)) next.delete(chapterIndex)
      else next.add(chapterIndex)
      return next
    })
  }

 function selectAssistantMode(mode: AiAssistantMode) {
   setSelectedAssistantModeId(mode.id)
   rememberLatestConversationSettings({ assistantModeId: mode.id })
   setAssistantModeMenuOpen(false)
 }

 function openAssistantModeForm(mode?: AiAssistantMode) {
   if (updateAiConfig.isPending) return
   setAssistantModeMenuOpen(false)
    setAssistantModeForm(mode ? { id: mode.id, name: mode.name, prompt: mode.prompt } : { id: null, name: '', prompt: '' })
 }

 function submitAssistantMode() {
   if (!assistantModeForm || updateAiConfig.isPending) return
   const name = assistantModeForm.name.trim()
   const prompt = assistantModeForm.prompt.trim()
   if (!name || !prompt) return
    const isEditingDefault = assistantModeForm.id === DEFAULT_ASSISTANT_MODE.id
    const id = assistantModeForm.id ?? `custom-${Date.now().toString(36)}`
    const nextModes = isEditingDefault
      ? assistantModes.filter((mode) => !mode.builtIn)
      : assistantModeForm.id
        ? assistantModes.filter((mode) => !mode.builtIn).map((mode) => mode.id === assistantModeForm.id ? { ...mode, name, prompt } : mode)
        : [...assistantModes.filter((mode) => !mode.builtIn), { id, name, prompt, builtIn: false }]
   updateAiConfig.mutate({
     modes: nextModes.filter((mode) => !mode.builtIn).map(({ id: modeId, name: modeName, prompt: modePrompt }) => ({ id: modeId, name: modeName, prompt: modePrompt })),
     ...(isEditingDefault ? { defaultAssistantMode: { id: DEFAULT_ASSISTANT_MODE.id, name, prompt } } : {}),
   }, {
     onSuccess: (response) => {
       setAssistantModes(response.data.modes)
       if (!assistantModeForm.id || assistantModeForm.id === selectedAssistantModeId) setSelectedAssistantModeId(id)
       setAssistantModeForm(null)
       addToast(assistantModeForm.id ? '助理模式已更新' : '助理模式已添加', 'success')
     },
     onError: (error) => addToast(error.message, 'error'),
   })
 }

  function requestRestoreAssistantMode() {
    if (assistantModeForm?.id !== DEFAULT_ASSISTANT_MODE.id || updateAiConfig.isPending) return
    setAssistantModeRestoreOpen(true)
  }

  function requestDeleteAssistantMode() {
    if (!assistantModeForm?.id || updateAiConfig.isPending) return
    const mode = assistantModes.find((candidate) => candidate.id === assistantModeForm.id && !candidate.builtIn)
    if (mode) setAssistantModeDeleteTarget(mode)
  }

  function confirmRestoreAssistantMode() {
    if (!assistantModeRestoreOpen || updateAiConfig.isPending) return
    updateAiConfig.mutate({ defaultAssistantMode: null }, {
      onSuccess: (response) => {
        setAssistantModes(response.data.modes)
        setAssistantModeRestoreOpen(false)
        setAssistantModeForm(null)
        addToast('已恢复默认助理模式', 'success')
      },
      onError: (error) => addToast(error.message, 'error'),
    })
  }

  function confirmDeleteAssistantMode() {
    if (!assistantModeDeleteTarget || updateAiConfig.isPending) return
    const deletingId = assistantModeDeleteTarget.id
    const nextModes = assistantModes.filter((mode) => !mode.builtIn && mode.id !== deletingId)
    updateAiConfig.mutate({ modes: nextModes.map(({ id, name, prompt }) => ({ id, name, prompt })) }, {
      onSuccess: (response) => {
        setAssistantModes(response.data.modes)
        if (selectedAssistantModeId === deletingId) setSelectedAssistantModeId(DEFAULT_ASSISTANT_MODE.id)
        setAssistantModeDeleteTarget(null)
        setAssistantModeForm(null)
        addToast('助理模式已删除', 'success')
      },
      onError: (error) => addToast(error.message, 'error'),
    })
  }

  function beginRename(thread: AiThreadRes) {
    setRenameThreadId(thread.id)
    setRenameTitle(thread.title)
  }

  function submitRename(thread: AiThreadRes) {
    const title = renameTitle.trim()
    if (!title || renameThread.isPending) return
    renameThread.mutate({ id: thread.id, body: { title } }, {
      onSuccess: () => {
        setRenameThreadId(null)
        setRenameTitle('')
      },
      onError: (error) => addToast(error.message, 'error'),
    })
  }

  function confirmDelete() {
    if (!deleteTarget || deleteThread.isPending) return
    const target = deleteTarget
    deleteThread.mutate({ id: target.id, bookId }, {
      onSuccess: () => {
        if (threadId === target.id) startNewChat()
        setDeleteTarget(null)
      },
      onError: (error) => addToast(error.message, 'error'),
    })
  }

  async function runRequest(request: AiRequest, replaceLast = false) {
    if (streaming) return
    const requestGeneration = requestGenerationRef.current
    const promptEditRevision = promptEditRevisionRef.current
    const userMessage: AiMessage = {
      id: messageId(),
      role: 'user',
      content: request.prompt,
      context: null,
      aborted: false,
      citations: [],
      retry: {
        context: request.context,
        readingScope: request.readingScope,
        enabledTools: request.enabledTools,
        assistantModeId: request.assistantModeId,
        ...(request.assistantMode ? { assistantMode: request.assistantMode } : {}),
        ...(request.assistantModePrompt ? { assistantModePrompt: request.assistantModePrompt } : {}),
      },
      savedAsIdea: false,
    }
    const assistantId = messageId()
    const selectedText = request.context.selection.trim()
    const ideaTarget = selectedText && request.context.cfiRange !== 'selection'
      ? { cfiRange: request.context.cfiRange, text: selectedText.slice(0, 500), ...(request.context.chapterTitle ? { chapter: request.context.chapterTitle } : {}) }
      : undefined
    setMessages((current) => [...(replaceLast ? current.slice(0, -2) : current), userMessage, { id: assistantId, role: 'assistant', content: '', context: null, aborted: false, citations: [], savedAsIdea: false, ...(ideaTarget ? { ideaTarget } : {}) }])
    setPrompt('')
    setRetryRequest(null)
    setToolStatus(null)
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    let activeThreadId = request.threadId

    try {
      await apiStreamAiChat({ bookId, ...request }, {
        onMeta: (event) => {
          if (requestGenerationRef.current !== requestGeneration) return
          updateAssistant(userMessage.id, (message) => ({ ...message, context: event.receipt }))
          if (event.threadId) {
            activeThreadId = event.threadId
            setThreadId(event.threadId)
          }
        },
        onDelta: (delta) => {
          if (requestGenerationRef.current !== requestGeneration) return
          updateAssistant(assistantId, (message) => ({ ...message, content: message.content + delta }))
        },
        onTool: (event) => {
          if (requestGenerationRef.current !== requestGeneration) return
          if (event.phase === 'start') {
              setToolStatus(event.name === 'get_book_toc'
                ? '正在查看目录…'
                : event.name === 'search_book'
                  ? '正在检索本书…'
                : event.name === 'search_notes'
                  ? '正在查看书内笔记…'
              : typeof event.chapterIndex === 'number' ? `正在读取第 ${event.chapterIndex + 1} 章…` : '正在读取正文…')
          } else {
            if (event.citations?.length) {
              updateAssistant(assistantId, (message) => {
                const known = new Set(message.citations.map((citation) => citation.id))
                return { ...message, citations: [...message.citations, ...event.citations!.filter((citation) => !known.has(citation.id))] }
              })
            }
            setToolStatus(null)
          }
        },
      }, controller.signal)
      if (requestGenerationRef.current === requestGeneration) setRetryRequest(activeThreadId ? { ...request, threadId: activeThreadId, regenerate: true } : request)
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return
      setRetryRequest(activeThreadId ? { ...request, threadId: activeThreadId, regenerate: true } : request)
      if (!controller.signal.aborted) {
        if (promptEditRevisionRef.current === promptEditRevision) setPrompt(request.prompt)
        const message = error instanceof ApiError ? error.message : 'AI 请求失败，请稍后重试'
        updateAssistant(assistantId, (current) => ({ ...current, content: current.content ? `${current.content}\n\n请求失败：${message}` : `请求失败：${message}` }))
      } else {
        updateAssistant(assistantId, (current) => ({ ...current, content: current.content ? `${current.content}\n\n（已停止）` : '（已停止）', aborted: true }))
      }
    } finally {
      if (requestGenerationRef.current === requestGeneration) {
        abortRef.current = null
        setToolStatus(null)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, bookId] }),
          activeThreadId
            ? queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, 'detail', activeThreadId] })
            : Promise.resolve(),
        ]).catch(() => undefined)
        if (requestGenerationRef.current === requestGeneration) setStreaming(false)
      }
    }
  }

  async function send(promptOverride?: string) {
    const template = (promptOverride ?? prompt).trim()
    if (!modelReady || !template || streaming || preparingReferences) return
    if (readingScope !== 'full_book' && chapterIndex >= 0 && selectedChapterReferences.some((referenceIndex) => referenceIndex > chapterIndex)) {
      addToast('你手动引用了当前阅读位置之后的章节；AI 的自动读取仍会遵守防剧透范围。')
    }
    const history: AiHistoryMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.role === 'user' && message.retry?.context ? { context: message.retry.context } : {}),
    })).filter((message) => message.content.trim())
    let chapterReferences: AiChapterReference[] | undefined
    if (selectedChapterReferences.length > 0) {
      if (!renderer?.getAiChapterText) {
        addToast('阅读器尚未准备好，暂时无法引用章节', 'error')
        return
      }
      setPreparingReferences(true)
      try {
        const references = await Promise.all(selectedChapterReferences.map(async (chapterIndex) => ({
          chapterIndex,
          chapterTitle: chapters[chapterIndex]?.title,
          text: await renderer.getAiChapterText(chapterIndex),
        })))
        chapterReferences = references.map((reference) => ({
          ...reference,
          ...(reference.chapterTitle ? { chapterTitle: reference.chapterTitle } : {}),
        }))
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) addToast(error instanceof Error ? error.message : '读取引用章节失败', 'error')
        return
      } finally {
        setPreparingReferences(false)
      }
    }
    let chapterText = ''
    if (template.includes('{CHAPTER}')) {
      if (!renderer?.getAiChapterText || chapterIndex < 0) {
        addToast('当前章节正文尚未准备好，暂时无法展开章节变量', 'error')
        return
      }
      setPreparingReferences(true)
      try {
        chapterText = await renderer.getAiChapterText(chapterIndex)
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) addToast(error instanceof Error ? error.message : '读取当前章节正文失败', 'error')
        return
      } finally {
        setPreparingReferences(false)
      }
    }
    const text = expandAiPrompt(template, {
      selectedText: selection,
      selectedParagraph: aiContext?.paragraphText?.trim() || currentParagraph,
      chapterText,
    })
    if (text.length > AI_MAX_CHAT_PROMPT_CHARS) {
      addToast('快捷指令展开后的问题过长，请缩短模板或改用章节总结', 'error')
      return
    }
    void runRequest({
      ...(threadId ? { threadId } : {}),
      prompt: text,
      history,
      context: {
        chapterIndex,
        chapterTitle: chapterTitle ?? undefined,
        cfiRange: aiContext?.cfiRange ?? 'selection',
        selection,
        ...(chapterReferences?.length ? { chapterReferences } : {}),
        ...(visibleTextVersion ? { visibleTextVersion } : {}),
      },
      enabledTools: [...enabledTools],
      readingScope,
      assistantModeId: selectedAssistantMode.id,
      assistantMode: selectedAssistantMode.name,
      ...(selectedAssistantMode.prompt ? { assistantModePrompt: selectedAssistantMode.prompt } : {}),
    })
    setSelectedChapterReferences([])
    setAiContext(null)
  }

  sendRef.current = send

  useEffect(() => {
    if (!aiPendingPrompt || streaming || statusQuery.isPending) return
    const pendingPrompt = aiPendingPrompt
    setAiPendingPrompt(null)
    setPrompt(pendingPrompt)
    setQuickCommandMenuOpen(false)
    if (modelReady) void sendRef.current(pendingPrompt)
  }, [aiPendingPrompt, modelReady, setAiPendingPrompt, statusQuery.isPending, streaming])

  function stop() {
    abortRef.current?.abort()
  }

  async function copyAssistantMessage(messageId: string, content: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable')
      await navigator.clipboard.writeText(content)
      if (copiedMessageTimerRef.current !== null) window.clearTimeout(copiedMessageTimerRef.current)
      setCopiedMessageId(messageId)
      copiedMessageTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => current === messageId ? null : current)
        copiedMessageTimerRef.current = null
      }, 1_800)
      addToast(_('reader.aiCopied'))
    } catch {
      addToast(_('reader.aiCopyFailed'), 'error')
    }
  }

  async function saveAssistantAsIdea(message: AiMessage) {
    if (createAnnotation.isPending || message.savedAsIdea || message.aborted || !message.content.trim() || !message.ideaTarget) return
    try {
      await createAnnotation.mutateAsync({
        cfiRange: message.ideaTarget.cfiRange,
        type: 'note',
        style: 'underline',
        color: 'yellow',
        text: message.ideaTarget.text,
        ...(message.ideaTarget.chapter ? { chapter: message.ideaTarget.chapter } : {}),
        note: message.content.trim(),
      })
      updateAssistant(message.id, (current) => ({ ...current, savedAsIdea: true }))
      addToast(_('reader.aiSavedAsIdea'), 'success')
    } catch {
      addToast(_('reader.aiSaveIdeaFailed'), 'error')
    }
  }

  function exportConversation() {
    if (messages.length === 0) return
    try {
      const title = historyThreads.find((thread) => thread.id === threadId)?.title ?? _('settings.aiServiceName')
      const userLabel = getUserDisplayName(user, _('auth.guest'))
      const lines = [`# ${title}`, '', `${_('reader.aiExportTimestamp')}：${new Date().toLocaleString()}`, '']
      messages.forEach((message) => {
        lines.push(`## ${message.role === 'user' ? userLabel : _('reader.aiExportAssistant')}`, '', message.content.trim() || `（${_('reader.aiExportNoContent')}）`, '')
        if (message.context) {
          lines.push(`> ${_('reader.aiExportContext', { chapter: message.context.chapterTitle ?? _('reader.aiExportSelection'), chars: message.context.contextChars })}`, '')
        }
        if (message.citations.length > 0) {
          lines.push(`${_('reader.aiExportSources')}：`, ...message.citations.map((citation) => `- ${citation.chapterTitle || _('reader.aiExportChapter', { n: citation.chapterIndex + 1 })}：${citation.excerpt}`), '')
        }
        if (message.aborted) lines.push(`> ${_('reader.aiExportStopped')}`, '')
      })
      const content = lines.join('\n')
      const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'ai-conversation'}-${new Date().toISOString().slice(0, 10)}.md`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      addToast(_('reader.aiExported'), 'success')
    } catch {
      addToast(_('reader.aiExportFailed'), 'error')
    }
  }

  function selectModel(model: string) {
    if (!model || model === statusQuery.data?.data.model || updateAiConfig.isPending) return
    updateAiConfig.mutate({ model }, { onError: (error) => addToast(error.message, 'error') })
  }

  async function buildBookIndex() {
    if (preparingIndex || indexBook.isPending || indexQuery.data?.data.status === 'indexing') return
    const controller = new AbortController()
    indexAbortRef.current = controller
    setPreparingIndex(true)
    try {
      if (!renderer?.getAiCorpus) {
        addToast(_('reader.aiIndexReaderNotReady'), 'error')
        return
      }
      const corpus = await renderer.getAiCorpus(controller.signal)
      if (controller.signal.aborted) return
      indexBook.mutate({
        bookId,
        force: visibleCorpusMismatch || embeddingConfigMismatch || ['stale', 'failed'].includes(indexQuery.data?.data.status ?? ''),
        visibleTextVersion: corpus.visibleTextVersion,
        chapters: corpus.chapters,
        signal: controller.signal,
      }, {
        onError: (error) => {
          if (error instanceof Error && error.name === 'AbortError') return
          addToast(error.message, 'error')
        },
        onSettled: () => {
          if (indexAbortRef.current === controller) indexAbortRef.current = null
        },
      })
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) addToast(error instanceof Error ? error.message : _('reader.aiIndexBuildFailed'), 'error')
      if (indexAbortRef.current === controller) indexAbortRef.current = null
    } finally {
      setPreparingIndex(false)
    }
  }

  function cancelBookIndex() {
    if (preparingIndex) {
      indexAbortRef.current?.abort()
      return
    }
    if (!indexBook.isPending && indexQuery.data?.data.status !== 'indexing') return
    indexAbortRef.current?.abort()
    cancelIndex.mutate({ bookId }, { onError: (error) => addToast(error.message, 'error') })
  }

  function confirmClearIndex() {
    clearIndex.mutate(bookId, {
      onSuccess: () => {
        setClearIndexOpen(false)
        addToast(_('reader.aiIndexCleared'), 'success')
      },
      onError: (error) => addToast(error.message, 'error'),
    })
  }

  function jumpToCitation(citation: AiCitation) {
    if (!renderer) return
    const target = citation.sourceCfi ?? `search-hit:${citation.chapterIndex}:${citation.startOffset}:${citation.endOffset}`
    try {
      void Promise.resolve(renderer.display(target)).catch(() => undefined)
    } catch {
    }
    if (isTouch || !toolbarLocked) setSidebarOpen(false)
  }

  function jumpToQuote(target: string) {
    if (!renderer) return
    try {
      void Promise.resolve(renderer.display(target)).catch(() => undefined)
    } catch {
    }
    if (isTouch || !toolbarLocked) setSidebarOpen(false)
  }

  function applyQuickCommand(command: AiQuickCommand) {
    setPrompt(command.prompt)
    setQuickCommandMenuOpen(false)
    promptTextareaRef.current?.focus()
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      setQuickCommandMenuOpen(false)
      return
    }
    if (quickCommandMenuOpen && slashQuery !== null && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const nextIndex = visibleQuickCommands.length === 0
        ? 0
        : event.key === 'ArrowDown'
          ? Math.min(quickCommandIndexRef.current + 1, visibleQuickCommands.length - 1)
          : Math.max(quickCommandIndexRef.current - 1, 0)
      quickCommandIndexRef.current = nextIndex
      setQuickCommandIndex(nextIndex)
      return
    }
    if (quickCommandMenuOpen && slashQuery !== null && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && visibleQuickCommands[quickCommandIndexRef.current]) {
      event.preventDefault()
      applyQuickCommand(visibleQuickCommands[quickCommandIndexRef.current])
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  const historyThreads = useMemo(() => Array.isArray(threadsQuery.data?.data) ? threadsQuery.data.data : [], [threadsQuery.data])

  return (
    <div data-testid="ai-panel" className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bd-read-bg)] @container/ai-panel">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center border-b border-[var(--bd-read-accent)] px-4 @max-[240px]/ai-panel:px-2" style={{ backgroundColor: 'var(--bd-read-bg)' }}>
        <div ref={assistantModeMenuRef} className="relative min-w-0 max-w-40 shrink @max-[320px]/ai-panel:max-w-28 @max-[240px]/ai-panel:max-w-20">
          <button type="button" onClick={() => { setAssistantModeMenuOpen((open) => !open); setAttachmentOpen(false); setToolsOpen(false); setModelMenuOpen(false); setHistoryOpen(false); setMoreOpen(false) }} aria-label="选择助理模式" aria-haspopup="menu" aria-expanded={assistantModeMenuOpen} title={selectedAssistantMode.name} className={`flex min-w-0 max-w-full items-center gap-0.5 rounded px-1 py-0.5 text-sm font-medium text-current outline-none transition-colors hover:bg-stone-500/10 focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] ${assistantModeMenuOpen ? 'bg-stone-500/10' : ''}`}>
            <span className="min-w-0 flex-1 truncate">{selectedAssistantMode.name}</span>
            <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${assistantModeMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          {assistantModeMenuOpen && (
            <div role="menu" aria-label="选择助理模式" className="absolute left-0 top-full z-30 mt-2 min-w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 shadow-xl">
              {availableAssistantModes.map((mode) => <div key={mode.id} role="none" className={`group/mode-row flex min-h-9 items-center gap-1 overflow-hidden rounded-lg transition-colors hover:bg-[var(--bd-read-page-bg)] ${mode.id === selectedAssistantMode.id ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'text-current'}`}>
                <button type="button" role="menuitemradio" aria-checked={mode.id === selectedAssistantMode.id} onClick={() => selectAssistantMode(mode)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--bd-read-primary)]">
                  <span className="min-w-0 flex-1 truncate">{mode.name}</span>
                </button>
                <button type="button" role="menuitem" aria-label={`编辑模式 ${mode.name}`} title="编辑模式" onClick={(event) => { event.stopPropagation(); openAssistantModeForm(mode) }} className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-black/5 hover:text-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] dark:hover:bg-white/10">
                  {mode.id === selectedAssistantMode.id ? <><span className="group-hover/mode-row:hidden group-focus-within/mode-row:hidden"><CheckIcon /></span><span className="hidden group-hover/mode-row:inline-flex group-focus-within/mode-row:inline-flex"><EditIcon /></span></> : <EditIcon />}
                </button>
              </div>)}
              <div className="mt-1 border-t border-[var(--bd-read-accent)] pt-1">
                <button type="button" role="menuitem" onClick={() => openAssistantModeForm()} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-[var(--bd-read-primary)] transition-colors hover:bg-[var(--bd-read-page-bg)]">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  <span>添加模式</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <button type="button" onClick={cycleReadingScope} aria-label={`阅读范围：${readingScopeLabel(readingScope)}，点击切换`} title={`阅读范围：${readingScopeLabel(readingScope)}，点击切换`} className={`ml-2 flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-500/10 @max-[240px]/ai-panel:ml-1 ${readingScope === 'full_book' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'text-[var(--bd-read-sub)] hover:text-current'}`}>
          <ReadingScopeIcon scope={readingScope} />
        </button>
        <div className="ml-auto flex items-center gap-2 text-[var(--bd-read-sub)] @max-[240px]/ai-panel:gap-1">
          <button type="button" onClick={startNewChat} disabled={streaming} aria-label="新建对话" title="新建对话" className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button ref={historyButtonRef} type="button" onClick={() => { if (!streaming) { setAttachmentOpen(false); setToolsOpen(false); setMoreOpen(false); setHistoryOpen((open) => !open) } }} disabled={streaming} aria-label={_('reader.aiHistory')} title={_('reader.aiHistory')} aria-expanded={historyOpen} className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40 ${historyOpen ? 'bg-stone-500/10 text-current' : ''}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 5v4h4M12 7v5l3 2" /></svg>
          </button>
          <button ref={moreButtonRef} type="button" onClick={() => { setHistoryOpen(false); setModelMenuOpen(false); setAttachmentOpen(false); setToolsOpen(false); setMoreOpen(!moreOpen) }} aria-label="更多" title="更多" aria-expanded={moreOpen} className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current ${moreOpen ? 'bg-stone-500/10 text-current' : ''}`}>
            <MoreIcon />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {messages.length > 0 ? (
          <div className={`${READ_SCROLLBAR_CLASSES} min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 pr-5`}>
            {messages.map((message, index) => {
              const quoteContext = message.role === 'user' ? message.retry?.context : null
              const quoteChapterTitle = quoteContext?.chapterTitle || (quoteContext && chapters[quoteContext.chapterIndex]?.title) || ''
              const quoteTarget = quoteContext && quoteContext.cfiRange !== 'selection' ? quoteContext.cfiRange : quoteContext ? `chapter:${quoteContext.chapterIndex}` : ''
              const quoteEntries = quoteContext ? [
                ...(quoteContext.selection.trim() ? [{ id: 'selection', label: `${quoteChapterTitle || '当前章节'} · 选中文本`, text: quoteContext.selection.trim(), target: quoteTarget }] : []),
                ...(quoteContext.chapterReferences ?? []).map((reference) => ({
                  id: `chapter-${reference.chapterIndex}`,
                  label: reference.chapterTitle || chapters[reference.chapterIndex]?.title || `第 ${reference.chapterIndex + 1} 章`,
                  text: reference.text.trim(),
                  target: `chapter:${reference.chapterIndex}`,
                })),
              ] : []
              const hasBasis = message.role === 'assistant' && message.citations.length > 0
              const quoteOpen = openQuoteId === message.id
              const basisOpen = openBasisId === message.id
              const showStreamStatus = message.role === 'assistant' && !message.content && streaming && index === messages.length - 1
              return (
                <div key={message.id} className={`group flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={message.role === 'user' ? 'w-fit max-w-[85%] break-words rounded-xl bg-[var(--bd-read-accent)]/20 p-3 text-sm' : 'w-fit max-w-[92%] break-words rounded-xl bg-[var(--bd-read-page-bg)] p-3 text-sm'}>
                    {quoteEntries.length > 0 && <div className="mb-2 w-full text-[11px] text-[var(--bd-read-sub)]">
                      <button type="button" aria-expanded={quoteOpen} aria-controls={`message-quotes-${message.id}`} onClick={() => setOpenQuoteId(quoteOpen ? null : message.id)} className="flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current">
                        <span>引用 · {quoteEntries.length} 条</span>
                        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${quoteOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                      </button>
                      {quoteOpen && <div id={`message-quotes-${message.id}`} className="mt-2 space-y-1 rounded-lg bg-stone-500/5 p-2">
                        {quoteEntries.map((entry, entryIndex) => <button key={entry.id} type="button" disabled={!renderer} onClick={() => jumpToQuote(entry.target)} title={entry.text} aria-label={`跳转到引用 ${entryIndex + 1}: ${entry.label}`} className="flex min-h-9 w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current disabled:cursor-default disabled:opacity-70">
                          <span className="shrink-0 pt-0.5">{entryIndex + 1}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-current">{entry.label}</span><span className="block max-h-10 overflow-hidden leading-relaxed">{entry.text}</span></span>
                        </button>)}
                      </div>}
                    </div>}
                    {message.content ? (message.role === 'assistant' ? <MarkdownText content={message.content} citations={message.citations} onCitationClick={jumpToCitation} /> : <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</div>) : showStreamStatus ? <div className="flex min-h-5 items-center gap-2 text-[var(--bd-read-sub)]" role="status" aria-label={toolStatus ?? '正在思考…'}>
                      {toolStatus ? <span>{toolStatus}</span> : <span className="flex items-center gap-1" aria-hidden="true">
                        {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${dot * 140}ms` }} />)}
                      </span>}
                    </div> : null}
                  {hasBasis && (
                    <div className="mt-3 text-[11px] text-[var(--bd-read-sub)]">
                      <button type="button" aria-expanded={basisOpen} aria-controls={`answer-basis-${message.id}`} onClick={() => setOpenBasisId(basisOpen ? null : message.id)} className="flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current">
                        <span>依据 · {message.citations.length} 条</span>
                        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${basisOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                      </button>
                      {basisOpen && <div id={`answer-basis-${message.id}`} className="mt-2 space-y-3 rounded-lg bg-stone-500/5 p-2.5">
                        <div>
                          <p className="mb-1 font-medium text-current">书籍依据</p>
                          <div className="space-y-1">
                            {message.citations.map((citation, citationIndex) => <button key={`${citation.id}-${citationIndex}`} type="button" disabled={!renderer} onClick={() => jumpToCitation(citation)} title={citation.excerpt} aria-label={`跳转到依据 ${citationIndex + 1}: ${citation.sourceType === 'annotation' ? citation.chapterTitle || '笔记' : citation.chapterTitle || `第 ${citation.chapterIndex + 1} 章`}`} className="flex min-h-9 w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current disabled:cursor-default disabled:opacity-70">
                              <span className="shrink-0 pt-0.5">{citationIndex + 1}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium text-current">{citation.sourceType === 'annotation' ? citation.chapterTitle || '笔记' : citation.chapterTitle || `第 ${citation.chapterIndex + 1} 章`}</span><span className="block max-h-10 overflow-hidden leading-relaxed">{citation.excerpt}</span></span>
                            </button>)}
                          </div>
                        </div>
                      </div>}
                    </div>
                  )}
                  {message.aborted && <div className="mt-2 text-[11px] text-[var(--bd-read-sub)]">已停止</div>}
                  </div>
                  {message.role === 'assistant' && message.content && !streaming && (
                    <div className="mt-1 flex items-center gap-1 pl-2 text-[var(--bd-read-sub)] opacity-100 transition-opacity [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:pointer-events-auto [@media(hover:hover)]:group-focus-within:opacity-100">
                      <button type="button" onClick={() => void copyAssistantMessage(message.id, message.content)} aria-label={copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')} title={copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')} className={`flex h-7 w-7 items-center justify-center rounded transition-colors active:scale-95 ${copiedMessageId === message.id ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'hover:bg-[var(--bd-read-page-bg)] hover:text-current'}`}>{copiedMessageId === message.id ? <CheckIcon /> : <CopyIcon />}</button>
                      {message.ideaTarget && !message.aborted && <button type="button" onClick={() => void saveAssistantAsIdea(message)} disabled={message.savedAsIdea || createAnnotation.isPending} aria-label={message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')} title={message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current disabled:cursor-default disabled:opacity-60"><BulbIcon size={14} /></button>}
                      {retryRequest && index === messages.length - 1 && <button type="button" onClick={() => void runRequest(retryRequest, true)} aria-label="重试" title="重试" className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current"><RetryIcon /></button>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]"><ChatIcon /></div>
            <p className="text-base font-normal text-current">开始与 AI 对话</p>
          </div>
        )}

        <div className="shrink-0 px-3 pb-3 pt-3">
          <form ref={composerFormRef} className="relative w-full @container/composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
            {attachmentOpen && (
              <aside ref={attachmentRef} data-testid="ai-attachment-menu" aria-label="添加章节引用" className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[min(360px,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
                <h3 className="border-b border-[var(--bd-read-accent)] px-3 py-3 text-sm font-medium text-current">添加章节引用</h3>
                {chaptersQuery.isFetching && chapters.length === 0 ? <p className="px-3 py-5 text-center text-xs text-[var(--bd-read-sub)]">正在读取目录…</p> : chapters.length === 0 ? <p className="px-3 py-5 text-center text-xs text-[var(--bd-read-sub)]">暂时没有可添加的章节</p> : <ul className={`${READ_SCROLLBAR_CLASSES} min-h-0 space-y-1 overflow-y-auto overscroll-contain p-1.5`}>
                  {visibleChapterReferenceNodes.map((node) => {
                    const chapter = chapters[node.index]!
                    const chapterIndex = node.index
                    const selected = selectedChapterReferences.includes(chapterIndex)
                    const collapsed = collapsedChapterReferences.has(chapterIndex)
                    return <li key={chapter.id} style={{ paddingLeft: `${node.depth * 0.75}rem` }}><div className={`flex min-h-9 items-center rounded-lg transition-colors ${selected ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'text-current hover:bg-[var(--bd-read-page-bg)]'}`}>
                      {node.hasChildren ? <button type="button" onClick={() => toggleChapterReferenceGroup(chapterIndex)} aria-label={`${collapsed ? '展开' : '折叠'} ${chapter.title}`} title={collapsed ? '展开' : '折叠'} className="flex h-9 w-7 shrink-0 items-center justify-center text-[var(--bd-read-sub)] hover:text-current">
                        <svg className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                      </button> : <span className="w-7 shrink-0" />}
                      <button type="button" aria-pressed={selected} title={chapter.title} onClick={() => toggleChapterReference(chapterIndex)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 pr-2.5 text-left text-sm">
                        <span className="shrink-0 text-[var(--bd-read-sub)]"><ChapterReferenceIcon /></span><span className="min-w-0 flex-1 truncate">{chapter.title}</span>{selected && <CheckIcon />}
                      </button>
                    </div></li>
                  })}
                </ul>}
                {readingScope !== 'full_book' && chapterIndex >= 0 && selectedChapterReferences.some((referenceIndex) => referenceIndex > chapterIndex) && <p className="border-t border-[var(--bd-read-accent)] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">后续章节只作为本次附件，AI 自动读取仍受当前范围限制。</p>}
              </aside>
            )}
            {toolsOpen && (
              <aside ref={toolsRef} data-testid="ai-tools-menu" aria-label="工具" className="absolute bottom-full left-0 z-30 mb-2 w-full overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
                <h3 className="border-b border-[var(--bd-read-accent)] px-3 py-3 text-sm font-medium text-current">工具</h3>
                <ul className="divide-y divide-[var(--bd-read-accent)]/60 px-2 py-1">
                  {AI_PERMISSION_OPTIONS.map((option) => {
                    const enabled = option.toolNames.every((name) => enabledTools.includes(name))
                    return <li key={option.id} className="flex items-center gap-3 px-1 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-current">{option.label}</p>
                        <p className="mt-0.5 truncate text-[11px] text-[var(--bd-read-sub)]">{option.description}</p>
                      </div>
                      <button type="button" role="switch" aria-checked={enabled} aria-label={option.label} onClick={() => togglePermission(option.toolNames)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[var(--bd-read-primary)]' : 'bg-[var(--bd-read-accent)]'}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] shadow-sm transition-transform ${enabled ? 'left-4' : 'left-0.5'}`} />
                      </button>
                    </li>
                  })}
                </ul>
              </aside>
            )}
            <div className="rounded-xl border border-stone-300/80 bg-stone-500/5 px-3 pb-1.5 pt-2 shadow-sm @max-[280px]/composer:px-2 dark:border-stone-700/80">
              {(selection || selectedChapterReferences.length > 0) && <div className={`${READ_SCROLLBAR_CLASSES} mb-1 flex gap-1 overflow-x-auto pb-1`}>
                {selection && <span className="flex h-7 max-w-48 shrink-0 items-center gap-1 rounded-md border border-[var(--bd-read-primary)]/50 bg-[var(--bd-read-primary)]/10 pl-2 pr-1 text-xs text-[var(--bd-read-primary)]">
                  <SelectedPositionIcon size={14} />
                  <span className="min-w-0 flex-1 truncate" title={selection}>{selectionPreview}</span>
                  <button type="button" onClick={() => setAiContext(null)} aria-label="移除选中文本" title="移除选中文本" className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bd-read-primary)]/10"><CloseIcon /></button>
                </span>}
                {selectedChapterReferences.map((referenceIndex) => {
                  const title = chapters[referenceIndex]?.title ?? `第 ${referenceIndex + 1} 章`
                  return <span key={referenceIndex} className="flex h-7 max-w-48 shrink-0 items-center gap-1 rounded-md border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] pl-2 pr-1 text-xs text-current">
                    <ChapterReferenceIcon />
                    <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
                    <button type="button" onClick={() => toggleChapterReference(referenceIndex)} aria-label={`移除章节附件 ${title}`} title={`移除章节附件 ${title}`} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"><CloseIcon /></button>
                  </span>
                })}
              </div>}
              <textarea ref={promptTextareaRef} value={prompt} onChange={(event) => { const value = event.target.value; promptEditRevisionRef.current += 1; setPrompt(value); const slashOpen = value.startsWith('/'); setQuickCommandMenuOpen(slashOpen); if (slashOpen) { setAttachmentOpen(false); setToolsOpen(false) } }} onKeyDown={handlePromptKeyDown} rows={2} placeholder="输入消息…" className={`${READ_SCROLLBAR_CLASSES} min-h-12 max-h-36 w-full resize-none overflow-y-hidden overscroll-contain bg-transparent text-sm leading-relaxed text-current outline-none placeholder:text-[var(--bd-read-sub)]`} />
              {quickCommandMenuOpen && slashQuery !== null && (
                <div ref={quickCommandMenuRef} role="menu" aria-label="快捷指令" data-testid="ai-quick-command-menu" className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[min(360px,calc(100vh-4rem))] w-full flex-col overflow-y-auto rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 shadow-xl">
                  {visibleQuickCommands.length > 0 ? visibleQuickCommands.map((command) => (
                    <button key={command.id} type="button" role="menuitem" aria-selected={command.id === visibleQuickCommands[quickCommandIndex]?.id} onClick={() => applyQuickCommand(command)} className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-current transition-colors hover:bg-[var(--bd-read-page-bg)] ${command.id === visibleQuickCommands[quickCommandIndex]?.id ? 'bg-[var(--bd-read-page-bg)]' : ''}`}>
                      <span className="min-w-0 flex-1 truncate">{command.name}</span>
                    </button>
                  )) : <div className="flex min-h-14 items-start gap-2 px-2.5 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-stone-500/10 text-xs text-[var(--bd-read-sub)]">/</span>
                    <div className="min-w-0"><p className="truncate text-sm text-current">{quickCommands.length === 0 ? _('reader.aiQuickCommandsEmpty') : _('reader.aiQuickCommandsNoMatch', { query: slashQuery })}</p>{quickCommands.length > 0 && <p className="mt-0.5 text-[11px] text-[var(--bd-read-sub)]">{_('reader.aiQuickCommandsNoMatchHint')}</p>}</div>
                  </div>}
                </div>
              )}
              <div data-testid="ai-composer-footer" className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1 text-[var(--bd-read-sub)] @max-[280px]/composer:gap-x-0.5">
                <div className="flex shrink-0 items-center gap-0.5 @max-[240px]/composer:gap-0">
                  <button ref={attachmentButtonRef} type="button" onClick={() => { setAttachmentOpen((open) => !open); setToolsOpen(false); setMoreOpen(false); setQuickCommandMenuOpen(false); setAssistantModeMenuOpen(false); setModelMenuOpen(false) }} aria-label="添加章节引用" aria-haspopup="dialog" aria-expanded={attachmentOpen} title="添加章节引用" className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-500/10 hover:text-current ${attachmentOpen ? 'bg-stone-500/10' : ''}`}>
                    <AttachmentIcon />
                  </button>
                  <button ref={toolsButtonRef} type="button" onClick={() => { setToolsOpen((open) => !open); setAttachmentOpen(false); setMoreOpen(false); setQuickCommandMenuOpen(false); setAssistantModeMenuOpen(false); setModelMenuOpen(false) }} aria-label="工具" aria-haspopup="dialog" aria-expanded={toolsOpen} title="工具" className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-500/10 hover:text-current ${toolsOpen ? 'bg-stone-500/10' : ''}`}>
                    <ToolsIcon />
                  </button>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1 @max-[240px]/composer:order-first @max-[240px]/composer:mb-1 @max-[240px]/composer:w-full @max-[240px]/composer:basis-full @max-[240px]/composer:gap-0.5">
                  <div ref={modelMenuRef} className="relative min-w-0 max-w-48 flex-1 @max-[240px]/composer:max-w-none">
                  <button
                    type="button"
                    aria-label="选择模型"
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    title={selectedModelLabel}
                    disabled={!modelReady || modelOptions.length < 2 || updateAiConfig.isPending}
                    ref={modelButtonRef}
                    onClick={() => { setAttachmentOpen(false); setToolsOpen(false); setAssistantModeMenuOpen(false); setQuickCommandMenuOpen(false); setMoreOpen(false); setModelMenuOpen((open) => !open) }}
                    className={`flex min-w-0 w-full max-w-full items-center gap-0.5 rounded py-0.5 pr-1 text-xs text-current outline-none transition-colors hover:bg-stone-500/10 focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:cursor-not-allowed disabled:text-[var(--bd-read-sub)] ${modelMenuOpen ? 'bg-stone-500/10' : ''}`}
                  >
                    {modelReady && <AiBrandIcon name={selectedModel?.name ?? statusQuery.data?.data.model} model={selectedModel} provider={statusQuery.data?.data.provider} className="h-5 w-5 shrink-0 @max-[280px]/composer:hidden" />}
                    <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
                    <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                  </button>
                  {modelMenuOpen && modelOptions.length > 1 && modelMenuPosition && createPortal(
                    <div ref={modelMenuPopupRef} role="listbox" aria-label="选择模型" className={`${READ_SCROLLBAR_CLASSES} fixed z-[70] max-h-52 min-w-56 w-max max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1 shadow-xl`} style={modelMenuPosition}>
                      {modelOptions.map((model) => {
                        const label = model.name === model.id ? model.id : `${model.name} · ${model.id}`
                        const selected = model.id === statusQuery.data?.data.model
                        return (
                          <button
                            key={model.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            title={label}
                            onClick={() => {
                              selectModel(model.id)
                              setModelMenuOpen(false)
                            }}
                            className={`flex h-9 min-w-0 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm transition-colors hover:bg-[var(--bd-read-page-bg)] ${selected ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'text-[var(--bd-read-text)]'}`}
                          >
                            <AiBrandIcon name={model.name} model={model} className="h-5 w-5" />
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {selected && <span className="ml-2 shrink-0 text-[var(--bd-read-primary)]"><CheckIcon /></span>}
                          </button>
                        )
                      })}
                    </div>,
                    document.body,
                  )}
                  </div>
                </div>
                {streaming ? <button type="button" onClick={stop} aria-label="停止生成" title="停止生成" className="ml-auto shrink-0 rounded-full p-1.5 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"><StopIcon /></button> : <button type="submit" disabled={!canSend} aria-label="发送" title="发送" className="ml-auto shrink-0 rounded-full p-1.5 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-35"><SendIcon /></button>}
              </div>
            </div>
          </form>
        </div>
      </div>
      {moreOpen && (
        <aside ref={moreRef} data-testid="ai-more-menu" aria-label="更多" className="absolute right-2 top-12 z-20 flex max-h-[min(360px,calc(100vh-5rem))] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-2 shadow-xl">
          <section>
            <h3 className="px-2 py-2 text-xs font-medium text-current">书内索引</h3>
            <div className="px-2 pb-2 text-[11px] leading-relaxed text-[var(--bd-read-sub)]">建立后，AI 才能搜索当前书的正文内容。</div>
            {embeddingConfigMismatch && <p className="px-2 pb-2 text-xs text-[var(--bd-read-sub)]">{_('reader.aiEmbeddingStale')}</p>}
            {visibleCorpusMismatch && <p className="px-2 pb-2 text-xs text-[var(--bd-read-sub)]">{_('reader.aiCorpusStale')}</p>}
            {indexStatus === 'indexing' && <div className="px-2 pb-2 text-xs text-[var(--bd-read-sub)]">
              <div className="flex items-center justify-between gap-2">
                <span>{_(indexQuery.data?.data.embeddingStatus === 'indexing' ? 'reader.aiEmbeddingProgress' : 'reader.aiIndexProgress', { progress: indexQuery.data?.data.progress ?? 0 })}</span>
                <span>{indexQuery.data?.data.progress ?? 0}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-500/10"><div className="h-full rounded-full bg-current transition-[width]" style={{ width: `${Math.max(0, Math.min(100, indexQuery.data?.data.progress ?? 0))}%` }} /></div>
            </div>}
            {(indexActionVisible || (indexStatus !== 'not_indexed' && indexStatus !== 'indexing' && indexStatus !== undefined)) && <div className="flex items-center gap-2 px-2 pb-2">
              {indexActionVisible && <button type="button" onClick={indexStatus === 'indexing' || indexBook.isPending || preparingIndex ? cancelBookIndex : () => void buildBookIndex()} disabled={cancelIndex.isPending || clearIndex.isPending} className="min-w-0 flex-1 rounded-md border border-[var(--bd-read-accent)] px-2.5 py-2 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{indexActionLabel}</button>}
              {indexStatus !== 'not_indexed' && indexStatus !== 'indexing' && indexStatus !== undefined && <button type="button" onClick={() => setClearIndexOpen(true)} disabled={clearIndex.isPending} className="rounded-md px-2.5 py-2 text-xs text-[var(--bd-read-sub)] underline underline-offset-2 transition-colors hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{_('reader.aiIndexClear')}</button>}
            </div>}
          </section>
          <section className="border-t border-[var(--bd-read-accent)] pt-2">
            <button type="button" onClick={() => { exportConversation(); setMoreOpen(false) }} disabled={messages.length === 0} aria-label={_('reader.aiExport')} title={_('reader.aiExport')} className="flex min-h-10 w-full items-center rounded-lg border border-transparent px-3 text-left text-sm text-[var(--bd-read-sub)] transition-colors hover:border-[var(--bd-read-accent)] hover:bg-stone-500/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">
              <DownloadIcon />
              <span className="ml-3 min-w-0 flex-1 truncate">{_('reader.aiExport')}</span>
              <svg className="ml-3 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
          </section>
        </aside>
      )}
      {historyOpen && (
        <aside ref={historyRef} data-testid="ai-history" className="absolute right-2 top-12 z-20 flex max-h-[min(360px,calc(100vh-5rem))] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-2 shadow-xl">
          {threadsQuery.isFetching && historyThreads.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.loading')}</p> : historyThreads.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.aiHistoryEmpty')}</p> : (
            <ul className={`${READ_SCROLLBAR_CLASSES} min-h-0 overflow-y-auto overscroll-contain`}>
              {historyThreads.map((thread) => {
                const createdAt = new Date(thread.createdAt)
                const now = new Date()
                const isToday = createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth() && createdAt.getDate() === now.getDate()
                const timeLabel = isToday
                  ? createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : createdAt.toLocaleDateString('zh-CN')
                return (
                <li key={thread.id} className={`group rounded-lg p-1 transition-colors hover:bg-stone-500/5 ${thread.id === threadId ? 'bg-[var(--bd-read-page-bg)]' : ''}`}>
                  {renameThreadId === thread.id ? (
                    <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); submitRename(thread) }}>
                      <input autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} maxLength={100} aria-label={_('reader.aiRenamePlaceholder')} className="min-w-0 flex-1 rounded border border-[var(--bd-read-accent)] bg-transparent px-2 py-1 text-sm outline-none" />
                      <button type="submit" disabled={renameThread.isPending} aria-label={_('reader.aiSave')} title={_('reader.aiSave')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-current hover:bg-[var(--bd-read-page-bg)] disabled:cursor-not-allowed disabled:opacity-50">
                        <CheckIcon />
                      </button>
                      <button type="button" onClick={() => setRenameThreadId(null)} aria-label={_('reader.aiCancel')} title={_('reader.aiCancel')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-[var(--bd-read-page-bg)] hover:text-current">
                        <CloseIcon />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => selectThread(thread.id)} className="min-w-0 flex-1 rounded-md px-2 py-1 text-left">
                        <span className="block truncate text-sm text-current">{thread.title}</span>
                        <span className="mt-0.5 block text-[11px] text-[var(--bd-read-sub)]">{timeLabel} · {thread.messageCount} {_(thread.messageCount === 1 ? 'reader.aiMessageOne' : 'reader.aiMessageMany')}</span>
                      </button>
                      <button type="button" onClick={() => beginRename(thread)} aria-label={`${_('reader.aiRename')} ${thread.title}`} title={_('reader.aiRename')} className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center rounded p-1 text-[var(--bd-read-sub)] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-[var(--bd-read-page-bg)] hover:text-current focus-visible:pointer-events-auto focus-visible:opacity-100">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m4 16 9.5-9.5a2.1 2.1 0 0 1 3 3L7 19H4v-3Z" /><path d="m13.5 7.5 3 3" /></svg>
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(thread)} aria-label={`${_('reader.aiDelete')} ${thread.title}`} title={_('reader.aiDelete')} className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center rounded p-1 text-[var(--bd-read-sub)] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-red-500/10 hover:text-red-600 focus-visible:pointer-events-auto focus-visible:opacity-100">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                      </button>
                    </div>
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </aside>
      )}
      {assistantModeForm && <Modal title={assistantModeForm.id ? '编辑模式' : '添加模式'} variant="reader" onClose={() => setAssistantModeForm(null)}>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); submitAssistantMode() }}>
          <label className="flex flex-col gap-1 text-xs text-[var(--bd-read-sub)]">
            <span>模式名称</span>
            <input required autoFocus maxLength={80} value={assistantModeForm.name} onChange={(event) => setAssistantModeForm({ ...assistantModeForm, name: event.target.value })} placeholder="例如：严谨书评人" className="h-10 rounded-lg border border-[var(--bd-read-accent)] bg-transparent px-3 text-sm text-current outline-none focus:border-[var(--bd-read-primary)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--bd-read-sub)]">
            <span>系统提示词</span>
            <textarea required maxLength={2_000} rows={6} value={assistantModeForm.prompt} onChange={(event) => setAssistantModeForm({ ...assistantModeForm, prompt: event.target.value })} placeholder="定义 AI 的角色和回答方式…" className="resize-y rounded-lg border border-[var(--bd-read-accent)] bg-transparent px-3 py-2 text-sm leading-5 text-current outline-none focus:border-[var(--bd-read-primary)]" />
          </label>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--bd-read-accent)] pt-4">
            {assistantModeForm.id === DEFAULT_ASSISTANT_MODE.id
              ? <button type="button" onClick={requestRestoreAssistantMode} disabled={updateAiConfig.isPending} className="rounded-lg border border-[var(--bd-read-accent)] px-4 py-2 text-sm text-[var(--bd-read-primary)] transition-colors hover:bg-[var(--bd-read-page-bg)] disabled:cursor-not-allowed disabled:opacity-50">恢复默认</button>
              : assistantModeForm.id ? <button type="button" onClick={requestDeleteAssistantMode} disabled={updateAiConfig.isPending} className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-700 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300">删除</button> : <span />}
           <div className="flex gap-2">
              <button type="button" onClick={() => setAssistantModeForm(null)} className="rounded-lg border border-[var(--bd-read-accent)] px-4 py-2 text-sm text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)]">取消</button>
              <button type="submit" disabled={!assistantModeForm.name.trim() || !assistantModeForm.prompt.trim() || updateAiConfig.isPending} className="rounded-lg bg-[var(--bd-read-primary)] px-4 py-2 text-sm text-[var(--bd-read-bg)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40">保存</button>
            </div>
          </div>
        </form>
      </Modal>}
      {deleteTarget && <ConfirmDialog message={_('reader.aiDeleteConfirm')} onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />}
      {assistantModeDeleteTarget && <ConfirmDialog message={`确定删除助理模式“${assistantModeDeleteTarget.name}”吗？`} confirmLabel="删除" onConfirm={confirmDeleteAssistantMode} onClose={() => setAssistantModeDeleteTarget(null)} />}
      {assistantModeRestoreOpen && <ConfirmDialog message="确定恢复默认助理模式吗？" confirmLabel="恢复默认" onConfirm={confirmRestoreAssistantMode} onClose={() => setAssistantModeRestoreOpen(false)} />}
      {clearIndexOpen && <ConfirmDialog message={_('reader.aiIndexClearConfirm')} onConfirm={confirmClearIndex} onClose={() => setClearIndexOpen(false)} />}
    </div>
  )
}
