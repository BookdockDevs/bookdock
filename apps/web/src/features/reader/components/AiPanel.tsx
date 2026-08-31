import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { isAiEmbeddingModel } from '@bookdock/shared'
import type { AiChatReq, AiCitation, AiContextReceipt, AiHistoryMessage, AiMessageRes, AiPromptTemplate, AiStatusRes, AiThreadRes } from '@bookdock/shared'

import { apiGet, apiStreamAiChat, ApiError } from '@/api/client'
import { AI_THREADS_KEY, useAiIndexStatus, useAiThread, useAiThreads, useCancelAiBookIndex, useClearAiBookIndex, useDeleteAiThread, useIndexAiBook, useUpdateAiConfig, useUpdateAiThread } from '@/api/hooks/useAi'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useCreateAnnotation } from '../hooks/useAnnotations'
import { useReaderState } from '../state/reader-state'
import { BulbIcon } from './annotation-icons'

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
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const aiContext = useReaderState((s) => s.aiContext)
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
  const [includeBefore, setIncludeBefore] = useState(false)
  const [receipt, setReceipt] = useState<AiContextReceipt | null>(null)
  const [retryRequest, setRetryRequest] = useState<AiRequest | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [clearIndexOpen, setClearIndexOpen] = useState(false)
  const [preparingIndex, setPreparingIndex] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const indexAbortRef = useRef<AbortController | null>(null)
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
    setRenameThreadId(null)
    setDeleteTarget(null)
    setClearIndexOpen(false)
  }, [bookId])
  useEffect(() => {
    if (streaming || !threadId || threadQuery.data?.data.id !== threadId) return
    setMessages(threadQuery.data.data.messages.map(fromPersistedMessage))
    setRetryRequest(null)
    setReceipt(null)
  }, [streaming, threadId, threadQuery.data])
  useEffect(() => {
    setIncludeBefore(false)
    setReceipt(null)
    setRetryRequest(null)
  }, [aiContext?.cfiRange])

  const selection = aiContext?.rawText?.trim() || aiContext?.text.trim() || ''
  const beforeText = aiContext?.beforeText?.trim() || ''
  const selectedBefore = includeBefore ? beforeText : ''
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
  const canSend = modelReady && Boolean(prompt.trim()) && !streaming
  const draftReceipt: AiContextReceipt = {
    questionChars: prompt.trim().length,
    selectionChars: selection.length,
    beforeChars: selectedBefore.length,
    chapterChars: 0,
    ragChars: 0,
    notesChars: 0,
    contextChars: selection.length + selectedBefore.length,
    chapterTitle: chapterTitle ?? null,
    sourceCfi: aiContext?.cfiRange ?? 'selection',
  }
  const visibleReceipt = receipt ?? draftReceipt
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

  function updateAssistant(id: string, update: (message: AiMessage) => AiMessage) {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message))
  }

  function startNewChat() {
    if (streaming) return
    setThreadId(null)
    setMessages([])
    setReceipt(null)
    setRetryRequest(null)
    setToolStatus(null)
    setPrompt('')
    setHistoryOpen(false)
  }

  function selectThread(id: string) {
    if (streaming) return
    setThreadId(id)
    setMessages([])
    setPrompt('')
    setReceipt(null)
    setRetryRequest(null)
    setHistoryOpen(false)
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
    setReceipt(null)
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
          setReceipt(event.receipt)
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

  function send() {
    const text = prompt.trim()
    if (!canSend) return
    const history: AiHistoryMessage[] = messages.map(({ role, content }) => ({ role, content })).filter((message) => message.content.trim())
    void runRequest({
      ...(threadId ? { threadId } : {}),
      prompt: text,
      history,
      context: {
        chapterIndex,
        chapterTitle: chapterTitle ?? undefined,
        cfiRange: aiContext?.cfiRange ?? 'selection',
        selection,
        ...(selectedBefore ? { before: selectedBefore } : {}),
        ...(visibleTextVersion ? { visibleTextVersion } : {}),
      },
    })
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function copyAssistantMessage(content: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable')
      await navigator.clipboard.writeText(content)
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
      const lines = [`# ${title}`, '', `${_('reader.aiExportTimestamp')}：${new Date().toLocaleString()}`, '']
      messages.forEach((message) => {
        lines.push(`## ${_(message.role === 'user' ? 'reader.aiExportUser' : 'reader.aiExportAssistant')}`, '', message.content.trim() || `（${_('reader.aiExportNoContent')}）`, '')
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

  function jumpToSource(sourceCfi = visibleReceipt.sourceCfi) {
    if (!renderer || !sourceCfi || sourceCfi === 'selection') return
    void renderer.display(sourceCfi).catch(() => undefined)
    setSidebarOpen(false)
  }

  function jumpToCitation(citation: AiCitation) {
    if (!renderer) return
    const target = citation.sourceCfi ?? `search-hit:${citation.chapterIndex}:${citation.startOffset}:${citation.endOffset}`
    void renderer.display(target).catch(() => undefined)
    setSidebarOpen(false)
  }

  const historyThreads = useMemo(() => Array.isArray(threadsQuery.data?.data) ? threadsQuery.data.data : [], [threadsQuery.data])

  return (
    <div data-testid="ai-panel" className="relative flex min-h-full flex-col bg-[var(--bd-read-bg)]">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center border-b border-[var(--bd-read-accent)] px-4" style={{ backgroundColor: 'var(--bd-read-bg)' }}>
        <span className="text-sm font-medium text-current">AI 助手</span>
        <div className="ml-auto flex items-center gap-2 text-[var(--bd-read-sub)]">
          <button type="button" onClick={startNewChat} disabled={streaming} aria-label="新建对话" title="新建对话" className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button type="button" onClick={() => { if (!streaming) { setHistoryOpen(true); void threadsQuery.refetch() } }} disabled={streaming} aria-label={_('reader.aiHistory')} title={_('reader.aiHistory')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 5v4h4M12 7v5l3 2" /></svg>
          </button>
          <button type="button" onClick={exportConversation} disabled={streaming || messages.length === 0} aria-label={_('reader.aiExport')} title={_('reader.aiExport')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <DownloadIcon />
          </button>
          <button type="button" onClick={() => void statusQuery.refetch()} disabled={statusQuery.isFetching} aria-label="刷新 AI 状态" title="刷新 AI 状态" className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 0 0-14.8-3.9L3 9" /><path d="M3 4.5V9h4.5M4 13a8 8 0 0 0 14.8 3.9L21 15" /><path d="M21 19.5V15h-4.5" /></svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6">
        {messages.length > 0 ? (
          <div className="flex-1 space-y-3 overflow-y-auto py-4">
            {messages.map((message, index) => (
              <div key={message.id} className={message.role === 'user' ? 'ml-8 rounded-xl bg-[var(--bd-read-accent)]/20 p-3 text-sm' : 'mr-2 rounded-xl border border-[var(--bd-read-accent)] p-3 text-sm'}>
                <div className="mb-1 text-xs text-[var(--bd-read-sub)]">{message.role === 'user' ? '你' : 'AI'}</div>
                {message.content ? (message.role === 'assistant' ? <MarkdownText content={message.content} /> : <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</div>) : <div className="leading-relaxed">{streaming && (toolStatus ?? '正在思考…')}</div>}
                {message.context && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--bd-read-sub)]">
                    <span>{message.context.chapterTitle ?? '选区'} · {message.context.contextChars} 字</span>
                    {renderer && message.context.sourceCfi !== 'selection' && <button type="button" onClick={() => jumpToSource(message.context?.sourceCfi)} className="underline underline-offset-2 hover:text-current">回到原文</button>}
                  </div>
                )}
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
                    <button type="button" onClick={() => void copyAssistantMessage(message.content)} aria-label={_('reader.aiCopy')} title={_('reader.aiCopy')} className="flex items-center gap-1.5 hover:text-current"><CopyIcon />{_('reader.aiCopy')}</button>
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
            <p className="mt-1 text-sm text-[var(--bd-read-sub)]">{selection ? (modelReady ? modelLabel : '选择模型') : modelReady ? '可让 AI 查看目录或章节' : '选择模型'}</p>
            {embeddingConfigMismatch && <p className="mt-2 max-w-64 text-xs text-[var(--bd-read-sub)]">{_('reader.aiEmbeddingStale')}</p>}
            {visibleCorpusMismatch && <p className="mt-2 max-w-64 text-xs text-[var(--bd-read-sub)]">{_('reader.aiCorpusStale')}</p>}
            {quickActions.length > 0 && <div className="mt-4 flex flex-wrap justify-center gap-2">
              {quickActions.map((action) => <button key={action.label} type="button" disabled={streaming} onClick={() => { setPrompt(action.prompt); setReceipt(null) }} className="rounded-full border border-[var(--bd-read-accent)] px-3 py-1.5 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{action.label}</button>)}
            </div>}
            {indexQuery.data?.data.status === 'indexing' && <div className="mt-4 w-full max-w-64 text-left text-xs text-[var(--bd-read-sub)]">
              <div className="flex items-center justify-between gap-2">
                <span>{_(indexQuery.data.data.embeddingStatus === 'indexing' ? 'reader.aiEmbeddingProgress' : 'reader.aiIndexProgress', { progress: indexQuery.data.data.progress ?? 0 })}</span>
                <span>{indexQuery.data.data.progress ?? 0}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-500/10"><div className="h-full rounded-full bg-current transition-[width]" style={{ width: `${Math.max(0, Math.min(100, indexQuery.data.data.progress ?? 0))}%` }} /></div>
            </div>}
            {(visibleCorpusMismatch || embeddingConfigMismatch || ['not_indexed', 'stale', 'failed', 'indexing'].includes(indexQuery.data?.data.status ?? '') || indexQuery.data?.data.embeddingStatus === 'failed') && <button type="button" onClick={indexQuery.data?.data.status === 'indexing' || indexBook.isPending || preparingIndex ? cancelBookIndex : () => void buildBookIndex()} disabled={cancelIndex.isPending || clearIndex.isPending} className="mt-3 text-xs text-[var(--bd-read-sub)] underline underline-offset-2 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">
              {preparingIndex ? _('reader.aiIndexPreparing') : indexQuery.data?.data.status === 'indexing' || indexBook.isPending ? _('reader.aiIndexCancel') : visibleCorpusMismatch ? _('reader.aiCorpusRebuild') : embeddingConfigMismatch ? _('reader.aiEmbeddingRebuild') : indexQuery.data?.data.embeddingStatus === 'failed' ? _('reader.aiEmbeddingRetry') : indexQuery.data?.data.status === 'failed' ? _('reader.aiIndexRebuild') : _('reader.aiIndexBuild')}
            </button>}
            {indexQuery.data?.data.status !== 'not_indexed' && indexQuery.data?.data.status !== 'indexing' && indexQuery.data?.data.status !== undefined && <button type="button" onClick={() => setClearIndexOpen(true)} disabled={clearIndex.isPending} className="mt-3 ml-3 text-xs text-[var(--bd-read-sub)] underline underline-offset-2 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{_('reader.aiIndexClear')}</button>}
          </div>
        )}

        <div className="sticky bottom-0 shrink-0 pb-6 pt-3">
          {(selection || prompt.trim() || receipt) && (
            <div className="mb-2 rounded-lg border border-[var(--bd-read-accent)]/70 bg-stone-500/5 px-3 py-2 text-xs text-[var(--bd-read-sub)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-current">{_('reader.aiReceiptTitle')}</span>
                {renderer && visibleReceipt.sourceCfi !== 'selection' && <button type="button" onClick={() => jumpToSource()} className="shrink-0 underline underline-offset-2 hover:text-current">回到原文</button>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{_('reader.aiReceiptQuestion', { n: visibleReceipt.questionChars ?? prompt.trim().length })}</span>
                <span>{_('reader.aiReceiptSelection', { n: visibleReceipt.selectionChars })}</span>
                <span>{_('reader.aiReceiptBefore', { n: visibleReceipt.beforeChars })}</span>
                <span>{_('reader.aiReceiptChapter', { n: visibleReceipt.chapterChars ?? 0 })}</span>
                <span>{_('reader.aiReceiptRag', { n: visibleReceipt.ragChars ?? 0 })}</span>
                {(visibleReceipt.notesChars ?? 0) > 0 && <span>{_('reader.aiReceiptNotes', { n: visibleReceipt.notesChars ?? 0 })}</span>}
                <span>{_('reader.aiReceiptAfter')}</span>
                {beforeText && <button type="button" role="switch" aria-checked={includeBefore} disabled={streaming} onClick={() => { setIncludeBefore((value) => !value); setReceipt(null) }} className="underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{includeBefore ? '不包含前文' : '包含前文'}</button>}
              </div>
              {visibleReceipt.chapterTitle && <div className="mt-1 truncate">来源：{visibleReceipt.chapterTitle}</div>}
            </div>
          )}
          <form className="mx-auto w-full max-w-[400px]" onSubmit={(event) => { event.preventDefault(); send() }}>
            <div className="rounded-xl border border-stone-300/80 bg-stone-500/5 px-3 pb-1.5 pt-2 shadow-sm dark:border-stone-700/80">
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={streaming} rows={1} placeholder="输入消息…" className="w-full resize-none bg-transparent text-sm leading-relaxed text-current outline-none placeholder:text-[var(--bd-read-sub)] disabled:cursor-not-allowed disabled:opacity-60" />
              <div className="mt-1.5 flex items-center gap-2 text-[var(--bd-read-sub)]">
                <span aria-label="引用选区" title="选区会自动作为上下文" className="rounded-full p-1 opacity-60"><PaperclipIcon /></span>
                <span className="text-xs text-current">助理</span>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
                {modelReady && <AiBrandIcon name={statusQuery.data?.data.model} provider={statusQuery.data?.data.provider} className="h-5 w-5" />}
                <select aria-label="选择模型" value={statusQuery.data?.data.model ?? ''} disabled={!modelReady || streaming || modelOptions.length < 2 || updateAiConfig.isPending} onChange={(event) => selectModel(event.target.value)} className="max-w-40 appearance-none bg-transparent text-xs text-current outline-none disabled:cursor-not-allowed disabled:text-[var(--bd-read-sub)]">
                  {!statusQuery.data?.data.model && <option value="">{modelLabel}</option>}
                  {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name === model.id ? model.id : `${model.name} · ${model.id}`}</option>)}
                </select>
                <svg className="-ml-1 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
                {streaming ? <button type="button" onClick={stop} aria-label="停止生成" title="停止生成" className="ml-auto rounded-full p-1.5 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"><StopIcon /></button> : <button type="submit" disabled={!canSend} aria-label="发送" title="发送" className="ml-auto rounded-full p-1.5 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-35"><SendIcon /></button>}
              </div>
            </div>
          </form>
        </div>
      </div>
      {historyOpen && (
        <div data-testid="ai-history" className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[var(--bd-read-bg)]">
          <div className="flex h-12 shrink-0 items-center border-b border-[var(--bd-read-accent)] px-4">
            <button type="button" onClick={() => setHistoryOpen(false)} aria-label={_('reader.aiBack')} title={_('reader.aiBack')} className="mr-2 flex h-7 w-7 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <span className="text-sm font-medium">{_('reader.aiHistory')}</span>
            <button type="button" onClick={startNewChat} className="ml-auto rounded px-2 py-1 text-xs text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current">{_('reader.aiNew')}</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {threadsQuery.isFetching && historyThreads.length === 0 ? <p className="py-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.loading')}</p> : historyThreads.length === 0 ? <p className="py-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.aiHistoryEmpty')}</p> : (
              <ul className="space-y-1">
                {historyThreads.map((thread) => (
                  <li key={thread.id} className="rounded-lg px-2 py-2 hover:bg-stone-500/5">
                    {renameThreadId === thread.id ? (
                      <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); submitRename(thread) }}>
                        <input autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} maxLength={100} aria-label={_('reader.aiRenamePlaceholder')} className="min-w-0 flex-1 rounded border border-[var(--bd-read-accent)] bg-transparent px-2 py-1 text-sm outline-none" />
                        <button type="submit" disabled={renameThread.isPending} className="shrink-0 text-xs text-current">{_('reader.aiSave')}</button>
                        <button type="button" onClick={() => setRenameThreadId(null)} className="shrink-0 text-xs text-[var(--bd-read-sub)]">{_('reader.aiCancel')}</button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => selectThread(thread.id)} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm text-current">{thread.title}</span>
                          <span className="mt-0.5 block text-[11px] text-[var(--bd-read-sub)]">{new Date(thread.updatedAt).toLocaleDateString()} · {thread.messageCount} {_(thread.messageCount === 1 ? 'reader.aiMessageOne' : 'reader.aiMessageMany')}</span>
                        </button>
                        <button type="button" onClick={() => beginRename(thread)} aria-label={`${_('reader.aiRename')} ${thread.title}`} title={_('reader.aiRename')} className="shrink-0 rounded p-1 text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m4 16 9.5-9.5a2.1 2.1 0 0 1 3 3L7 19H4v-3Z" /><path d="m13.5 7.5 3 3" /></svg>
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(thread)} aria-label={`${_('reader.aiDelete')} ${thread.title}`} title={_('reader.aiDelete')} className="shrink-0 rounded p-1 text-[var(--bd-read-sub)] hover:bg-red-500/10 hover:text-red-600">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {deleteTarget && <ConfirmDialog message={_('reader.aiDeleteConfirm')} onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />}
      {clearIndexOpen && <ConfirmDialog message={_('reader.aiIndexClearConfirm')} onConfirm={confirmClearIndex} onClose={() => setClearIndexOpen(false)} />}
    </div>
  )
}
