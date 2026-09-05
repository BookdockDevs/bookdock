import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { AI_TOOL_NAMES, isAiEmbeddingModel } from '@bookdock/shared'
import type { AiAssistantMode, AiChapterReference, AiChatReq, AiCitation, AiContextReceipt, AiHistoryMessage, AiMessageRes, AiPromptTemplate, AiStatusRes, AiThreadRes, AiToolName } from '@bookdock/shared'

import { apiGet, apiStreamAiChat, ApiError } from '@/api/client'
import { AI_THREADS_KEY, useAiIndexStatus, useAiThread, useAiThreads, useCancelAiBookIndex, useClearAiBookIndex, useDeleteAiThread, useIndexAiBook, useUpdateAiConfig, useUpdateAiThread } from '@/api/hooks/useAi'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import Modal from '@/components/ui/Modal'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserDisplayName, useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useBookChapters } from '../hooks/useBookChapters'
import { useCreateAnnotation } from '../hooks/useAnnotations'
import { useReaderState } from '../state/reader-state'
import { BulbIcon, CheckIcon, CloseIcon, SelectedPositionIcon } from './annotation-icons'

interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  context: AiContextReceipt | null
  aborted: boolean
  citations: AiCitation[]
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
  assistantModePrompt?: string
}

interface AssistantModeForm {
  name: string
  prompt: string
}

const DEFAULT_ASSISTANT_MODE: AiAssistantMode = { id: 'assistant', name: '助理', prompt: '', builtIn: true }
const COMPOSER_MIN_HEIGHT = 48
const COMPOSER_MAX_HEIGHT = 144
const READ_SCROLLBAR_CLASSES = '[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--bd-read-sub)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--bd-read-sub)]/50'

const AI_TOOL_OPTIONS: ReadonlyArray<{ id: AiToolName; label: string; description: string }> = [
  { id: 'get_book_toc', label: '查看目录', description: '了解本书的章节结构' },
  { id: 'get_chapter_content', label: '读取章节正文', description: '按需读取章节内容' },
  { id: 'search_book', label: '搜索本书', description: '检索已建立索引的正文' },
  { id: 'search_notes', label: '读取我的笔记', description: '搜索当前书的笔记、划线和书签' },
]

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
    savedAsIdea: false,
  }
}

function PaperclipIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m20.5 11.5-8.9 8.9a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  )
}

function ChapterReferenceIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
    </svg>
  )
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
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h5M15 6h5M4 12h9M19 12h1M4 18h2M12 18h8" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="9" cy="18" r="2" />
    </svg>
  )
}

function renderInline(value: string): ReactNode[] {
  const tokenPattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g
  return value.split(tokenPattern).map((part, index) => {
    if (!part) return null
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{link[1]}</a>
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-stone-500/10 px-1 py-0.5 text-[.9em]">{part.slice(1, -1)}</code>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={index}>{part.slice(1, -1)}</em>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function MarkdownText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/)
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const lines = block.split('\n')
        const heading = lines.length === 1 ? lines[0]?.match(/^#{1,3}\s+(.+)$/) : null
        if (heading) return <p key={index} className="font-medium">{renderInline(heading[1] ?? '')}</p>
        if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={index} className="list-disc space-y-1 pl-5">{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>
        }
        return <p key={index}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line)}</Fragment>)}</p>
      })}
    </div>
  )
}

