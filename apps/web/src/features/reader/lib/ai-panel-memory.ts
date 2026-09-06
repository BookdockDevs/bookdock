import {
  AI_MAX_CHAT_PROMPT_CHARS,
  AI_MAX_CHAPTER_REFERENCES,
} from '@bookdock/shared'

const STORAGE_PREFIX = 'bd-ai-panel-memory'

export interface AiPanelMemory {
  activeThreadId: string | null
  prompt: string
  chapterReferences: number[]
}

function defaultMemory(): AiPanelMemory {
  return {
    activeThreadId: null,
    prompt: '',
    chapterReferences: [],
  }
}

function storageKey(userId: string, bookId: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(bookId)}`
}

export function readAiPanelMemory(userId: string, bookId: string): AiPanelMemory {
  if (typeof window === 'undefined') return defaultMemory()
  try {
    const raw = window.localStorage.getItem(storageKey(userId, bookId))
    if (!raw) return defaultMemory()
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return defaultMemory()
    const stored = value as Partial<Record<keyof AiPanelMemory, unknown>>
    const activeThreadId = typeof stored.activeThreadId === 'string' && stored.activeThreadId.trim()
      ? stored.activeThreadId.trim().slice(0, 100)
      : null
    const prompt = typeof stored.prompt === 'string' ? stored.prompt.slice(0, AI_MAX_CHAT_PROMPT_CHARS) : ''
    const chapterReferences = Array.isArray(stored.chapterReferences)
      ? Array.from(new Set(stored.chapterReferences.filter((index): index is number => Number.isInteger(index) && index >= 0))).slice(0, AI_MAX_CHAPTER_REFERENCES)
      : []
    return { activeThreadId, prompt, chapterReferences }
  } catch {
    return defaultMemory()
  }
}

export function writeAiPanelMemory(userId: string, bookId: string, memory: AiPanelMemory) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userId, bookId), JSON.stringify(memory))
  } catch {
    // Draft memory is optional in private browsing or constrained storage.
  }
}
