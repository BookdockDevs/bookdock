import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { AI_DEFAULT_ASSISTANT_MODE_PROMPT, AI_DEFAULT_READING_SCOPE, AI_MAX_CHAT_PROMPT_CHARS, AI_TOOL_NAMES, getAiPromptVariables, isAiEmbeddingModel, sanitizeAiCitationMarkers } from '@bookdock/shared'
import type { AiAssistantMode, AiChapterReference, AiChatReq, AiCitation, AiContextReceipt, AiConversationSettings, AiHistoryMessage, AiMessageEventRes, AiMessageRes, AiReadingScope, AiRetryRecipe, AiStatusRes, AiThreadRes, AiToolName } from '@bookdock/shared'

import { apiGet, apiPost, apiStreamAiChat } from '@/api/client'
import { AI_THREADS_KEY, useAiIndexStatus, useAiMessageRevisions, useAiThread, useAiThreads, useCancelAiBookIndex, useClearAiBookIndex, useDeleteAiThread, useIndexAiBook, useSelectAiMessageRevision, useUpdateAiConfig, useUpdateAiProfile, useUpdateAiThread } from '@/api/hooks/useAi'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import Modal from '@/components/ui/Modal'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { preloadAiBrandIcons } from '@/lib/aiBrandIcons'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { getUserDisplayName, useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useBookChapters } from '../hooks/useBookChapters'
import { useAiQuickCommands, type AiQuickCommand } from '../hooks/useAiQuickCommands'
import { useIsTouch } from '../hooks/useIsTouch'
import { useAnnotations, useCreateAnnotation } from '../hooks/useAnnotations'
import { readAiPanelMemory, writeAiPanelMemory, type AiPanelMemory } from '../lib/ai-panel-memory'
import { LEADING_CLOSING_PUNCTUATION, normalizeMarkdownParagraphLines } from '../lib/markdown'
import { useReaderState } from '../state/reader-state'
import AiChapterReferenceChip, { ChapterReferenceIcon } from './AiChapterReferenceChip'
import { AiChatIcon, BulbIcon, CheckIcon, CloseIcon, SelectedPositionIcon } from './annotation-icons'

interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  revisionGroupId?: string | null
  revision?: number
  content: string
  context: AiContextReceipt | null
  aborted: boolean
  citations: AiCitation[]
  events?: AiMessageEventRes[]
  retry?: AiRetryRecipe | null
  ideaTarget?: { cfiRange: string; text: string; chapter?: string; chapterHref?: string }
  savedAsIdea: boolean
}

interface AiRequest {
  threadId?: string
  regenerate?: boolean
  editMessageId?: string
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
const AI_PROMPT_PLACEHOLDER_PATTERN = /(\{SELTEXT\}|\{SELPARA\}|\{CHAPTER\})/g
const AI_PROMPT_PLACEHOLDERS = new Set(['{SELTEXT}', '{SELPARA}', '{CHAPTER}'])
const COMPOSER_MIN_HEIGHT = 48
const COMPOSER_MAX_HEIGHT = 144
const READ_SCROLLBAR_CLASSES = 'reader-scrollbar [scrollbar-gutter:stable]'
const ATTACHMENT_SCROLLBAR_CLASSES = 'reader-scrollbar [scrollbar-gutter:stable]'

const AI_PERMISSION_OPTIONS: ReadonlyArray<{ id: string; toolNames: AiToolName[]; labelKey: string; descriptionKey: string }> = [
  { id: 'book-chapter-content', toolNames: ['get_chapter_content'], labelKey: 'reader.aiToolChapter', descriptionKey: 'reader.aiToolChapterDescription' },
  { id: 'book-search', toolNames: ['search_book'], labelKey: 'reader.aiToolSearchBook', descriptionKey: 'reader.aiToolSearchBookDescription' },
  { id: 'book-toc', toolNames: ['get_book_toc'], labelKey: 'reader.aiToolToc', descriptionKey: 'reader.aiToolTocDescription' },
  { id: 'book-annotations-list', toolNames: ['list_annotations'], labelKey: 'reader.aiToolListAnnotations', descriptionKey: 'reader.aiToolListAnnotationsDescription' },
  { id: 'book-annotations-search', toolNames: ['search_annotations'], labelKey: 'reader.aiToolSearchAnnotations', descriptionKey: 'reader.aiToolSearchAnnotationsDescription' },
]

const READING_SCOPE_OPTIONS: ReadonlyArray<{ id: AiReadingScope; labelKey: string }> = [
  { id: 'to_here', labelKey: 'reader.aiScopeToHere' },
  { id: 'current_chapter', labelKey: 'reader.aiScopeCurrentChapter' },
  { id: 'full_book', labelKey: 'reader.aiScopeFullBook' },
]

function readingScopeLabel(scope: AiReadingScope | undefined, translate: (key: string) => string) {
  const option = READING_SCOPE_OPTIONS.find((candidate) => candidate.id === scope)
  return option ? translate(option.labelKey) : translate('reader.aiScopeCurrentRange')
}

function messageId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function fromPersistedMessage(message: AiMessageRes): AiMessage {
  return {
    id: message.id,
    role: message.role,
    revisionGroupId: message.revisionGroupId,
    revision: message.revision,
    content: message.content,
    context: message.context,
    aborted: message.aborted,
    citations: message.citations ?? [],
    events: message.events ?? [],
    retry: message.retry ?? null,
    savedAsIdea: false,
  }
}

function AttachmentIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8.5 12.5 6.8-6.8a3.2 3.2 0 0 1 4.5 4.5L10.5 19.5a5 5 0 0 1-7.1-7.1l9-9" />
      <path d="m6.5 14.5 8.8-8.8" />
    </svg>
  )
}

function ReadingScopeIcon({ scope }: { scope: AiReadingScope }) {
  if (scope === 'current_chapter') {
    return (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h4" />
      </svg>
    )
  }
  if (scope === 'full_book') {
    return (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    )
  }
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      <path d="M12 7v7l2-1.5 2 1.5V7" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 4 16 8-16 8 3-8Z" />
      <path d="M7 12h13" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function renderInline(value: string, citations: AiCitation[] = [], onCitationClick?: (citation: AiCitation) => void, citationLabel: (citationNumber: string) => string = (citationNumber) => `Citation ${citationNumber}`): ReactNode[] {
  const tokenPattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[\d+\]|【\d+】|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g
  const parts = sanitizeAiCitationMarkers(value, citations.length).split(tokenPattern)
  return parts.map((part, index) => {
    if (!part) return null
    const previousCitationNumber = parts[index - 1]?.match(/^\[(\d+)\]$/)?.[1] ?? parts[index - 1]?.match(/^【(\d+)】$/)?.[1]
    if (previousCitationNumber && citations[Number(previousCitationNumber) - 1] && LEADING_CLOSING_PUNCTUATION.test(part)) return null
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{link[1]}</a>
    }
    const citationNumber = part.match(/^\[(\d+)\]$/)?.[1] ?? part.match(/^【(\d+)】$/)?.[1]
    if (citationNumber) {
      const citation = citations[Number(citationNumber) - 1]
      if (citation) {
        const followingPart = parts[index + 1] ?? ''
        const attachedPunctuation = followingPart.match(LEADING_CLOSING_PUNCTUATION)?.[0] ?? ''
        const marker = onCitationClick
          ? <button type="button" onClick={() => onCitationClick(citation)} title={citation.excerpt} aria-label={citationLabel(citationNumber)} className="relative -top-0.5 mx-0.5 align-baseline text-[10px] text-[var(--bd-read-primary)] underline decoration-dotted underline-offset-2">[{citationNumber}]</button>
          : <Fragment>{part}</Fragment>
        if (attachedPunctuation) {
          const remainder = followingPart.slice(attachedPunctuation.length)
          return <Fragment key={index}><span className="whitespace-nowrap">{marker}{attachedPunctuation}</span>{remainder && <Fragment key={`${index}-remainder`}>{remainder}</Fragment>}</Fragment>
        }
        if (onCitationClick) return <Fragment key={index}>{marker}</Fragment>
        return <Fragment key={index}>{part}</Fragment>
      }
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-stone-500/10 px-1 py-0.5 text-[.9em]">{part.slice(1, -1)}</code>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('~~') && part.endsWith('~~')) return <del key={index}>{part.slice(2, -2)}</del>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={index}>{part.slice(1, -1)}</em>
    return <Fragment key={index}>{part}</Fragment>
  })
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[]; start?: number }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'code'; language: string; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'rule' }

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/)
    if (fence) {
      const marker = fence[1] ?? '```'
      const closing = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`)
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !closing.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language: fence[2] ?? '', text: codeLines.join('\n') })
      continue
    }

    const heading = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      index += 1
      continue
    }

    if (/^\s*(?:---+|\*\s*\*\s*\*|___+)\s*$/.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('>')) {
        quoteLines.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', lines: quoteLines })
      continue
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/)
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const orderedList = Boolean(ordered)
      const start = ordered ? Number(ordered[1]) : undefined
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const match = orderedList ? current.match(/^\s*\d+[.)]\s+(.+)$/) : current.match(/^\s*[-+*]\s+(.+)$/)
        if (!match) {
          if (items.length > 0 && /^\s{2,}\S/.test(current) && !/^\s*[-+*]\s+/.test(current) && !/^\s*\d+[.)]\s+/.test(current)) {
            items[items.length - 1] += `\n${current.trim()}`
            index += 1
            continue
          }
          break
        }
        items.push(match[1] ?? '')
        index += 1
      }
      blocks.push({ type: 'list', ordered: orderedList, items, start })
      continue
    }

    if (line.includes('|') && index + 1 < lines.length) {
      const header = splitMarkdownTableRow(line)
      const separator = splitMarkdownTableRow(lines[index + 1] ?? '')
      if (header.length > 0 && header.length === separator.length && separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        const rows: string[][] = []
        index += 2
        while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
          rows.push(splitMarkdownTableRow(lines[index] ?? '').slice(0, header.length))
          index += 1
        }
        blocks.push({ type: 'table', header, rows })
        continue
      }
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (!next.trim() || /^\s*(?:#{1,3})\s+/.test(next) || /^\s*(`{3,}|~{3,})/.test(next) || /^\s*>/.test(next) || /^\s*[-+*]\s+/.test(next) || /^\s*\d+[.)]\s+/.test(next)) break
      paragraphLines.push(next)
      index += 1
    }
    blocks.push({ type: 'paragraph', lines: normalizeMarkdownParagraphLines(paragraphLines) })
  }

  return blocks
}