export default function AiPanel({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const aiContext = useReaderState((s) => s.aiContext)
  const setAiContext = useReaderState((s) => s.setAiContext)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const { renderer } = useReaderApi()
  const createAnnotation = useCreateAnnotation(bookId)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AiThreadRes | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelMenuPosition, setModelMenuPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [chapterMenuOpen, setChapterMenuOpen] = useState(false)
  const [assistantModeMenuOpen, setAssistantModeMenuOpen] = useState(false)
  const [assistantModeForm, setAssistantModeForm] = useState<AssistantModeForm | null>(null)
  const [assistantModes, setAssistantModes] = useState<AiAssistantMode[]>([DEFAULT_ASSISTANT_MODE])
  const [selectedAssistantModeId, setSelectedAssistantModeId] = useState(DEFAULT_ASSISTANT_MODE.id)
  const [selectedChapterReferences, setSelectedChapterReferences] = useState<number[]>([])
  const [preparingReferences, setPreparingReferences] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [enabledTools, setEnabledTools] = useState<AiToolName[]>(() => [...AI_TOOL_NAMES])
  const [retryRequest, setRetryRequest] = useState<AiRequest | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [clearIndexOpen, setClearIndexOpen] = useState(false)
  const [preparingIndex, setPreparingIndex] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const indexAbortRef = useRef<AbortController | null>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const modelMenuPopupRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const chapterMenuRef = useRef<HTMLFormElement>(null)
  const assistantModeMenuRef = useRef<HTMLDivElement>(null)
  const assistantModesInitializedRef = useRef(false)
  const toolsRef = useRef<HTMLElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const copiedMessageTimerRef = useRef<number | null>(null)
  const requestGenerationRef = useRef(0)

  const threadsQuery = useAiThreads(bookId)
  const threadQuery = useAiThread(threadId, { enabled: !streaming })
  const indexQuery = useAiIndexStatus(bookId)
  const indexBook = useIndexAiBook()
  const cancelIndex = useCancelAiBookIndex()
  const clearIndex = useClearAiBookIndex()
  const updateAiConfig = useUpdateAiConfig()
  const renameThread = useUpdateAiThread()
  const deleteThread = useDeleteAiThread()
  const chaptersQuery = useBookChapters(bookId)

  const statusQuery = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => apiGet<{ data: AiStatusRes }>('/ai/status'),
  })

  useEffect(() => () => {
    abortRef.current?.abort()
    indexAbortRef.current?.abort()
  }, [])
  useEffect(() => {
    requestGenerationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    indexAbortRef.current?.abort()
    indexAbortRef.current = null
    setPreparingIndex(false)
    setThreadId(null)
    setMessages([])
    setStreaming(false)
    setToolStatus(null)
    setHistoryOpen(false)
    setChapterMenuOpen(false)
    setAssistantModeMenuOpen(false)
    setAssistantModeForm(null)
    setToolsOpen(false)
    setEnabledTools([...AI_TOOL_NAMES])
    setSelectedAssistantModeId(DEFAULT_ASSISTANT_MODE.id)
    setSelectedChapterReferences([])
    setPreparingReferences(false)
    setRenameThreadId(null)
    setDeleteTarget(null)
    setClearIndexOpen(false)
  }, [bookId])
  useEffect(() => {
    if (streaming || !threadId || threadQuery.data?.data.id !== threadId) return
    setMessages(threadQuery.data.data.messages.map(fromPersistedMessage))
    setRetryRequest(null)
  }, [streaming, threadId, threadQuery.data])
  useEffect(() => {
    setRetryRequest(null)
  }, [aiContext?.cfiRange])
  useEffect(() => {
    const modes = statusQuery.data?.data.modes
    if (!assistantModesInitializedRef.current && Array.isArray(modes)) {
      setAssistantModes(modes.length > 0 ? modes : [DEFAULT_ASSISTANT_MODE])
      assistantModesInitializedRef.current = true
    }
  }, [statusQuery.data?.data.modes])
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
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', closeIfOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', closeIfOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [modelMenuOpen])
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
  const chapters = Array.isArray(chaptersQuery.data?.data) ? chaptersQuery.data.data : []
  const canSend = modelReady && Boolean(prompt.trim()) && !streaming && !preparingReferences
  useDismissiblePopup(chapterMenuOpen, chapterMenuRef, () => setChapterMenuOpen(false))
  useDismissiblePopup(assistantModeMenuOpen, assistantModeMenuRef, () => setAssistantModeMenuOpen(false))
  const fallbackQuickActions = useMemo(() => selection ? [
    { label: _('reader.aiQuickExplain'), prompt: _('reader.aiQuickExplainPrompt') },
    { label: _('reader.aiQuickTranslate'), prompt: _('reader.aiQuickTranslatePrompt') },
    { label: _('reader.aiQuickSummarize'), prompt: _('reader.aiQuickSummarizePrompt') },
    { label: _('reader.aiQuickQuestions'), prompt: _('reader.aiQuickQuestionsPrompt') },
  ] : [
    { label: _('reader.aiQuickChapterSummary'), prompt: _('reader.aiQuickChapterSummaryPrompt') },
    { label: _('reader.aiQuickReadToHere'), prompt: _('reader.aiQuickReadToHerePrompt') },
  ], [selection, _])
  const quickActions = useMemo(() => {
    const configured = statusQuery.data?.data.prompts
    if (!configured) return fallbackQuickActions
    const scope = selection ? 'selection' : 'reading'
    return configured
      .filter((item: AiPromptTemplate) => item.enabled && (item.scope === scope || item.scope === 'both'))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((item) => ({ label: item.name, prompt: item.prompt }))
  }, [fallbackQuickActions, selection, statusQuery.data?.data.prompts])
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
    setThreadId(null)
    setMessages([])
    setRetryRequest(null)
    setToolStatus(null)
    setPrompt('')
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
    setRetryRequest(null)
    setHistoryOpen(false)
  }

  function toggleTool(toolName: AiToolName) {
    if (streaming) return
    setEnabledTools((current) => current.includes(toolName) ? current.filter((name) => name !== toolName) : [...current, toolName])
  }

  function toggleChapterReference(chapterIndex: number) {
    if (streaming) return
    setSelectedChapterReferences((current) => current.includes(chapterIndex) ? current.filter((index) => index !== chapterIndex) : [...current, chapterIndex])
  }

  function selectAssistantMode(mode: AiAssistantMode) {
    if (streaming) return
    setSelectedAssistantModeId(mode.id)
    setAssistantModeMenuOpen(false)
  }

  function openAssistantModeForm() {
    if (streaming || updateAiConfig.isPending) return
    setAssistantModeMenuOpen(false)
    setAssistantModeForm({ name: '', prompt: '' })
  }

  function submitAssistantMode() {
    if (!assistantModeForm || updateAiConfig.isPending) return
    const name = assistantModeForm.name.trim()
    const prompt = assistantModeForm.prompt.trim()
    if (!name || !prompt) return
    const id = `custom-${Date.now().toString(36)}`
    const nextModes = [...assistantModes.filter((mode) => !mode.builtIn), { id, name, prompt, builtIn: false }]
    updateAiConfig.mutate({ modes: nextModes.map(({ id: modeId, name: modeName, prompt: modePrompt }) => ({ id: modeId, name: modeName, prompt: modePrompt })) }, {
      onSuccess: (response) => {
        setAssistantModes(response.data.modes)
        setSelectedAssistantModeId(id)
        setAssistantModeForm(null)
        addToast('助理模式已添加', 'success')
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
    const userMessage: AiMessage = { id: messageId(), role: 'user', content: request.prompt, context: null, aborted: false, citations: [], savedAsIdea: false }
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
        setPrompt(request.prompt)
        const message = error instanceof ApiError ? error.message : 'AI 请求失败，请稍后重试'
        updateAssistant(assistantId, (current) => ({ ...current, content: current.content ? `${current.content}\n\n请求失败：${message}` : `请求失败：${message}` }))
      } else {
        updateAssistant(assistantId, (current) => ({ ...current, content: current.content ? `${current.content}\n\n（已停止）` : '（已停止）', aborted: true }))
      }
    } finally {
      if (requestGenerationRef.current === requestGeneration) {
        abortRef.current = null
        setToolStatus(null)
        void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, bookId] })
        if (activeThreadId) void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, 'detail', activeThreadId] })
        setStreaming(false)
      }
    }
  }

  async function send() {
    const text = prompt.trim()
    if (!canSend) return
    const history: AiHistoryMessage[] = messages.map(({ role, content }) => ({ role, content })).filter((message) => message.content.trim())
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
      ...(selectedAssistantMode.prompt ? { assistantModePrompt: selectedAssistantMode.prompt } : {}),
    })
  }

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
    void renderer.display(target).catch(() => undefined)
    setSidebarOpen(false)
  }

  const historyThreads = useMemo(() => Array.isArray(threadsQuery.data?.data) ? threadsQuery.data.data : [], [threadsQuery.data])

  return (
    <div data-testid="ai-panel" className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bd-read-bg)]">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center border-b border-[var(--bd-read-accent)] px-4" style={{ backgroundColor: 'var(--bd-read-bg)' }}>
        <span className="text-sm font-medium text-current">AI 助手</span>
        <div className="ml-auto flex items-center gap-2 text-[var(--bd-read-sub)]">
          <button type="button" onClick={startNewChat} disabled={streaming} aria-label="新建对话" title="新建对话" className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button ref={historyButtonRef} type="button" onClick={() => { if (!streaming) { const nextOpen = !historyOpen; setToolsOpen(false); setHistoryOpen(nextOpen); if (nextOpen) void threadsQuery.refetch() } }} disabled={streaming} aria-label={_('reader.aiHistory')} title={_('reader.aiHistory')} aria-expanded={historyOpen} className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40 ${historyOpen ? 'bg-stone-500/10 text-current' : ''}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 5v4h4M12 7v5l3 2" /></svg>
          </button>
          <button ref={toolsButtonRef} type="button" onClick={() => { if (!streaming) { setHistoryOpen(false); setModelMenuOpen(false); setToolsOpen(!toolsOpen) } }} disabled={streaming} aria-label="AI 工具" title="AI 工具" aria-expanded={toolsOpen} className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40 ${toolsOpen ? 'bg-stone-500/10 text-current' : ''}`}>
            <ToolsIcon />
          </button>
          <button type="button" onClick={() => void statusQuery.refetch()} disabled={statusQuery.isFetching} aria-label="刷新 AI 状态" title="刷新 AI 状态" className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 0 0-14.8-3.9L3 9" /><path d="M3 4.5V9h4.5M4 13a8 8 0 0 0 14.8 3.9L21 15" /><path d="M21 19.5V15h-4.5" /></svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {messages.length > 0 ? (
          <div className={`${READ_SCROLLBAR_CLASSES} min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 pr-5`}>
            {messages.map((message, index) => (
              <div key={message.id} className={message.role === 'user' ? 'ml-auto w-fit max-w-[85%] break-words rounded-xl bg-[var(--bd-read-accent)]/20 p-3 text-sm' : 'mr-auto w-fit max-w-full break-words rounded-xl border border-[var(--bd-read-accent)] p-3 text-sm'}>
                {message.content ? (message.role === 'assistant' ? <MarkdownText content={message.content} /> : <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</div>) : <div className="leading-relaxed">{streaming && (toolStatus ?? '正在思考…')}</div>}
                {message.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--bd-read-sub)]">
                    <span>来源</span>
                    {message.citations.map((citation, citationIndex) => (
                      <button key={`${citation.id}-${citationIndex}`} type="button" disabled={!renderer} onClick={() => jumpToCitation(citation)} title={citation.excerpt} className="max-w-44 truncate rounded-full border border-[var(--bd-read-accent)] px-2 py-0.5 transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-default disabled:opacity-70">
                        {citation.chapterTitle || `第 ${citation.chapterIndex + 1} 章`}
                      </button>
                    ))}
                  </div>
                )}
                {message.aborted && <div className="mt-2 text-[11px] text-[var(--bd-read-sub)]">已停止</div>}
                {message.role === 'assistant' && message.content && !streaming && (
                  <div className="mt-3 flex items-center gap-3 text-xs text-[var(--bd-read-sub)]">
                    <button type="button" onClick={() => void copyAssistantMessage(message.id, message.content)} aria-label={copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')} title={copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')} className={`flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors active:scale-95 ${copiedMessageId === message.id ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'hover:bg-[var(--bd-read-page-bg)] hover:text-current'}`}>{copiedMessageId === message.id ? <CheckIcon /> : <CopyIcon />}{copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')}</button>
                    {message.ideaTarget && !message.aborted && <button type="button" onClick={() => void saveAssistantAsIdea(message)} disabled={message.savedAsIdea || createAnnotation.isPending} aria-label={message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')} title={message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')} className="flex items-center gap-1.5 hover:text-current disabled:cursor-default disabled:opacity-60"><BulbIcon size={14} />{message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')}</button>}
                    {retryRequest && index === messages.length - 1 && <button type="button" onClick={() => void runRequest(retryRequest, true)} className="flex items-center gap-1.5 hover:text-current"><RetryIcon />重试</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]"><ChatIcon /></div>
            <p className="text-base font-normal text-current">开始与 AI 对话</p>
          </div>
        )}

        <div className="shrink-0 px-3 pb-3 pt-3">
          <form ref={chapterMenuRef} className="relative mx-auto w-full max-w-[400px]" onSubmit={(event) => { event.preventDefault(); void send() }}>
            <div className="rounded-xl border border-stone-300/80 bg-stone-500/5 px-3 pb-1.5 pt-2 shadow-sm dark:border-stone-700/80">
              {selectedChapterReferences.length > 0 && (
                <div className={`${READ_SCROLLBAR_CLASSES} mb-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto overscroll-contain`}>
                  {selectedChapterReferences.map((chapterIndex) => {
                    const chapter = chapters[chapterIndex]
                    if (!chapter) return null
                    return <div key={chapterIndex} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-2 py-1 text-xs text-current">
                      <ChapterReferenceIcon />
                      <span className="min-w-0 truncate" title={chapter.title}>{chapter.title}</span>
                      <button type="button" onClick={() => toggleChapterReference(chapterIndex)} aria-label={`移除章节引用 ${chapter.title}`} title="移除章节引用" className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bd-read-primary)]/10 hover:text-current">
                        <CloseIcon />
                      </button>
                    </div>
                  })}
                </div>
              )}
              {selection && (
                <div className="mb-2 flex min-w-0 max-w-full items-center gap-2 rounded-md border border-[var(--bd-read-primary)]/60 bg-[var(--bd-read-primary)]/10 px-2.5 py-1 text-sm text-[var(--bd-read-primary)]">
                  <SelectedPositionIcon size={16} />
                  <span className="min-w-0 flex-1 truncate" title={selection}>{selectionPreview}</span>
                  <button type="button" onClick={() => setAiContext(null)} aria-label="移除引用原文" title="移除引用原文" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bd-read-primary)]/10 hover:text-current">
                    <CloseIcon />
                  </button>
                </div>
              )}
              <textarea ref={promptTextareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} onPointerDown={() => setChapterMenuOpen(false)} disabled={streaming} rows={2} placeholder="输入消息…" className={`${READ_SCROLLBAR_CLASSES} min-h-12 max-h-36 w-full resize-none overflow-y-hidden overscroll-contain bg-transparent text-sm leading-relaxed text-current outline-none placeholder:text-[var(--bd-read-sub)] disabled:cursor-not-allowed disabled:opacity-60`} />
              <div className="mt-1.5 flex min-w-0 items-center gap-1 text-[var(--bd-read-sub)]">
                <div className="shrink-0">
                  <button type="button" onClick={() => { if (!streaming) { setChapterMenuOpen((open) => !open); setAssistantModeMenuOpen(false); setModelMenuOpen(false) } }} aria-label="添加章节引用" aria-haspopup="dialog" aria-expanded={chapterMenuOpen} title="添加章节引用" className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current disabled:cursor-not-allowed disabled:opacity-40 ${chapterMenuOpen || selectedChapterReferences.length > 0 ? 'bg-[var(--bd-read-page-bg)] text-current' : ''}`} disabled={streaming}>
                    <PaperclipIcon />
                  </button>
                  {chapterMenuOpen && (
                    <div role="dialog" aria-label="添加章节引用" className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[min(420px,calc(100vh-4rem))] w-full flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
                      <div className="shrink-0 border-b border-[var(--bd-read-accent)] px-4 py-3.5 text-sm font-medium text-current">添加章节引用</div>
                      <div className={`${READ_SCROLLBAR_CLASSES} min-h-0 overflow-y-auto overscroll-contain p-2`}>
                        {chaptersQuery.isFetching && chapters.length === 0 ? <p className="px-3 py-6 text-center text-xs text-[var(--bd-read-sub)]">正在读取目录…</p> : chapters.length === 0 ? <p className="px-3 py-6 text-center text-xs text-[var(--bd-read-sub)]">暂时没有可引用的章节</p> : <ul className="space-y-1">
                          {chapters.map((chapter, chapterIndex) => {
                            const selected = selectedChapterReferences.includes(chapterIndex)
                            return <li key={chapter.id}>
                              <button type="button" disabled={streaming} aria-pressed={selected} title={chapter.title} onClick={() => toggleChapterReference(chapterIndex)} className={`flex min-h-10 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-[var(--bd-read-primary)]/25 bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'border-transparent text-current hover:bg-[var(--bd-read-page-bg)]'}`} style={{ paddingLeft: `${0.75 + Math.max(0, chapter.level - 1) * 0.75}rem` }}>
                                <span className="shrink-0 text-[var(--bd-read-sub)]"><ChapterReferenceIcon /></span>
                                <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                                {selected && <CheckIcon />}
                              </button>
                            </li>
                          })}
                        </ul>}
                      </div>
                    </div>
                  )}
                </div>
                <div ref={assistantModeMenuRef} className="relative min-w-0 max-w-24 shrink">
                   <button type="button" onClick={() => { if (!streaming) { setAssistantModeMenuOpen((open) => !open); setChapterMenuOpen(false); setModelMenuOpen(false) } }} aria-label="选择助理模式" aria-haspopup="menu" aria-expanded={assistantModeMenuOpen} title={selectedAssistantMode.name} className={`flex min-w-0 max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 text-xs text-current outline-none transition-colors hover:bg-[var(--bd-read-page-bg)] focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] ${assistantModeMenuOpen ? 'bg-[var(--bd-read-page-bg)]' : ''}`}>
                     <span className="min-w-0 flex-1 truncate">{selectedAssistantMode.name}</span>
                    <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${assistantModeMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                  </button>
                  {assistantModeMenuOpen && (
                    <div role="menu" aria-label="选择助理模式" className="absolute bottom-full left-0 z-30 mb-2 min-w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 shadow-xl">
                      {availableAssistantModes.map((mode) => <button key={mode.id} type="button" role="menuitemradio" aria-checked={mode.id === selectedAssistantMode.id} onClick={() => selectAssistantMode(mode)} className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-[var(--bd-read-page-bg)] ${mode.id === selectedAssistantMode.id ? 'text-[var(--bd-read-primary)]' : 'text-current'}`}>
                        <span className="min-w-0 flex-1 truncate">{mode.name}</span>
                        {mode.id === selectedAssistantMode.id && <CheckIcon />}
                      </button>)}
                      <div className="mt-1 border-t border-[var(--bd-read-accent)] pt-1">
                        <button type="button" role="menuitem" onClick={openAssistantModeForm} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-[var(--bd-read-primary)] transition-colors hover:bg-[var(--bd-read-page-bg)]">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                          <span>添加模式</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div ref={modelMenuRef} className="relative min-w-0 max-w-40 flex-1">
                  <button
                    type="button"
                    aria-label="选择模型"
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    title={selectedModelLabel}
                    disabled={!modelReady || streaming || modelOptions.length < 2 || updateAiConfig.isPending}
                    ref={modelButtonRef}
                    onClick={() => setModelMenuOpen((open) => !open)}
                    className="flex min-w-0 w-full max-w-full items-center gap-0.5 rounded py-0.5 pr-1 text-xs text-current outline-none transition-colors hover:bg-[var(--bd-read-page-bg)] focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:cursor-not-allowed disabled:text-[var(--bd-read-sub)]"
                  >
                    {modelReady && <AiBrandIcon name={selectedModel?.name ?? statusQuery.data?.data.model} model={selectedModel} provider={statusQuery.data?.data.provider} className="h-5 w-5 shrink-0" />}
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
                {streaming ? <button type="button" onClick={stop} aria-label="停止生成" title="停止生成" className="ml-auto shrink-0 rounded-full p-1.5 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"><StopIcon /></button> : <button type="submit" disabled={!canSend} aria-label="发送" title="发送" className="ml-auto shrink-0 rounded-full p-1.5 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-35"><SendIcon /></button>}
              </div>
            </div>
          </form>
        </div>
      </div>
      {toolsOpen && (
        <aside ref={toolsRef} data-testid="ai-tools-drawer" className="absolute right-2 top-12 z-20 flex max-h-[min(440px,calc(100vh-6rem))] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
          <div className={`${READ_SCROLLBAR_CLASSES} min-h-0 overflow-y-auto overscroll-contain px-4 py-4`}>
            <section>
              <h3 className="mb-2 text-xs font-medium text-current">快捷指令</h3>
              {quickActions.length > 0 ? <ul className="space-y-1">
                {quickActions.map((action) => <li key={action.label}>
                  <button type="button" disabled={streaming} onClick={() => { setPrompt(action.prompt); setToolsOpen(false) }} className="flex min-h-10 w-full items-center rounded-lg border border-transparent px-3 text-left text-sm text-[var(--bd-read-sub)] transition-colors hover:border-[var(--bd-read-accent)] hover:bg-stone-500/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    <svg className="ml-3 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
                  </button>
                </li>)}
              </ul> : <p className="rounded-lg border border-dashed border-[var(--bd-read-accent)] px-3 py-3 text-xs text-[var(--bd-read-sub)]">{_('reader.aiPromptsEmpty')}</p>}
            </section>

            <section className="mt-5 border-t border-[var(--bd-read-accent)] pt-4">
              <h3 className="mb-1 text-xs font-medium text-current">AI 可用工具</h3>
              <p className="mb-2 text-[11px] leading-relaxed text-[var(--bd-read-sub)]">关闭后，AI 本次对话不会调用对应能力。</p>
              <ul className="divide-y divide-[var(--bd-read-accent)]/60">
                {AI_TOOL_OPTIONS.map((option) => {
                  const enabled = enabledTools.includes(option.id)
                  return <li key={option.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-current">{option.label}</p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--bd-read-sub)]">{option.description}</p>
                    </div>
                    <button type="button" role="switch" aria-checked={enabled} aria-label={option.label} disabled={streaming} onClick={() => toggleTool(option.id)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-[var(--bd-read-primary)]' : 'bg-[var(--bd-read-accent)]'}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] shadow-sm transition-transform ${enabled ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  </li>
                })}
              </ul>
            </section>

            <section className="mt-5 border-t border-[var(--bd-read-accent)] pt-4">
              <h3 className="mb-1 text-xs font-medium text-current">书内索引</h3>
              <p className="text-[11px] leading-relaxed text-[var(--bd-read-sub)]">建立后，AI 才能搜索当前书的正文内容。</p>
              {embeddingConfigMismatch && <p className="mt-2 text-xs text-[var(--bd-read-sub)]">{_('reader.aiEmbeddingStale')}</p>}
              {visibleCorpusMismatch && <p className="mt-2 text-xs text-[var(--bd-read-sub)]">{_('reader.aiCorpusStale')}</p>}
              {indexStatus === 'indexing' && <div className="mt-3 text-xs text-[var(--bd-read-sub)]">
                <div className="flex items-center justify-between gap-2">
                  <span>{_(indexQuery.data?.data.embeddingStatus === 'indexing' ? 'reader.aiEmbeddingProgress' : 'reader.aiIndexProgress', { progress: indexQuery.data?.data.progress ?? 0 })}</span>
                  <span>{indexQuery.data?.data.progress ?? 0}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-500/10"><div className="h-full rounded-full bg-current transition-[width]" style={{ width: `${Math.max(0, Math.min(100, indexQuery.data?.data.progress ?? 0))}%` }} /></div>
              </div>}
              {(indexActionVisible || (indexStatus !== 'not_indexed' && indexStatus !== 'indexing' && indexStatus !== undefined)) && <div className="mt-3 flex items-center gap-2">
                {indexActionVisible && <button type="button" onClick={indexStatus === 'indexing' || indexBook.isPending || preparingIndex ? cancelBookIndex : () => void buildBookIndex()} disabled={cancelIndex.isPending || clearIndex.isPending} className="min-w-0 flex-1 rounded-md border border-[var(--bd-read-accent)] px-2.5 py-2 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{indexActionLabel}</button>}
                {indexStatus !== 'not_indexed' && indexStatus !== 'indexing' && indexStatus !== undefined && <button type="button" onClick={() => setClearIndexOpen(true)} disabled={clearIndex.isPending} className="rounded-md px-2.5 py-2 text-xs text-[var(--bd-read-sub)] underline underline-offset-2 transition-colors hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{_('reader.aiIndexClear')}</button>}
              </div>}
            </section>

            <section className="mt-4 border-t border-[var(--bd-read-accent)] pt-3">
              <button type="button" onClick={() => { exportConversation(); setToolsOpen(false) }} disabled={streaming || messages.length === 0} aria-label={_('reader.aiExport')} title={_('reader.aiExport')} className="flex min-h-10 w-full items-center rounded-lg border border-transparent px-3 text-left text-sm text-[var(--bd-read-sub)] transition-colors hover:border-[var(--bd-read-accent)] hover:bg-stone-500/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">
                <DownloadIcon />
                <span className="ml-3 min-w-0 flex-1 truncate">{_('reader.aiExport')}</span>
                <svg className="ml-3 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
              </button>
            </section>
          </div>
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
      {assistantModeForm && <Modal title="添加模式" variant="reader" onClose={() => setAssistantModeForm(null)}>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); submitAssistantMode() }}>
          <label className="flex flex-col gap-1 text-xs text-[var(--bd-read-sub)]">
            <span>模式名称</span>
            <input required autoFocus maxLength={80} value={assistantModeForm.name} onChange={(event) => setAssistantModeForm({ ...assistantModeForm, name: event.target.value })} placeholder="例如：严谨书评人" className="h-10 rounded-lg border border-[var(--bd-read-accent)] bg-transparent px-3 text-sm text-current outline-none focus:border-[var(--bd-read-primary)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--bd-read-sub)]">
            <span>系统提示词</span>
            <textarea required maxLength={2_000} rows={6} value={assistantModeForm.prompt} onChange={(event) => setAssistantModeForm({ ...assistantModeForm, prompt: event.target.value })} placeholder="定义 AI 的角色和回答方式…" className="resize-y rounded-lg border border-[var(--bd-read-accent)] bg-transparent px-3 py-2 text-sm leading-5 text-current outline-none focus:border-[var(--bd-read-primary)]" />
          </label>
          <div className="flex justify-end gap-2 border-t border-[var(--bd-read-accent)] pt-4">
            <button type="button" onClick={() => setAssistantModeForm(null)} className="rounded-lg border border-[var(--bd-read-accent)] px-4 py-2 text-sm text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)]">取消</button>
            <button type="submit" disabled={!assistantModeForm.name.trim() || !assistantModeForm.prompt.trim() || updateAiConfig.isPending} className="rounded-lg bg-[var(--bd-read-primary)] px-4 py-2 text-sm text-[var(--bd-read-bg)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40">保存</button>
          </div>
        </form>
      </Modal>}
      {deleteTarget && <ConfirmDialog message={_('reader.aiDeleteConfirm')} onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />}
      {clearIndexOpen && <ConfirmDialog message={_('reader.aiIndexClearConfirm')} onConfirm={confirmClearIndex} onClose={() => setClearIndexOpen(false)} />}
    </div>
  )
}