function MarkdownText({ content, citations, onCitationClick, citationLabel, streaming = false }: { content: string; citations?: AiCitation[]; onCitationClick?: (citation: AiCitation) => void; citationLabel?: (citationNumber: string) => string; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content])
  return (
    <div className={`space-y-3 text-[13.5px] leading-[1.75] [line-break:strict] ${streaming ? 'after:ml-1 after:inline-block after:h-4 after:w-0.5 after:animate-pulse after:rounded-full after:bg-[var(--bd-read-primary)] after:align-[-0.15em] after:content-[\'\']' : ''}`}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const className = block.level === 1 ? 'text-base font-semibold leading-7' : block.level === 2 ? 'text-[15px] font-semibold leading-7' : 'text-sm font-semibold leading-6'
          const Heading = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3'
          return <Heading key={index} className={`m-0 ${className}`}>{renderInline(block.text, citations, onCitationClick, citationLabel)}</Heading>
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return <List key={index} start={block.ordered ? (block.start ?? 1) : undefined} className={`m-0 space-y-1 pl-5 [&>li]:pl-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, citations, onCitationClick, citationLabel)}</li>)}</List>
        }
        if (block.type === 'blockquote') {
          return <blockquote key={index} className="m-0 border-l-2 border-[var(--bd-read-primary)]/35 pl-3 text-[var(--bd-read-sub)]">{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line, citations, onCitationClick, citationLabel)}</Fragment>)}</blockquote>
        }
        if (block.type === 'code') {
          return <pre key={index} className="m-0 max-w-full overflow-x-auto rounded-lg bg-stone-500/10 p-3 font-mono text-[12px] leading-5 whitespace-pre"><code>{block.text}</code></pre>
        }
        if (block.type === 'table') {
          return <div key={index} className="max-w-full overflow-x-auto rounded-lg border border-stone-500/15"><table className="min-w-full border-collapse text-left text-[13px]"><thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-stone-500/15 bg-stone-500/5 px-2.5 py-1.5 font-semibold">{renderInline(cell, citations, onCitationClick, citationLabel)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.header.map((_, cellIndex) => <td key={cellIndex} className="border-b border-stone-500/10 px-2.5 py-1.5 align-top last:border-b-0">{renderInline(row[cellIndex] ?? '', citations, onCitationClick, citationLabel)}</td>)}</tr>)}</tbody></table></div>
        }
        if (block.type === 'rule') return <hr key={index} className="m-0 border-0 border-t border-stone-500/15" />
        return <p key={index} className="m-0">{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line, citations, onCitationClick, citationLabel)}</Fragment>)}</p>
      })}
    </div>
  )
}

class StreamingTextStore {
  private readonly entries = new Map<string, { source: string; visible: string; timer: number | null; listeners: Set<() => void> }>()

  private entry(id: string) {
    const existing = this.entries.get(id)
    if (existing) return existing
    const created = { source: '', visible: '', timer: null, listeners: new Set<() => void>() }
    this.entries.set(id, created)
    return created
  }

  append(id: string, delta: string) {
    if (!delta) return
    const entry = this.entry(id)
    entry.source += delta
    if (entry.timer === null) entry.timer = window.setTimeout(() => this.flush(id), 32)
  }

  getSnapshot(id: string) {
    return this.entry(id).visible
  }

  getText(id: string) {
    return this.entry(id).source
  }

  set(id: string, text: string) {
    const entry = this.entry(id)
    if (entry.timer !== null) {
      window.clearTimeout(entry.timer)
      entry.timer = null
    }
    entry.source = text
    entry.visible = text
    for (const listener of entry.listeners) listener()
  }

  has(id: string) {
    return (this.entries.get(id)?.source.length ?? 0) > 0
  }

  subscribe(id: string, listener: () => void) {
    const entry = this.entry(id)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  flush(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.timer !== null) {
      window.clearTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.visible === entry.source) return
    entry.visible = entry.source
    for (const listener of entry.listeners) listener()
  }

  remove(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.timer !== null) window.clearTimeout(entry.timer)
    this.entries.delete(id)
  }

  clear() {
    for (const entry of this.entries.values()) {
      if (entry.timer !== null) window.clearTimeout(entry.timer)
    }
    this.entries.clear()
  }
}

function StreamingMarkdownText({ store, messageId, citations, onCitationClick, citationLabel, thinkingLabel, toolStatus, streaming }: { store: StreamingTextStore; messageId: string; citations: AiCitation[]; onCitationClick: (citation: AiCitation) => void; citationLabel: (citationNumber: string) => string; thinkingLabel: string; toolStatus: string | null; streaming: boolean }) {
  const content = useSyncExternalStore(
    (listener) => store.subscribe(messageId, listener),
    () => store.getSnapshot(messageId),
    () => store.getSnapshot(messageId),
  )
  if (!content) return <div className="flex min-h-5 items-center gap-2 text-[var(--bd-read-sub)]" role="status" aria-label={toolStatus ?? thinkingLabel}>
    {toolStatus ? <span>{toolStatus}</span> : <span className="flex items-center gap-1" aria-hidden="true">{[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${dot * 140}ms` }} />)}</span>}
  </div>
  return <MarkdownText content={content} citations={citations} onCitationClick={onCitationClick} citationLabel={citationLabel} streaming={streaming} />
}

export default function AiPanel({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const memoryUserId = user?.id ?? 'anonymous'
  const initialMemoryRef = useRef<AiPanelMemory | null>(null)
  if (initialMemoryRef.current === null) initialMemoryRef.current = readAiPanelMemory(memoryUserId, bookId)
  const initialMemory = initialMemoryRef.current
  const showError = (error: unknown, fallback = 'reader.aiRequestFailed') => notify.error(getUserErrorNotification(error, fallback))
  const queryClient = useQueryClient()
  const aiContext = useReaderState((s) => s.aiContext)
  const setAiContext = useReaderState((s) => s.setAiContext)
  const activeSelection = useReaderState((s) => s.selection)
  const setSelection = useReaderState((s) => s.setSelection)
  const aiPendingCommand = useReaderState((s) => s.aiPendingCommand)
  const setAiPendingCommand = useReaderState((s) => s.setAiPendingCommand)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterHref = useReaderState((s) => s.currentChapterHref)
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [clearIndexOpen, setClearIndexOpen] = useState(false)
  const [preparingIndex, setPreparingIndex] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null)
  const [openBasisId, setOpenBasisId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingTextStore = useRef(new StreamingTextStore()).current
  const activeRunIdRef = useRef<string | null>(null)
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
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const shouldStickToLatestRef = useRef(true)
  const hasPendingLatestRef = useRef(false)
  const [isAtLatest, setIsAtLatest] = useState(true)
  const [hasPendingLatest, setHasPendingLatest] = useState(false)
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
  const latestMessage = messages.at(-1)
  const latestRevisionMessageId = !streaming && latestMessage?.role === 'assistant' && latestMessage.content.trim() && latestMessage.revisionGroupId ? latestMessage.id : null
  const revisionsQuery = useAiMessageRevisions(threadId, latestRevisionMessageId, { enabled: Boolean(latestRevisionMessageId) })
  const indexQuery = useAiIndexStatus(bookId)
  const indexBook = useIndexAiBook()
  const cancelIndex = useCancelAiBookIndex()
  const clearIndex = useClearAiBookIndex()
  const updateAiConfig = useUpdateAiConfig()
  const updateAiProfile = useUpdateAiProfile()
  const selectRevisionMutation = useSelectAiMessageRevision()
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
    streamingTextStore.clear()
  }, [streamingTextStore])
  useEffect(() => {
    const memory = readAiPanelMemory(memoryUserId, bookId)
    conversationSettingsHydratedRef.current = false
    skipMemoryWriteRef.current = true
    requestGenerationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    activeRunIdRef.current = null
    streamingTextStore.clear()
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
    setEditingMessageId(null)
    setEditDraft('')
    setOpenQuoteId(null)
    setOpenBasisId(null)
    shouldStickToLatestRef.current = true
    hasPendingLatestRef.current = false
    setIsAtLatest(true)
    setHasPendingLatest(false)
  }, [bookId, memoryUserId, streamingTextStore])
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
    const generation = threadQuery.data.data.generation
    if (generation?.checkpointText.trim() && !restoredMessages.some((message) => message.id === generation.targetMessageId)) {
      restoredMessages.push({
        id: generation.targetMessageId ?? `run-${generation.id}`,
        role: 'assistant',
        content: generation.checkpointText,
        context: null,
        aborted: generation.state === 'cancelled' || generation.state === 'failed' || generation.state === 'interrupted',
        citations: [],
        savedAsIdea: false,
      })
    }
    const annotations = Array.isArray(annotationsQuery.data?.data) ? annotationsQuery.data.data : []
    for (let index = 1; index < restoredMessages.length; index += 1) {
      const assistantMessage = restoredMessages[index]
      const userMessage = restoredMessages[index - 1]
      if (assistantMessage?.role !== 'assistant' || userMessage?.role !== 'user' || !userMessage.retry) continue
      const selectedText = userMessage.retry.context.selection.trim()
      if (!selectedText || userMessage.retry.context.cfiRange === 'selection') continue
      const ideaTarget = {
        cfiRange: userMessage.retry.context.cfiRange,
        text: selectedText.slice(0, 500),
        ...(userMessage.retry.context.chapterTitle ? { chapter: userMessage.retry.context.chapterTitle } : {}),
        ...(userMessage.retry.context.chapterHref ? { chapterHref: userMessage.retry.context.chapterHref } : {}),
      }
      const savedAsIdea = annotations.some((annotation) => annotation.type === 'note'
        && annotation.cfiRange === ideaTarget.cfiRange
        && annotation.note?.trim() === assistantMessage.content.trim())
      restoredMessages[index] = { ...assistantMessage, ideaTarget, savedAsIdea }
    }
    const lastMessage = restoredMessages.at(-1)
    const previousMessage = restoredMessages.at(-2)
    const recipe = lastMessage?.role === 'assistant' && previousMessage?.role === 'user' ? previousMessage.retry : null
    if (recipe && lastMessage && previousMessage) {
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
        onError: (error) => notify.error(getUserErrorNotification(error, 'reader.aiConversationSettingsFailed')),
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [enabledTools, readingScope, selectedAssistantModeId, streaming, threadId, threadQuery.data, updateThreadSettings])
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
  useLayoutEffect(() => {
    const container = messagesContainerRef.current
    const content = messagesContentRef.current
    if (!container || !content) return
    if (shouldStickToLatestRef.current) container.scrollTop = container.scrollHeight
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      if (shouldStickToLatestRef.current) {
        container.scrollTop = container.scrollHeight
        return
      }
      const contentChanged = entries.some((entry) => entry.target === content)
      if (streaming && contentChanged && !hasPendingLatestRef.current) {
        hasPendingLatestRef.current = true
        setHasPendingLatest(true)
      }
    })
    resizeObserver?.observe(container)
    resizeObserver?.observe(content)
    return () => resizeObserver?.disconnect()
  }, [messages, streaming, threadId])
  useEffect(() => () => {
    if (copiedMessageTimerRef.current !== null) window.clearTimeout(copiedMessageTimerRef.current)
  }, [])

  const selectionContext = aiContext ?? activeSelection
  const selection = selectionContext?.rawText?.trim() || selectionContext?.text.trim() || ''
  const selectionPreview = selection.replace(/\s+/g, ' ')
  const currentParagraph = renderer?.getCurrentParagraphText?.()?.trim() ?? ''
  const chapterTitle = aiContext?.chapterTitle ?? activeSelection?.chapterTitle ?? currentChapter
  const chapterHref = aiContext?.chapterHref ?? currentChapterHref
  const chapterIndex = aiContext?.chapterIndex ?? activeSelection?.chapterIndex ?? currentChapterIndex ?? -1
  const modelReady = Boolean(statusQuery.data?.data.enabled)
  const modelLabel = modelReady ? statusQuery.data?.data.model ?? _('reader.aiCurrentModel') : _('reader.aiSelectModel')
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
  const assistantModeLabel = (mode: AiAssistantMode) => mode.id === DEFAULT_ASSISTANT_MODE.id && mode.name === DEFAULT_ASSISTANT_MODE.name ? _('reader.aiDefaultAssistantModeName') : mode.name
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
  const indexStatusLabel = preparingIndex
    ? _('reader.aiIndexReading')
    : indexStatus === 'indexing'
      ? _(indexQuery.data?.data.embeddingStatus === 'indexing' ? 'reader.aiEmbeddingBuilding' : 'reader.aiIndexBuilding')
      : indexStatus === 'ready'
        ? _('reader.aiIndexReady')
        : indexStatus === 'stale'
          ? _('reader.aiIndexNeedsRebuild')
          : indexStatus === 'failed'
            ? _('reader.aiIndexFailed')
            : indexStatus === 'not_indexed'
              ? _('reader.aiIndexNotBuilt')
              : ''
  const indexActionShortLabel = preparingIndex || indexStatus === 'indexing' || indexBook.isPending
    ? _('reader.aiIndexCancelShort')
    : visibleCorpusMismatch
      ? _('reader.aiCorpusRebuildShort')
      : embeddingConfigMismatch
        ? _('reader.aiEmbeddingRebuildShort')
        : indexQuery.data?.data.embeddingStatus === 'failed'
          ? _('reader.aiEmbeddingRetryShort')
          : indexStatus === 'failed' || indexStatus === 'stale'
            ? _('reader.aiIndexRebuildShort')
            : _('reader.aiIndexBuildShort')

  function updateAssistant(id: string, update: (message: AiMessage) => AiMessage) {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message))
  }

  function scrollToLatest() {
    shouldStickToLatestRef.current = true
    hasPendingLatestRef.current = false
    setIsAtLatest(true)
    setHasPendingLatest(false)
    const container = messagesContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }

  function handleMessagesScroll() {
    const container = messagesContainerRef.current
    if (!container) return
    const nearLatest = container.scrollHeight - container.scrollTop - container.clientHeight <= 64
    shouldStickToLatestRef.current = nearLatest
    setIsAtLatest((current) => current === nearLatest ? current : nearLatest)
    if (nearLatest) {
      hasPendingLatestRef.current = false
      setHasPendingLatest(false)
    }
  }

  function beginEditMessage(message: AiMessage) {
    if (streaming || message.role !== 'user' || !message.retry) return
    setEditingMessageId(message.id)
    setEditDraft(message.content)
    setOpenQuoteId(null)
    setOpenBasisId(null)
  }

  function cancelEditMessage() {
    setEditingMessageId(null)
    setEditDraft('')
  }

  function submitEditMessage(message: AiMessage) {
    const prompt = editDraft.trim()
    if (streaming || message.role !== 'user' || message.id !== editingMessageId || !prompt || !message.retry || !threadId) return
    const messageIndex = messages.findIndex((current) => current.id === message.id)
    const latestUserMessage = [...messages].reverse().find((current) => current.role === 'user')
    const nextMessage = messageIndex >= 0 ? messages[messageIndex + 1] : undefined
    if (message.id !== latestUserMessage?.id || messageIndex < 0 || nextMessage?.role !== 'assistant') return
    const recipe = message.retry
    const assistantModePrompt = recipe.assistantModePrompt
      ?? (recipe.assistantMode === DEFAULT_ASSISTANT_MODE.name ? DEFAULT_ASSISTANT_MODE.prompt : undefined)
    const request: AiRequest = {
      threadId,
      regenerate: true,
      editMessageId: message.id,
      prompt,
      context: recipe.context,
      history: messages.slice(0, messageIndex).map((current) => ({
        role: current.role,
        content: current.content,
        ...(current.role === 'user' && current.retry?.context ? { context: current.retry.context } : {}),
      })).filter((current) => current.content.trim()),
      enabledTools: [...recipe.enabledTools],
      readingScope: recipe.readingScope,
      assistantModeId: recipe.assistantModeId ?? DEFAULT_ASSISTANT_MODE.id,
      ...(recipe.assistantMode ? { assistantMode: recipe.assistantMode } : {}),
      ...(assistantModePrompt ? { assistantModePrompt } : {}),
    }
    cancelEditMessage()
    void runRequest(request, 2)
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
    setAiPendingCommand(null)
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
    setEditingMessageId(null)
    setEditDraft('')
    shouldStickToLatestRef.current = true
    hasPendingLatestRef.current = false
    setIsAtLatest(true)
    setHasPendingLatest(false)
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
    setAiPendingCommand(null)
    setQuickCommandMenuOpen(false)
    setAttachmentOpen(false)
    setToolsOpen(false)
    setRetryRequest(null)
    setHistoryOpen(false)
    setEditingMessageId(null)
    setEditDraft('')
    shouldStickToLatestRef.current = true
    hasPendingLatestRef.current = false
    setIsAtLatest(true)
    setHasPendingLatest(false)
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
      onError: (error) => showError(error),
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
    if (nextScope === 'full_book') {
      notify.warning({ key: 'reader.aiReadingScopeFullWarning' })
    } else {
      notify.info({ key: 'reader.aiReadingScope', params: { scope: readingScopeLabel(nextScope, _) } })
    }
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
       notify.success({ key: assistantModeForm.id ? 'reader.aiModeUpdated' : 'reader.aiModeAdded' })
     },
     onError: (error) => showError(error),
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
        notify.success({ key: 'reader.aiModeRestored' })
      },
      onError: (error) => showError(error),
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
        notify.success({ key: 'reader.aiModeDeleted' })
      },
      onError: (error) => showError(error),
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
      onError: (error) => showError(error),
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
      onError: (error) => showError(error),
    })
  }

  async function runRequest(request: AiRequest, replaceMessageCount = 0) {
    if (streaming) return
    const requestGeneration = requestGenerationRef.current
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
      ? {
          cfiRange: request.context.cfiRange,
          text: selectedText.slice(0, 500),
          ...(request.context.chapterTitle ? { chapter: request.context.chapterTitle } : {}),
          ...(request.context.chapterHref ? { chapterHref: request.context.chapterHref } : {}),
        }
      : undefined
    shouldStickToLatestRef.current = true
    hasPendingLatestRef.current = false
    setIsAtLatest(true)
    setHasPendingLatest(false)
    setMessages((current) => [...(replaceMessageCount > 0 ? current.slice(0, Math.max(0, current.length - replaceMessageCount)) : current), userMessage, { id: assistantId, role: 'assistant', content: '', context: null, aborted: false, citations: [], savedAsIdea: false, ...(ideaTarget ? { ideaTarget } : {}) }])
    setPrompt('')
    setRetryRequest(null)
    setToolStatus(null)
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    activeRunIdRef.current = null
    let activeThreadId = request.threadId

    try {
      await apiStreamAiChat({ bookId, ...request, ...(request.threadId ? { history: undefined } : {}) }, {
        onMeta: (event) => {
          if (requestGenerationRef.current !== requestGeneration) return
          if (event.runId) activeRunIdRef.current = event.runId
          updateAssistant(assistantId, (message) => ({ ...message, context: event.receipt }))
          if (event.threadId) {
            activeThreadId = event.threadId
            setThreadId(event.threadId)
          }
        },
        onDelta: (delta) => {
          if (requestGenerationRef.current !== requestGeneration) return
          streamingTextStore.append(assistantId, delta)
        },
        onDone: (event) => {
          if (requestGenerationRef.current !== requestGeneration) return
          streamingTextStore.set(assistantId, event.content)
          updateAssistant(assistantId, (message) => ({ ...message, content: event.content, citations: event.citations }))
        },
        onTool: (event) => {
          if (requestGenerationRef.current !== requestGeneration) return
          if (event.phase === 'start') {
              setToolStatus(event.name === 'get_book_toc'
                ? _('reader.aiToolReadingToc')
                : event.name === 'search_book'
                  ? _('reader.aiToolSearchingBook')
                  : event.name === 'list_annotations'
                    ? _('reader.aiToolListingAnnotations')
                    : event.name === 'search_annotations'
                      ? _('reader.aiToolSearchingAnnotations')
                      : typeof event.chapterIndex === 'number' ? _('reader.aiToolReadingChapter', { n: event.chapterIndex + 1 }) : _('reader.aiToolReadingText'))
          } else {
            setToolStatus(null)
          }
        },
      }, controller.signal)
      if (requestGenerationRef.current === requestGeneration) setRetryRequest(activeThreadId ? { ...request, threadId: activeThreadId, regenerate: true } : request)
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration) return
      setRetryRequest(activeThreadId ? { ...request, threadId: activeThreadId, regenerate: true } : request)
      if (!controller.signal.aborted) {
        const message = getUserErrorMessage(error, _, 'reader.aiRequestFailed')
        updateAssistant(assistantId, (current) => {
          const content = streamingTextStore.getText(assistantId) || current.content
          return { ...current, content: content ? `${content}\n\n${_('reader.aiRequestFailedWithMessage', { message })}` : _('reader.aiRequestFailedWithMessage', { message }) }
        })
      } else {
        updateAssistant(assistantId, (current) => {
          const content = streamingTextStore.getText(assistantId) || current.content
          return { ...current, content, aborted: true }
        })
      }
    } finally {
      if (requestGenerationRef.current === requestGeneration) {
        streamingTextStore.flush(assistantId)
        const streamedText = streamingTextStore.getText(assistantId)
        setMessages((current) => current.map((message) => message.id === assistantId && !message.content && streamedText ? { ...message, content: streamedText } : message))
        abortRef.current = null
        activeRunIdRef.current = null
        setToolStatus(null)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, bookId] }),
          activeThreadId
            ? queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, 'detail', activeThreadId] })
            : Promise.resolve(),
        ]).catch(() => undefined)
        if (requestGenerationRef.current === requestGeneration) {
          setStreaming(false)
        }
      }
    }
  }

  async function send(promptOverride?: string) {
    const template = (promptOverride ?? prompt).trim()
    if (!modelReady || !template || streaming || preparingReferences) return
    const promptVariables = getAiPromptVariables(template)
    const selectedParagraph = aiContext?.paragraphText?.trim() || activeSelection?.paragraphText?.trim() || currentParagraph
    if (readingScope !== 'full_book' && chapterIndex >= 0 && selectedChapterReferences.some((referenceIndex) => referenceIndex > chapterIndex)) {
      notify.warning({ key: 'reader.aiFutureChapterWarning' })
    }
    const history: AiHistoryMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.role === 'user' && message.retry?.context ? { context: message.retry.context } : {}),
    })).filter((message) => message.content.trim())
    const referenceIndexes = new Set(selectedChapterReferences)
    if (promptVariables.includes('CHAPTER') && chapterIndex >= 0 && renderer?.getAiChapterText) referenceIndexes.add(chapterIndex)
    let chapterReferences: AiChapterReference[] | undefined
    if (referenceIndexes.size > 0) {
      if (!renderer?.getAiChapterText) {
        notify.error({ key: 'reader.aiReaderNotReady' })
        return
      }
      setPreparingReferences(true)
      try {
        const references = await Promise.all([...referenceIndexes].map(async (referenceIndex) => ({
          chapterIndex: referenceIndex,
          chapterTitle: chapters[referenceIndex]?.title,
          text: await renderer.getAiChapterText(referenceIndex),
        })))
        chapterReferences = references.map((reference) => ({
          ...reference,
          ...(reference.chapterTitle ? { chapterTitle: reference.chapterTitle } : {}),
        }))
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) showError(error, 'reader.aiQuoteChapterFailed')
        return
      } finally {
        setPreparingReferences(false)
      }
    }
    if (template.length > AI_MAX_CHAT_PROMPT_CHARS) {
      notify.error({ key: 'reader.aiPromptTooLong' })
      return
    }
    void runRequest({
      ...(threadId ? { threadId } : {}),
      prompt: template,
      history,
      context: {
        chapterIndex,
        chapterTitle: chapterTitle ?? undefined,
        ...(chapterHref ? { chapterHref } : {}),
        cfiRange: selectionContext?.cfiRange ?? 'selection',
        selection,
        ...(promptVariables.includes('SELPARA') && selectedParagraph ? { paragraph: selectedParagraph } : {}),
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
    if (!aiContext && activeSelection) {
      renderer?.deselect()
      setSelection(null)
    }
  }

  sendRef.current = send

  useEffect(() => {
    if (!aiPendingCommand || streaming || statusQuery.isPending) return
    const pendingCommand = aiPendingCommand
    setAiPendingCommand(null)
    setPrompt(pendingCommand.prompt)
    setQuickCommandMenuOpen(false)
    if (modelReady) void sendRef.current(pendingCommand.prompt)
  }, [aiPendingCommand, modelReady, setAiPendingCommand, statusQuery.isPending, streaming])

  async function stop() {
    const runId = activeRunIdRef.current
    const controller = abortRef.current
    if (runId) {
      try {
        await apiPost(`/ai/runs/${encodeURIComponent(runId)}/cancel`)
      } catch {
        // The stream abort below still records a disconnect if cancellation races with the server.
      }
    }
    controller?.abort()
  }

  function selectRevision(messageId: string) {
    if (!threadId || streaming || selectRevisionMutation.isPending) return
    selectRevisionMutation.mutate({ threadId, messageId }, {
      onSuccess: async () => {
        const refreshed = await threadQuery.refetch()
        if (refreshed.data?.data.id === threadId) setMessages(refreshed.data.data.messages.map(fromPersistedMessage))
      },
      onError: (error) => showError(error),
    })
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
      notify.info({ key: 'reader.aiCopied' })
    } catch {
      notify.error({ key: 'reader.aiCopyFailed' })
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
        ...(message.ideaTarget.chapterHref ? { chapterHref: message.ideaTarget.chapterHref } : {}),
        note: message.content.trim(),
      })
      updateAssistant(message.id, (current) => ({ ...current, savedAsIdea: true }))
      notify.success({ key: 'reader.aiSavedAsIdea' })
    } catch {
      notify.error({ key: 'reader.aiSaveIdeaFailed' })
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
      notify.success({ key: 'reader.aiExported' })
    } catch {
      notify.error({ key: 'reader.aiExportFailed' })
    }
  }

  function selectModel(model: string) {
    const activeProfileId = statusQuery.data?.data.activeProfileId
    if (!model || model === statusQuery.data?.data.model || !activeProfileId || updateAiConfig.isPending || updateAiProfile.isPending) return
    updateAiProfile.mutate({ id: activeProfileId, body: { model } }, { onError: (error) => showError(error) })
  }

  async function buildBookIndex() {
    if (preparingIndex || indexBook.isPending || indexQuery.data?.data.status === 'indexing') return
    const controller = new AbortController()
    indexAbortRef.current = controller
    setPreparingIndex(true)
    try {
      if (!renderer?.getAiCorpus) {
        notify.error({ key: 'reader.aiIndexReaderNotReady' })
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
          showError(error)
        },
        onSettled: () => {
          if (indexAbortRef.current === controller) indexAbortRef.current = null
        },
      })
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) showError(error, 'reader.aiIndexBuildFailed')
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
    cancelIndex.mutate({ bookId }, { onError: (error) => showError(error) })
  }

  function confirmClearIndex() {
    clearIndex.mutate(bookId, {
      onSuccess: () => {
        setClearIndexOpen(false)
        notify.success({ key: 'reader.aiIndexCleared' })
      },
      onError: (error) => showError(error),
    })
  }

  function jumpToCitation(citation: AiCitation) {
    if (!renderer) return
    const target = citation.sourceCfi ?? `search-hit-chapter:${citation.chapterIndex}:${citation.startOffset}:${citation.endOffset}`
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
  const latestUserMessageId = useMemo(() => [...messages].reverse().find((message) => message.role === 'user')?.id ?? null, [messages])

  return (
    <div data-testid="ai-panel" className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bd-read-bg)] @container/ai-panel">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center border-b border-[var(--bd-read-accent)] px-4 @max-[240px]/ai-panel:px-2" style={{ backgroundColor: 'var(--bd-read-bg)' }}>
        <div ref={assistantModeMenuRef} className="relative min-w-0 max-w-40 shrink @max-[320px]/ai-panel:max-w-28 @max-[240px]/ai-panel:max-w-20">
          <button type="button" onClick={() => { setAssistantModeMenuOpen((open) => !open); setAttachmentOpen(false); setToolsOpen(false); setModelMenuOpen(false); setHistoryOpen(false); setMoreOpen(false) }} aria-label={_('reader.aiSelectAssistantMode')} aria-haspopup="menu" aria-expanded={assistantModeMenuOpen} title={assistantModeLabel(selectedAssistantMode)} className={`flex min-w-0 max-w-full items-center gap-0.5 rounded px-1 py-0.5 text-sm font-medium text-current outline-none transition-colors hover:bg-stone-500/10 focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] ${assistantModeMenuOpen ? 'bg-stone-500/10' : ''}`}>
            <span className="min-w-0 flex-1 truncate">{assistantModeLabel(selectedAssistantMode)}</span>
            <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${assistantModeMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          {assistantModeMenuOpen && (
            <div role="menu" aria-label={_('reader.aiSelectAssistantMode')} className="absolute left-0 top-full z-30 mt-2 min-w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 shadow-xl">
              {availableAssistantModes.map((mode) => <div key={mode.id} role="none" className={`group/mode-row flex min-h-9 items-center gap-1 overflow-hidden rounded-lg transition-colors ${mode.id === selectedAssistantMode.id ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-primary)] hover:bg-[var(--bd-read-primary)]/20' : 'text-current hover:bg-stone-500/15'}`}>
                <button type="button" role="menuitemradio" aria-checked={mode.id === selectedAssistantMode.id} onClick={() => selectAssistantMode(mode)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--bd-read-primary)]">
                  <span className="min-w-0 flex-1 truncate">{assistantModeLabel(mode)}</span>
                </button>
                <button type="button" role="menuitem" aria-label={`${_('reader.aiEditMode')} ${assistantModeLabel(mode)}`} title={_('reader.aiEditMode')} onClick={(event) => { event.stopPropagation(); openAssistantModeForm(mode) }} className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-black/5 hover:text-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] dark:hover:bg-white/10">
                  {mode.id === selectedAssistantMode.id ? <><span className="group-hover/mode-row:hidden group-focus-within/mode-row:hidden"><CheckIcon /></span><span className="hidden group-hover/mode-row:inline-flex group-focus-within/mode-row:inline-flex"><EditIcon /></span></> : <EditIcon />}
                </button>
              </div>)}
              <div className="mt-1 border-t border-[var(--bd-read-accent)] pt-1">
                <button type="button" role="menuitem" onClick={() => openAssistantModeForm()} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-[var(--bd-read-primary)] transition-colors hover:bg-stone-500/15">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  <span>{_('reader.aiAddMode')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <button type="button" onClick={cycleReadingScope} aria-label={_('reader.aiReadingScopeToggle', { scope: readingScopeLabel(readingScope, _) })} title={_('reader.aiReadingScopeCurrent', { scope: readingScopeLabel(readingScope, _) })} className={`ml-2 flex h-7 w-7 items-center justify-center rounded-md transition-all active:scale-95 hover:bg-stone-500/10 @max-[240px]/ai-panel:ml-1 ${readingScope === 'full_book' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'text-[var(--bd-read-sub)] hover:text-current'}`}>
          <ReadingScopeIcon scope={readingScope} />
        </button>
        <div className="ml-auto flex items-center gap-2 text-[var(--bd-read-sub)] @max-[240px]/ai-panel:gap-1">
          <button type="button" onClick={startNewChat} disabled={streaming} aria-label={_('reader.aiNew')} title={_('reader.aiNew')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button ref={historyButtonRef} type="button" onClick={() => { if (!streaming) { setAttachmentOpen(false); setToolsOpen(false); setMoreOpen(false); setHistoryOpen((open) => !open) } }} disabled={streaming} aria-label={_('reader.aiHistory')} title={_('reader.aiHistory')} aria-expanded={historyOpen} className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40 ${historyOpen ? 'bg-stone-500/10 text-current' : ''}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 5v4h4M12 7v5l3 2" /></svg>
          </button>
          <button ref={moreButtonRef} type="button" onClick={() => { setHistoryOpen(false); setModelMenuOpen(false); setAttachmentOpen(false); setToolsOpen(false); setMoreOpen(!moreOpen) }} aria-label={_('reader.aiMore')} title={_('reader.aiMore')} aria-expanded={moreOpen} className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/10 hover:text-current ${moreOpen ? 'bg-stone-500/10 text-current' : ''}`}>
            <MoreIcon />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {messages.length > 0 ? (
            <div ref={messagesContainerRef} data-testid="ai-messages" onScroll={handleMessagesScroll} className={`${READ_SCROLLBAR_CLASSES} h-full overflow-y-auto overscroll-contain px-3 pb-2 pt-4`}>
              <div ref={messagesContentRef} className="space-y-3">
            {messages.map((message, index) => {
              const quoteContext = message.role === 'user' ? message.retry?.context : null
              const quoteChapterTitle = quoteContext?.chapterTitle || (quoteContext && chapters[quoteContext.chapterIndex]?.title) || ''
              const quoteTarget = quoteContext && quoteContext.cfiRange !== 'selection' ? quoteContext.cfiRange : quoteContext ? `chapter:${quoteContext.chapterIndex}` : ''
              const quoteEntries = quoteContext ? [
                ...(quoteContext.selection.trim() ? [{ id: 'selection', label: `${quoteChapterTitle || _('reader.aiCurrentChapter')} · ${_('reader.aiSelectedText')}`, text: quoteContext.selection.trim(), target: quoteTarget }] : []),
                ...(quoteContext.paragraph?.trim() ? [{ id: 'paragraph', label: `${quoteChapterTitle || _('reader.aiCurrentChapter')} · ${_('reader.aiSelectedParagraph')}`, text: quoteContext.paragraph.trim(), target: quoteTarget }] : []),
                ...(quoteContext.chapterReferences ?? []).map((reference) => ({
                  id: `chapter-${reference.chapterIndex}`,
                  label: reference.chapterTitle || chapters[reference.chapterIndex]?.title || _('reader.aiChapterNumber', { n: reference.chapterIndex + 1 }),
                  text: reference.text.trim(),
                  target: `chapter:${reference.chapterIndex}`,
                })),
              ] : []
              const singleQuote = quoteEntries.length === 1 ? quoteEntries[0] : null
              const hasBasis = message.role === 'assistant' && message.citations.length > 0
              const quoteOpen = openQuoteId === message.id
              const basisOpen = openBasisId === message.id
              const hasStreamContent = message.role === 'assistant' && streamingTextStore.has(message.id)
              const isActiveStreamMessage = message.role === 'assistant' && streaming && index === messages.length - 1 && (!message.content || hasStreamContent)
              const revisionOptions = message.id === latestRevisionMessageId ? revisionsQuery.data?.data ?? [] : []
              const selectedRevisionIndex = Math.max(0, revisionOptions.findIndex((revision) => revision.selected || revision.id === message.id))
              const isEditingMessage = editingMessageId === message.id
              const isLatestEditableUser = message.role === 'user' && message.id === latestUserMessageId && messages[index + 1]?.role === 'assistant' && Boolean(message.retry) && !streaming
              const isStoppedPlaceholder = message.aborted && (message.content === _('reader.aiStopped') || message.content === '（已停止）' || message.content === '(已停止)')
              const hasVisibleContent = Boolean(message.content && !isStoppedPlaceholder)
              return (
                <div key={message.id} className={`group flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={message.role === 'user' ? 'w-fit max-w-[85%] break-words rounded-xl bg-[var(--bd-read-accent)]/20 p-3 text-sm [text-autospace:normal]' : 'w-fit max-w-[92%] break-words rounded-xl bg-[var(--bd-read-page-bg)] p-3 text-[13.5px] leading-[1.75] [text-autospace:normal]'}>
                    {quoteEntries.length > 0 && <div className="mb-2 w-full text-[11px] text-[var(--bd-read-sub)]">
                      {singleQuote ? singleQuote.id.startsWith('chapter-') ? <AiChapterReferenceChip title={singleQuote.label} disabled={!renderer} onActivate={() => jumpToQuote(singleQuote.target)} ariaLabel={_('reader.aiQuoteJump', { n: 1, label: singleQuote.label })} /> : <button type="button" disabled={!renderer} onClick={() => jumpToQuote(singleQuote.target)} aria-label={_('reader.aiQuoteJump', { n: 1, label: singleQuote.label })} className={`flex min-h-8 max-w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1 text-left text-sm transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current disabled:cursor-default disabled:opacity-70 ${singleQuote.id === 'selection' ? 'border-[var(--bd-read-primary)]/50 bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] text-current'}`}>
                        {singleQuote.id === 'selection' ? <SelectedPositionIcon size={14} /> : <ChapterReferenceIcon />}
                        <span className="min-w-0 flex-1 truncate">{singleQuote.id === 'selection' ? singleQuote.text : singleQuote.label}</span>
                      </button> : <>
                        <button type="button" aria-expanded={quoteOpen} aria-controls={`message-quotes-${message.id}`} onClick={() => setOpenQuoteId(quoteOpen ? null : message.id)} className="flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current">
                          <span>{_('reader.aiQuoteSummary', { n: quoteEntries.length })}</span>
                          <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${quoteOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                        </button>
                        {quoteOpen && <div id={`message-quotes-${message.id}`} className="mt-2 space-y-1 rounded-lg bg-stone-500/5 p-2">
                          {quoteEntries.map((entry, entryIndex) => <button key={entry.id} type="button" disabled={!renderer} onClick={() => jumpToQuote(entry.target)} aria-label={_('reader.aiQuoteJump', { n: entryIndex + 1, label: entry.label })} className="flex min-h-9 w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current disabled:cursor-default disabled:opacity-70">
                            <span className="shrink-0 pt-0.5">{entryIndex + 1}</span>
                            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-current">{entry.label}</span><span className="block max-h-10 overflow-hidden leading-relaxed">{entry.text}</span></span>
                          </button>)}
                        </div>}
                      </>}
                    </div>}
                    {isEditingMessage ? <form className="min-w-0 w-full max-w-64" onSubmit={(event) => { event.preventDefault(); submitEditMessage(message) }}>
                      <textarea autoFocus value={editDraft} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEditMessage()
                        } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                          event.preventDefault()
                          submitEditMessage(message)
                        }
                      }} aria-label={_('reader.aiEditMessage')} className="min-h-20 w-full resize-y rounded-lg border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-[var(--bd-read-primary)]" />
                      <div className="mt-2 flex items-center justify-end gap-1.5">
                        <button type="button" onClick={cancelEditMessage} className="rounded-md px-2.5 py-1.5 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-current">{_('reader.aiCancel')}</button>
                        <button type="submit" disabled={!editDraft.trim()} className="rounded-md bg-[var(--bd-read-primary)] px-2.5 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50">{_('reader.aiRegenerate')}</button>
                      </div>
                    </form> : isActiveStreamMessage || hasStreamContent ? <StreamingMarkdownText store={streamingTextStore} messageId={message.id} citations={message.citations} onCitationClick={jumpToCitation} citationLabel={(n) => _('reader.aiCitationJump', { n })} thinkingLabel={_('reader.aiThinking')} toolStatus={toolStatus} streaming={isActiveStreamMessage} /> : hasVisibleContent ? (message.role === 'assistant' ? <MarkdownText content={message.content} citations={message.citations} onCitationClick={jumpToCitation} citationLabel={(n) => _('reader.aiCitationJump', { n })} /> : <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content.split(AI_PROMPT_PLACEHOLDER_PATTERN).map((part, partIndex) => AI_PROMPT_PLACEHOLDERS.has(part) ? <span key={`${part}-${partIndex}`} className="mx-0.5 inline-flex items-center rounded-md border border-[var(--bd-read-primary)]/30 bg-[var(--bd-read-primary)]/10 px-1.5 py-0.5 font-mono text-[11.5px] font-medium tracking-tight text-[var(--bd-read-primary)] select-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] align-baseline">{part}</span> : <Fragment key={`${part}-${partIndex}`}>{part}</Fragment>)}</div>) : null}
                  {message.aborted && <div className="mt-2 text-[11px] text-[var(--bd-read-sub)]">{_('reader.aiStoppedLabel')}</div>}
                  </div>
                  {hasBasis && (
                    <div className="mt-1 w-full max-w-[92%] pl-2 text-[11px] text-[var(--bd-read-sub)] [text-autospace:normal]">
                      <button type="button" aria-expanded={basisOpen} aria-controls={`answer-basis-${message.id}`} onClick={() => setOpenBasisId(basisOpen ? null : message.id)} className="flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-stone-500/15 hover:text-current">
                        <span>{_('reader.aiBasisSummary', { n: message.citations.length })}</span>
                        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${basisOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                      </button>
                      {basisOpen && <div id={`answer-basis-${message.id}`} className="mt-2 space-y-1 rounded-lg bg-stone-500/5 p-2.5">
                        {message.citations.map((citation, citationIndex) => <button key={`${citation.id}-${citationIndex}`} type="button" disabled={!renderer} onClick={() => jumpToCitation(citation)} title={citation.excerpt} aria-label={_('reader.aiBasisJump', { n: citationIndex + 1, label: citation.sourceType === 'annotation' ? citation.chapterTitle || _('reader.aiNotes') : citation.chapterTitle || _('reader.aiChapterNumber', { n: citation.chapterIndex + 1 }) })} className="flex min-h-9 w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-stone-500/15 hover:text-current disabled:cursor-default disabled:opacity-70">
                          <span className="shrink-0 pt-0.5">{citationIndex + 1}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium text-current">{citation.sourceType === 'annotation' ? citation.chapterTitle || _('reader.aiNotes') : citation.chapterTitle || _('reader.aiChapterNumber', { n: citation.chapterIndex + 1 })}</span><span className="block max-h-10 overflow-hidden leading-relaxed">{citation.excerpt}</span></span>
                        </button>)}
                      </div>}
                    </div>
                  )}
                  {message.role === 'assistant' && (hasVisibleContent || message.aborted) && !streaming && (
                    <div className="mt-1 flex max-h-7 items-center gap-1 overflow-hidden pl-2 text-[var(--bd-read-sub)] opacity-100 transition-[max-height,margin,opacity] [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:mt-0 [@media(hover:hover)]:max-h-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:mt-1 [@media(hover:hover)]:group-hover:max-h-7 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:pointer-events-auto [@media(hover:hover)]:group-focus-within:mt-1 [@media(hover:hover)]:group-focus-within:max-h-7 [@media(hover:hover)]:group-focus-within:opacity-100">
                      <button type="button" disabled={!hasVisibleContent} onClick={() => void copyAssistantMessage(message.id, message.content)} aria-label={copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')} title={copiedMessageId === message.id ? _('reader.aiCopied') : _('reader.aiCopy')} className={`flex h-7 w-7 items-center justify-center rounded transition-colors active:scale-95 ${copiedMessageId === message.id ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]' : 'hover:bg-stone-500/15 hover:text-current disabled:cursor-default disabled:opacity-50'}`}>{copiedMessageId === message.id ? <CheckIcon /> : <CopyIcon />}</button>
                      {message.ideaTarget && !message.aborted && <button type="button" onClick={() => void saveAssistantAsIdea(message)} disabled={message.savedAsIdea || createAnnotation.isPending} aria-label={message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')} title={message.savedAsIdea ? _('reader.aiIdeaSaved') : _('reader.aiSaveAsIdea')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/15 hover:text-current disabled:cursor-default disabled:opacity-60"><BulbIcon size={14} /></button>}
                      {retryRequest && index === messages.length - 1 && <button type="button" onClick={() => void runRequest(retryRequest, 2)} aria-label={_('reader.aiRetry')} title={_('reader.aiRetry')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/15 hover:text-current"><RetryIcon /></button>}
                      {revisionOptions.length > 1 && <div className="ml-1 flex items-center gap-0.5 rounded-md bg-stone-500/5 px-0.5" aria-label={_('reader.aiAnswerVersions')}>
                        <button type="button" disabled={selectedRevisionIndex <= 0 || selectRevisionMutation.isPending} onClick={() => selectRevision(revisionOptions[selectedRevisionIndex - 1]!.id)} aria-label={_('reader.aiPreviousAnswer')} title={_('reader.aiPreviousAnswer')} className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-stone-500/15 hover:text-current disabled:cursor-not-allowed disabled:opacity-35"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>
                        <span className="min-w-8 text-center text-[10px] tabular-nums" aria-live="polite">{selectedRevisionIndex + 1}/{revisionOptions.length}</span>
                        <button type="button" disabled={selectedRevisionIndex >= revisionOptions.length - 1 || selectRevisionMutation.isPending} onClick={() => selectRevision(revisionOptions[selectedRevisionIndex + 1]!.id)} aria-label={_('reader.aiNextAnswer')} title={_('reader.aiNextAnswer')} className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-stone-500/15 hover:text-current disabled:cursor-not-allowed disabled:opacity-35"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg></button>
                      </div>}
                    </div>
                  )}
                  {isLatestEditableUser && !isEditingMessage && <div className="mt-1 flex max-h-7 items-center justify-end overflow-hidden pr-2 text-[var(--bd-read-sub)] opacity-100 transition-[max-height,margin,opacity] [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:mt-0 [@media(hover:hover)]:max-h-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:mt-1 [@media(hover:hover)]:group-hover:max-h-7 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:pointer-events-auto [@media(hover:hover)]:group-focus-within:mt-1 [@media(hover:hover)]:group-focus-within:max-h-7 [@media(hover:hover)]:group-focus-within:opacity-100">
                    <button type="button" onClick={() => beginEditMessage(message)} aria-label={_('reader.aiEditMessage')} title={_('reader.aiEditMessage')} className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-stone-500/15 hover:text-current"><EditIcon /></button>
                  </div>}
                </div>
              )
              })}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center pb-16 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]"><AiChatIcon /></div>
              <p className="text-base font-normal text-current">{_('reader.aiStartChat')}</p>
            </div>
          )}
          {messages.length > 0 && (!isAtLatest || hasPendingLatest) && <button type="button" onClick={scrollToLatest} aria-label={_('reader.aiBackToLatest')} title={hasPendingLatest ? _('reader.aiViewNewAnswer') : _('reader.aiBackToLatest')} className="absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] px-2.5 text-xs text-[var(--bd-read-sub)] shadow-md transition-colors hover:bg-stone-500/15 hover:text-current">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v15M6.5 13.5 12 19l5.5-5.5" /></svg>
            {hasPendingLatest && <span>{_('reader.aiNewAnswer')}</span>}
          </button>}
        </div>

        <div className="shrink-0 px-3 pb-3 pt-3">
          <form ref={composerFormRef} className="relative w-full @container/composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
            {attachmentOpen && (
              <aside ref={attachmentRef} data-testid="ai-attachment-menu" aria-label={_('reader.aiAddChapterReference')} className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[min(360px,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
                <h3 className="border-b border-[var(--bd-read-accent)] px-3 py-3 text-sm font-medium text-current">{_('reader.aiAddChapterReference')}</h3>
                {chaptersQuery.isFetching && chapters.length === 0 ? <p className="px-3 py-5 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.aiToolReadingToc')}</p> : chapters.length === 0 ? <p className="px-3 py-5 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.aiNoChapters')}</p> : <ul className={`${READ_SCROLLBAR_CLASSES} min-h-0 space-y-1 overflow-y-auto overscroll-contain p-1.5`}>
                  {visibleChapterReferenceNodes.map((node) => {
                    const chapter = chapters[node.index]!
                    const chapterIndex = node.index
                    const selected = selectedChapterReferences.includes(chapterIndex)
                    const collapsed = collapsedChapterReferences.has(chapterIndex)
                    return <li key={chapter.id} style={{ paddingLeft: `${node.depth * 0.75}rem` }}><div className={`flex min-h-9 items-center rounded-lg transition-colors ${selected ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-primary)] hover:bg-[var(--bd-read-primary)]/20' : 'text-current hover:bg-stone-500/15'}`}>
                      {node.hasChildren ? <button type="button" onClick={() => toggleChapterReferenceGroup(chapterIndex)} aria-label={`${collapsed ? _('reader.aiExpand') : _('reader.aiCollapse')} ${chapter.title}`} title={collapsed ? _('reader.aiExpand') : _('reader.aiCollapse')} className="flex h-9 w-7 shrink-0 items-center justify-center text-[var(--bd-read-sub)] hover:text-current">
                        <svg className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                      </button> : <span className="w-7 shrink-0" />}
                      <button type="button" aria-pressed={selected} title={chapter.title} onClick={() => toggleChapterReference(chapterIndex)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 pr-2.5 text-left text-sm">
                        <span className="shrink-0 text-[var(--bd-read-sub)]"><ChapterReferenceIcon /></span><span className="min-w-0 flex-1 truncate">{chapter.title}</span>{selected && <CheckIcon />}
                      </button>
                    </div></li>
                  })}
                </ul>}
                {readingScope !== 'full_book' && chapterIndex >= 0 && selectedChapterReferences.some((referenceIndex) => referenceIndex > chapterIndex) && <p className="border-t border-[var(--bd-read-accent)] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{_('reader.aiFutureChapterAttachmentHint')}</p>}
              </aside>
            )}
            {toolsOpen && (
              <aside ref={toolsRef} data-testid="ai-tools-menu" aria-label={_('reader.aiTools')} className="absolute bottom-full left-0 z-30 mb-2 w-full overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
                <h3 className="border-b border-[var(--bd-read-accent)] px-3 py-3 text-sm font-medium text-current">{_('reader.aiTools')}</h3>
                <ul className="divide-y divide-[var(--bd-read-accent)]/60 px-1.5 py-1">
                  {AI_PERMISSION_OPTIONS.map((option) => {
                    const enabled = option.toolNames.every((name) => enabledTools.includes(name))
                    return <li key={option.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => togglePermission(option.toolNames)}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault()
                            togglePermission(option.toolNames)
                          }
                        }}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-stone-500/15"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-current">{_(option.labelKey)}</p>
                          <p className="mt-0.5 truncate text-[11px] text-[var(--bd-read-sub)]">{_(option.descriptionKey)}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={_(option.labelKey)}
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePermission(option.toolNames)
                          }}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[var(--bd-read-primary)]' : 'bg-[var(--bd-read-accent)]'}`}
                        >
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] shadow-sm transition-transform ${enabled ? 'left-4' : 'left-0.5'}`} />
                        </button>
                      </div>
                    </li>
                  })}
                </ul>
              </aside>
            )}
            <div className="rounded-xl border border-stone-300/80 bg-stone-500/5 px-3 pb-1.5 pt-2 shadow-sm @max-[280px]/composer:px-2 dark:border-stone-700/80">
              {(selection || selectedChapterReferences.length > 0) && <div className={`${ATTACHMENT_SCROLLBAR_CLASSES} mb-2 max-h-28 overflow-y-auto overscroll-contain`}>
                <div className="flex flex-col gap-1.5 pr-2">
                {selection && <span className="flex min-h-8 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--bd-read-primary)]/50 bg-[var(--bd-read-primary)]/10 px-2.5 py-1 text-sm text-[var(--bd-read-primary)]">
                  <SelectedPositionIcon size={14} />
                  <span className="min-w-0 flex-1 truncate" title={selection}>{selectionPreview}</span>
                  <button type="button" onClick={() => { setAiContext(null); setSelection(null); renderer?.clearSelection() }} aria-label={_('reader.aiRemoveSelectedText')} title={_('reader.aiRemoveSelectedText')} className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bd-read-primary)]/10"><CloseIcon /></button>
                </span>}
                {selectedChapterReferences.map((referenceIndex) => {
                  const title = chapters[referenceIndex]?.title ?? _('reader.aiChapterNumber', { n: referenceIndex + 1 })
                  return <AiChapterReferenceChip key={referenceIndex} title={title} onRemove={() => toggleChapterReference(referenceIndex)} removeLabel={_('reader.aiRemoveChapterReference', { title })} />
                })}
                </div>
              </div>}
              <textarea ref={promptTextareaRef} value={prompt} onChange={(event) => { const value = event.target.value; setPrompt(value); const slashOpen = value.startsWith('/'); setQuickCommandMenuOpen(slashOpen); if (slashOpen) { setAttachmentOpen(false); setToolsOpen(false) } }} onKeyDown={handlePromptKeyDown} rows={2} placeholder={_('reader.aiInputPlaceholder')} className={`${READ_SCROLLBAR_CLASSES} min-h-12 max-h-36 w-full resize-none overflow-y-hidden overscroll-contain bg-transparent text-sm leading-relaxed text-current outline-none placeholder:text-[var(--bd-read-sub)]`} />
              {quickCommandMenuOpen && slashQuery !== null && (
                <div ref={quickCommandMenuRef} role="menu" aria-label={_('reader.aiQuickCommands')} data-testid="ai-quick-command-menu" className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[min(360px,calc(100vh-4rem))] w-full flex-col overflow-y-auto reader-scrollbar [scrollbar-gutter:stable] rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 shadow-xl">
                  {visibleQuickCommands.length > 0 ? visibleQuickCommands.map((command) => (
                    <button key={command.id} type="button" role="menuitem" aria-selected={command.id === visibleQuickCommands[quickCommandIndex]?.id} onClick={() => applyQuickCommand(command)} className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-current transition-colors hover:bg-stone-500/15 ${command.id === visibleQuickCommands[quickCommandIndex]?.id ? 'bg-stone-500/15 font-medium' : ''}`}>
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
                  <button ref={attachmentButtonRef} type="button" onClick={() => { setAttachmentOpen((open) => !open); setToolsOpen(false); setMoreOpen(false); setQuickCommandMenuOpen(false); setAssistantModeMenuOpen(false); setModelMenuOpen(false) }} aria-label={_('reader.aiAddChapterReference')} aria-haspopup="dialog" aria-expanded={attachmentOpen} title={_('reader.aiAddChapterReference')} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-500/10 hover:text-current ${attachmentOpen ? 'bg-stone-500/10' : ''}`}>
                    <AttachmentIcon />
                  </button>
                  <button ref={toolsButtonRef} type="button" onClick={() => { setToolsOpen((open) => !open); setAttachmentOpen(false); setMoreOpen(false); setQuickCommandMenuOpen(false); setAssistantModeMenuOpen(false); setModelMenuOpen(false) }} aria-label={_('reader.aiTools')} aria-haspopup="dialog" aria-expanded={toolsOpen} title={_('reader.aiTools')} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-500/10 hover:text-current ${toolsOpen ? 'bg-stone-500/10' : ''}`}>
                    <ToolsIcon />
                  </button>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1 @max-[240px]/composer:order-first @max-[240px]/composer:mb-1 @max-[240px]/composer:w-full @max-[240px]/composer:basis-full @max-[240px]/composer:gap-0.5">
                  <div ref={modelMenuRef} className="relative min-w-0 max-w-48 flex-1 @max-[240px]/composer:max-w-none">
                  <button
                    type="button"
                    aria-label={_('reader.aiSelectModel')}
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    title={selectedModelLabel}
                    disabled={!modelReady || modelOptions.length < 2 || updateAiConfig.isPending || updateAiProfile.isPending}
                    ref={modelButtonRef}
                    onClick={() => { setAttachmentOpen(false); setToolsOpen(false); setAssistantModeMenuOpen(false); setQuickCommandMenuOpen(false); setMoreOpen(false); setModelMenuOpen((open) => !open) }}
                    className={`flex h-7 min-w-0 w-full max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-[var(--bd-read-text)] outline-none transition-colors hover:bg-stone-500/10 focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:cursor-not-allowed disabled:text-[var(--bd-read-sub)] ${modelMenuOpen ? 'bg-stone-500/10' : ''}`}
                  >
                    {modelReady && <AiBrandIcon name={selectedModel?.name ?? statusQuery.data?.data.model} model={selectedModel} provider={statusQuery.data?.data.provider} className="h-5 w-5 shrink-0 @max-[280px]/composer:hidden" />}
                    <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
                    <svg className={`h-3.5 w-3.5 shrink-0 text-[var(--bd-read-sub)] transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                  </button>
                  {modelMenuOpen && modelOptions.length > 1 && modelMenuPosition && createPortal(
                    <div ref={modelMenuPopupRef} role="listbox" aria-label={_('reader.aiSelectModel')} className={`${READ_SCROLLBAR_CLASSES} fixed z-[70] max-h-52 min-w-56 w-max max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1 shadow-xl`} style={modelMenuPosition}>
                      {modelOptions.map((model) => {
                        const hasId = model.name !== model.id
                        const selected = model.id === statusQuery.data?.data.model
                        return (
                          <button
                            key={model.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            title={hasId ? `${model.name} (${model.id})` : model.name}
                            onClick={() => {
                              selectModel(model.id)
                              setModelMenuOpen(false)
                            }}
                            className={`flex min-h-10 min-w-0 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left text-sm transition-colors ${selected ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-primary)] hover:bg-[var(--bd-read-primary)]/20' : 'text-[var(--bd-read-text)] hover:bg-stone-500/15'}`}
                          >
                            <AiBrandIcon name={model.name} model={model} className="h-5 w-5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">{model.name}</p>
                              {hasId && <p className="truncate text-[10px] text-[var(--bd-read-sub)]">{model.id}</p>}
                            </div>
                            {selected && <span className="ml-2 shrink-0 text-[var(--bd-read-primary)]"><CheckIcon /></span>}
                          </button>
                        )
                      })}
                    </div>,
                    document.body,
                  )}
                </div>
                </div>
                {streaming ? <button type="button" onClick={stop} aria-label={_('reader.aiStopGenerating')} title={_('reader.aiStopGenerating')} className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"><StopIcon /></button> : <button type="submit" disabled={!canSend} aria-label={_('reader.aiSend')} title={_('reader.aiSend')} className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-35"><SendIcon /></button>}
              </div>
            </div>
          </form>
        </div>
      </div>
      {moreOpen && (
        <aside ref={moreRef} data-testid="ai-more-menu" aria-label={_('reader.aiMore')} className="absolute right-2 top-12 z-20 flex max-h-[min(360px,calc(100vh-5rem))] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-2 shadow-xl">
          <section className="px-1 py-1">
            <div className="flex min-h-10 items-center gap-2 rounded-lg px-2">
              <span className="shrink-0 text-[var(--bd-read-sub)]"><ReadingScopeIcon scope="full_book" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-current">{_('reader.aiIndexTitle')}</p>
                {indexStatusLabel && <p className="truncate text-[11px] text-[var(--bd-read-sub)]">{indexStatusLabel}</p>}
              </div>
              {indexActionVisible && <button type="button" onClick={indexStatus === 'indexing' || indexBook.isPending || preparingIndex ? cancelBookIndex : () => void buildBookIndex()} disabled={cancelIndex.isPending || clearIndex.isPending} aria-label={indexActionLabel} title={indexActionLabel} className="shrink-0 rounded-md border border-[var(--bd-read-accent)] px-2 py-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{indexActionShortLabel}</button>}
              {indexStatus !== 'not_indexed' && indexStatus !== 'indexing' && indexStatus !== undefined && <button type="button" onClick={() => setClearIndexOpen(true)} disabled={clearIndex.isPending} aria-label={_('reader.aiIndexClear')} title={_('reader.aiIndexClear')} className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--bd-read-sub)] underline underline-offset-2 transition-colors hover:text-current disabled:cursor-not-allowed disabled:opacity-50">{_('reader.aiIndexClearShort')}</button>}
            </div>
            {indexStatus === 'indexing' && <div className="px-2 pb-1 pt-0.5 text-[11px] text-[var(--bd-read-sub)]">
              <div className="flex items-center justify-end"><span>{indexQuery.data?.data.progress ?? 0}%</span></div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-500/10"><div className="h-full rounded-full bg-current transition-[width]" style={{ width: `${Math.max(0, Math.min(100, indexQuery.data?.data.progress ?? 0))}%` }} /></div>
            </div>}
            {embeddingConfigMismatch && <p className="px-2 pb-1 pt-1 text-[11px] leading-relaxed text-[var(--bd-read-sub)]">{_('reader.aiEmbeddingStale')}</p>}
            {visibleCorpusMismatch && <p className="px-2 pb-1 pt-1 text-[11px] leading-relaxed text-[var(--bd-read-sub)]">{_('reader.aiCorpusStale')}</p>}
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
        <aside ref={historyRef} data-testid="ai-history" className="absolute right-2 top-12 z-20 flex max-h-[min(380px,calc(100vh-5rem))] w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--bd-read-accent)] px-3.5">
            <h3 className="text-xs font-semibold text-current">{_('reader.aiHistory')}</h3>
            <span className="rounded-full bg-stone-500/10 px-2 py-0.5 text-[11px] tabular-nums text-[var(--bd-read-sub)]">{historyThreads.length}</span>
          </div>
          {threadsQuery.isFetching && historyThreads.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.loading')}</p> : historyThreads.length === 0 ? <p className="px-3 py-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.aiHistoryEmpty')}</p> : (
            <ul className="reader-scrollbar [scrollbar-gutter:stable] min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 pr-1.5">
              {historyThreads.map((thread) => {
                const createdAt = new Date(thread.createdAt)
                const now = new Date()
                const isToday = createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth() && createdAt.getDate() === now.getDate()
                const timeLabel = isToday
                  ? createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : createdAt.toLocaleDateString('zh-CN')
                const isActive = thread.id === threadId
                return (
                <li key={thread.id} className={`group mr-1 rounded-lg p-1 transition-colors ${isActive ? 'bg-[var(--bd-read-primary)]/10' : 'hover:bg-stone-500/5'}`}>
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
                        <span className={`block truncate text-sm ${isActive ? 'font-medium text-[var(--bd-read-primary)]' : 'text-current'}`}>{thread.title}</span>
                        <span className="mt-0.5 block text-[11px] text-[var(--bd-read-sub)]">{timeLabel} · {thread.messageCount} {_(thread.messageCount === 1 ? 'reader.aiMessageOne' : 'reader.aiMessageMany')}</span>
                      </button>
                      <button type="button" onClick={() => beginRename(thread)} aria-label={`${_('reader.aiRename')} ${thread.title}`} title={_('reader.aiRename')} className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center rounded p-1 text-[var(--bd-read-sub)] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-stone-500/10 hover:text-current focus-visible:pointer-events-auto focus-visible:opacity-100">
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
      {assistantModeForm && <Modal title={assistantModeForm.id ? _('reader.aiEditMode') : _('reader.aiAddMode')} variant="reader" onClose={() => setAssistantModeForm(null)}>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); submitAssistantMode() }}>
          <div className="flex flex-col gap-1 text-xs text-[var(--bd-read-sub)]">
            <div className="flex items-center justify-between">
              <label htmlFor="ai-mode-name" className="cursor-pointer">{_('reader.aiModeName')}</label>
              <span className="text-[10px] tabular-nums text-[var(--bd-read-sub)]/70">{assistantModeForm.name.length}/80</span>
            </div>
            <input id="ai-mode-name" required autoFocus maxLength={80} value={assistantModeForm.name} onChange={(event) => setAssistantModeForm({ ...assistantModeForm, name: event.target.value })} placeholder={_('reader.aiModeNamePlaceholder')} className="h-10 rounded-lg border border-[var(--bd-read-accent)] bg-transparent px-3 text-sm text-current outline-none focus:border-[var(--bd-read-primary)]" />
          </div>
          <div className="flex flex-col gap-1 text-xs text-[var(--bd-read-sub)]">
            <div className="flex items-center justify-between">
              <label htmlFor="ai-mode-prompt" className="cursor-pointer">{_('reader.aiModePrompt')}</label>
              <span className="text-[10px] tabular-nums text-[var(--bd-read-sub)]/70">{assistantModeForm.prompt.length}/2000</span>
            </div>
            <textarea id="ai-mode-prompt" required maxLength={2_000} rows={6} value={assistantModeForm.prompt} onChange={(event) => setAssistantModeForm({ ...assistantModeForm, prompt: event.target.value })} placeholder={_('reader.aiModePromptPlaceholder')} className="resize-y rounded-lg border border-[var(--bd-read-accent)] bg-transparent px-3 py-2 text-sm leading-5 text-current outline-none focus:border-[var(--bd-read-primary)]" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {['{SELTEXT}', '{CHAPTER}', '{SELPARA}'].map((placeholder) => (
                <button
                  key={placeholder}
                  type="button"
                  onClick={() => {
                    setAssistantModeForm({
                      ...assistantModeForm,
                      prompt: `${assistantModeForm.prompt}${assistantModeForm.prompt.endsWith(' ') || assistantModeForm.prompt.length === 0 ? '' : ' '}${placeholder}`,
                    })
                  }}
                  className="inline-flex items-center rounded-md border border-[var(--bd-read-accent)] bg-stone-500/5 px-2 py-0.5 font-mono text-[11px] text-[var(--bd-read-sub)] transition-colors hover:border-[var(--bd-read-primary)]/40 hover:bg-[var(--bd-read-primary)]/10 hover:text-[var(--bd-read-primary)] active:scale-95"
                >
                  {placeholder}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--bd-read-accent)] pt-4">
            {assistantModeForm.id === DEFAULT_ASSISTANT_MODE.id
              ? <button type="button" onClick={requestRestoreAssistantMode} disabled={updateAiConfig.isPending} className="rounded-lg border border-[var(--bd-read-accent)] px-4 py-2 text-sm text-[var(--bd-read-primary)] transition-colors hover:bg-[var(--bd-read-page-bg)] disabled:cursor-not-allowed disabled:opacity-50">{_('reader.aiRestoreDefault')}</button>
              : assistantModeForm.id ? <button type="button" onClick={requestDeleteAssistantMode} disabled={updateAiConfig.isPending} className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-700 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300">{_('reader.aiDelete')}</button> : <span />}
           <div className="flex gap-2">
              <button type="button" onClick={() => setAssistantModeForm(null)} className="rounded-lg border border-[var(--bd-read-accent)] px-4 py-2 text-sm text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)]">{_('reader.aiCancel')}</button>
              <button type="submit" disabled={!assistantModeForm.name.trim() || !assistantModeForm.prompt.trim() || updateAiConfig.isPending} className="rounded-lg bg-[var(--bd-read-primary)] px-4 py-2 text-sm text-[var(--bd-read-bg)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40">{_('reader.aiSave')}</button>
            </div>
          </div>
        </form>
      </Modal>}
      {deleteTarget && <ConfirmDialog title={_('settings.confirmDeleteTitle')} message={_('reader.aiDeleteConfirm', { name: deleteTarget.title })} confirmLabel={_('settings.confirmDeleteAction')} onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />}
      {assistantModeDeleteTarget && <ConfirmDialog title={_('settings.confirmDeleteTitle')} message={_('reader.aiModeDeleteConfirm', { name: assistantModeDeleteTarget.name })} confirmLabel={_('settings.confirmDeleteAction')} onConfirm={confirmDeleteAssistantMode} onClose={() => setAssistantModeDeleteTarget(null)} />}
      {assistantModeRestoreOpen && <ConfirmDialog title={_('settings.confirmRestoreTitle')} message={_('reader.aiRestoreDefaultConfirm')} confirmLabel={_('settings.confirmRestoreAction')} confirmVariant="primary" onConfirm={confirmRestoreAssistantMode} onClose={() => setAssistantModeRestoreOpen(false)} />}
      {clearIndexOpen && <ConfirmDialog title={_('settings.confirmClearTitle')} message={_('reader.aiIndexClearConfirm')} confirmLabel={_('settings.confirmClearAction')} onConfirm={confirmClearIndex} onClose={() => setClearIndexOpen(false)} />}
    </div>
  )
}
