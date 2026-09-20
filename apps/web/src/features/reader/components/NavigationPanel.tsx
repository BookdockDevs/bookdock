import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useReaderApi } from '../hooks/useReaderApi'
import { useReaderState } from '../state/reader-state'
import type { SearchResult } from '../types'
import { useAnnotations, useBatchDeleteAnnotations } from '../hooks/useAnnotations'
import { useBookChapters } from '../hooks/useBookChapters'
import { kindOf, useNotesFilter, type ItemKind } from '../hooks/useNotesFilter'
import { BatchSelectIcon, CloseIcon, DocumentExportIcon, SelectionIcon, TrashIcon } from './annotation-icons'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { ExpandingSearchBar } from './ExpandingSearchBar'
import { clearSearchHistory, loadSearchHistory, pushSearchTerm, saveSearchHistory } from '../lib/search-history'
import { markEscConsumed } from '../lib/esc-consumed'
import { useBookReadingRecords } from '@/api/hooks/reading-records'
import { formatDuration } from '@/lib/format-duration'
import AnnotationExportDialog from './AnnotationExportDialog'
import { NotesFilterPanel } from './NotesFilterPanel'
import { NotesPanel } from './NotesPanel'
import StatsPanel from './StatsPanel'
import AiPanel from './AiPanel'

export interface NavigationPanelRef {
  saveScroll: () => void
}

const DISPLAY_TYPES_KEY = 'bd-notes-display-types'
const ALL_KINDS: ItemKind[] = ['highlight', 'idea', 'bookmark']

function loadDisplayTypes(): Set<ItemKind> {
  try {
    const raw = window.localStorage.getItem(DISPLAY_TYPES_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((k): k is ItemKind => ALL_KINDS.includes(k))
        if (valid.length > 0) return new Set(valid)
      }
    }
  } catch {
    // ignore storage errors
  }
  return new Set(ALL_KINDS)
}

interface TocNode {
  index: number
  label: string
  href: string
  level: number
  displayDepth: number
  children: number[]
  parent: number | null
}

function buildTocTree(items: { label: string; href: string; level: number }[]): TocNode[] {
  const tree: TocNode[] = items.map((item, index) => ({ ...item, index, displayDepth: 0, children: [], parent: null }))
  const stack: number[] = []
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]
    while (stack.length > 0) {
      const parentIndex = stack[stack.length - 1]
      const parent = tree[parentIndex]
      if (parent.level < node.level) {
        node.parent = parentIndex
        parent.children.push(i)
        break
      }
      stack.pop()
    }
    if (stack.length === 0) {
      node.parent = null
    }
    if (node.children.length > 0 || (i < tree.length - 1 && tree[i + 1].level > node.level)) {
      stack.push(i)
    }
  }
  for (const node of tree) {
    node.displayDepth = node.parent === null ? 1 : tree[node.parent].displayDepth + 1
  }
  return tree
}

interface VolumeHeaderItemProps {
  node: TocNode
  isCurrent: boolean
  isFlashing: boolean
  hasChildren: boolean
  isExpanded: boolean
  isVolume: boolean
  isStuck: boolean
  itemRef: (el: HTMLButtonElement | null) => void
  onItemClick: (node: TocNode) => void
  onExpanderClick: (e: React.MouseEvent, index: number) => void
  t: (key: string) => string
}

function VolumeHeaderItem({
  node,
  isCurrent,
  isFlashing,
  hasChildren,
  isExpanded,
  isVolume,
  isStuck,
  itemRef,
  onItemClick,
  onExpanderClick,
  t,
}: VolumeHeaderItemProps) {
  const isStickyVolume = isVolume && isExpanded

  return (
    <div
      className={cn(
        isStickyVolume && 'sticky top-0 z-10 -ml-2 -mr-3 pl-2 pr-3 py-1 transition-all duration-200',
        isStickyVolume && isStuck && 'shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_16px_-2px_rgba(0,0,0,0.36)]',
      )}
      style={isStickyVolume ? { backgroundColor: 'var(--bd-read-bg)' } : undefined}
    >
      <button
        ref={itemRef}
        onClick={() => onItemClick(node)}
        className={cn(
          'group flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors',
          isCurrent
            ? cn(
                'relative font-medium text-current ring-inset',
                isFlashing
                  ? 'bg-stone-500/25 ring-2 ring-stone-500/40 shadow-sm transition-all duration-300'
                  : 'bg-stone-500/12 ring-1 ring-stone-500/20 transition-all duration-300',
              )
            : isVolume
              ? 'font-semibold text-current hover:bg-stone-500/10'
              : 'text-[var(--bd-read-sub)] hover:bg-stone-500/5 hover:text-current',
        )}
        style={{ paddingLeft: `${(node.displayDepth - 1) * 14 + 8}px` }}
        title={node.label}
      >
        {isCurrent && (
          <span className="absolute left-1 top-1.5 bottom-1.5 w-1 rounded-full bg-[var(--bd-read-primary,#3b82f6)]" aria-hidden="true" />
        )}
        {hasChildren ? (
          <svg
            onClick={(e) => onExpanderClick(e, node.index)}
            className={cn('h-3.5 w-3.5 shrink-0 cursor-pointer text-[var(--bd-read-sub)] transition-transform duration-200', isExpanded && 'rotate-90')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label={isExpanded ? t('reader.collapseAll') : t('reader.expandAll')}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="flex-1 truncate">{node.label}</span>
        {isVolume && (
          <span className="ml-auto shrink-0 pr-1 text-xs text-[var(--bd-read-sub)] opacity-0 transition-opacity duration-150 group-hover:opacity-80 tabular-nums">
            {node.children.length} {t('reader.chapters')}
          </span>
        )}
      </button>
      {isStickyVolume && isStuck && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-full h-2.5 bg-gradient-to-b from-[var(--bd-read-bg)] to-transparent"
          aria-hidden="true"
        />
      )}
    </div>
  )
}

interface NavigationPanelProps {
  bookId: string
  open: boolean
  locked?: boolean
  statsDisabled?: boolean
  onClose?: () => void
}

export const NavigationPanel = memo(forwardRef<NavigationPanelRef, NavigationPanelProps>(function NavigationPanel(
  { bookId, open, locked, statsDisabled, onClose },
  ref,
) {
  const _ = useTranslation()
  const tab = useReaderState((s) => s.activeNavTab)
  const tocItems = useReaderState((s) => s.tocItems)
  const tocBookId = useReaderState((s) => s.tocBookId)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setPendingTocHref = useReaderState((s) => s.setPendingTocHref)
  const { renderer } = useReaderApi()
  const annotationsQuery = useAnnotations(bookId)
  const { data: annotations } = annotationsQuery
  const chaptersQuery = useBookChapters(bookId)
  const statsRecordsQuery = useBookReadingRecords(bookId)
  const statsTotalSeconds = statsRecordsQuery.data?.data?.totalSeconds ?? 0

  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const volumeLiRefs = useRef<Map<number, HTMLLIElement>>(new Map())
  const [stuckVolumeIndex, setStuckVolumeIndex] = useState<number | null>(null)
  const savedScrollTop = useRef<number | null>(null)
  const lastScrolledIndex = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    saveScroll: () => {
      const container = listRef.current
      if (container && tab === 'toc') {
        savedScrollTop.current = container.scrollTop
      }
    },
  }))

  const annotationItems = useMemo(() => annotations?.data ?? [], [annotations?.data])
  const [displayTypes, setDisplayTypes] = useState<Set<ItemKind>>(loadDisplayTypes)
  const notesFilter = useNotesFilter(annotationItems, displayTypes)
  const [notesSearchExpanded, setNotesSearchExpanded] = useState(false)
  const [notesFilterOpen, setNotesFilterOpen] = useState(false)
  const [notesSelectionMode, setNotesSelectionMode] = useState(false)
  const [allNotesExpanded, setAllNotesExpanded] = useState(false)
  const notesFilterBtnRef = useRef<HTMLButtonElement>(null)

  function toggleAllNotesExpand() {
    setAllNotesExpanded((prev) => !prev)
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(DISPLAY_TYPES_KEY, JSON.stringify(Array.from(displayTypes)))
    } catch {
      // ignore storage errors
    }
  }, [displayTypes])

  function toggleDisplayType(kind: ItemKind) {
    setDisplayTypes((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function resetNotesFilter() {
    notesFilter.reset()
    setDisplayTypes(new Set(ALL_KINDS))
  }

  function toggleNotesSearchBar() {
    if (notesSearchExpanded) {
      setNotesSearchExpanded(false)
      setNotesFilterOpen(false)
      notesFilter.setQuery('')
    } else {
      setNotesSearchExpanded(true)
    }
  }

  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [notesExportOpen, setNotesExportOpen] = useState(false)
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false)
  const batchDeleteMutation = useBatchDeleteAnnotations(bookId)

  async function handleBatchDelete() {
    if (selectedNoteIds.size === 0) return
    await batchDeleteMutation.mutateAsync(Array.from(selectedNoteIds))
    setSelectedNoteIds(new Set())
    setBatchDeleteConfirmOpen(false)
  }

  function enterNotesSelectionMode() {
    setSelectedNoteIds(new Set(notesFilter.filtered.map((item) => item.id)))
    setNotesSelectionMode(true)
  }

  function exitNotesSelectionMode() {
    setNotesSelectionMode(false)
    setSelectedNoteIds(new Set())
    setNotesExportOpen(false)
    setBatchDeleteConfirmOpen(false)
  }

  function selectAllNotes() {
    const visibleIds = notesFilter.filtered.map((item) => item.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedNoteIds.has(id))
    setSelectedNoteIds((prev) => {
      const next = new Set(prev)
      for (const id of visibleIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function toggleSelectNote(id: string) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const notesSelectionState = useMemo(() => {
    const visible = notesFilter.filtered
    if (visible.length === 0) return 'none'
    if (visible.every((item) => selectedNoteIds.has(item.id))) return 'all'
    if (visible.some((item) => selectedNoteIds.has(item.id))) return 'partial'
    return 'none'
  }, [notesFilter.filtered, selectedNoteIds])

  const hasExpandableNotes = useMemo(() => {
    return notesFilter.filtered.some((a) => {
      const kind = kindOf(a)
      if (kind === 'idea') {
        return (
          (a.note?.length ?? 0) > 60 ||
          (a.note?.includes('\n') ?? false) ||
          (a.text?.length ?? 0) > 40 ||
          (a.text?.includes('\n') ?? false)
        )
      }
      if (kind === 'highlight') {
        return (a.text?.length ?? 0) > 65 || (a.text?.includes('\n') ?? false)
      }
      return false
    })
  }, [notesFilter.filtered])

  useEffect(() => {
    if (tab !== 'notes' && notesSelectionMode) {
      exitNotesSelectionMode()
    }
  }, [tab, notesSelectionMode])

  const tocChapters = useMemo(() => {
    const currentBookTocItems = tocBookId === null || tocBookId === bookId ? tocItems : []
    if (currentBookTocItems.length) {
      return currentBookTocItems.map((item) => ({ ...item, level: item.level ?? 1 }))
    }
    if (chaptersQuery.data?.data?.length) {
      return chaptersQuery.data.data.map((c, i) => ({ label: c.title, href: `chapter:${i}`, level: c.level }))
    }
    return []
  }, [bookId, chaptersQuery.data, tocBookId, tocItems])

  const tree = useMemo(() => buildTocTree(tocChapters), [tocChapters])
  const chapterOrder = useMemo(() => tocChapters.map((c) => c.label), [tocChapters])
  const rootNodes = useMemo(() => tree.filter((n) => n.parent === null), [tree])

  const currentIndex = useMemo(() => {
    if (currentChapter) {
      const trimmed = currentChapter.trim()
      let idx = tree.findIndex((n) => n.label.trim() === trimmed)
      if (idx < 0) {
        idx = tree.findIndex((n) => {
          const label = n.label.trim()
          return label.includes(trimmed) || trimmed.includes(label)
        })
      }
      if (idx >= 0) return idx
    }
    // The renderer index is a spine index, while `tree` also contains volume
    // nodes. Use it only when no TOC label is available to avoid highlighting
    // the next chapter after a volume header.
    return currentChapterIndex !== null && currentChapterIndex >= 0 && currentChapterIndex < tree.length
      ? currentChapterIndex
      : -1
  }, [currentChapter, currentChapterIndex, tree])

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  /** Book-search mode: results overlay the TOC list while the bar is open with a query */
  const searchActive = searchExpanded && query.trim().length > 0

  useEffect(() => {
    if (tab === 'toc' && searchExpanded) {
      searchInputRef.current?.focus()
    }
  }, [tab, searchExpanded])

  // Tracks whether the current-chapter TOC entry is inside the scroll
  // viewport; drives the "locate current chapter" button in the header
  const [currentInView, setCurrentInView] = useState(true)

  useEffect(() => {
    if (tab !== 'toc' || !open || currentIndex < 0 || searchExpanded) return
    const item = itemRefs.current.get(currentIndex)
    const container = listRef.current
    if (!item || !container || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => setCurrentInView(entries[0]?.isIntersecting ?? true),
      { root: container },
    )
    observer.observe(item)
    return () => observer.disconnect()
  }, [tab, open, currentIndex, searchExpanded, collapsed, tree])

  const showLocate = tab === 'toc' && currentIndex >= 0 && !searchExpanded && !currentInView

  const [flashChapterIndex, setFlashChapterIndex] = useState<number | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  // Same landing spot as the chapter-change auto-scroll: item at top 1/4 of the viewport
  const scrollToCurrentChapter = useCallback(() => {
    const item = itemRefs.current.get(currentIndex)
    const container = listRef.current
    if (!item || !container) return
    const containerRect = container.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const target = Math.max(0, container.scrollTop + (itemRect.top - containerRect.top) - container.clientHeight * 0.25)
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: target, behavior: 'smooth' })
    } else {
      item.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    lastScrolledIndex.current = currentIndex
    savedScrollTop.current = target

    // Trigger pulse/flash highlight on the located chapter
    setFlashChapterIndex(currentIndex)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => {
      setFlashChapterIndex(null)
    }, 1200)
  }, [currentIndex])

  // Collapsing only hides the bar — query and results survive the round trip,
  // so reopening restores the search instantly instead of re-running it.
  function toggleSearchBar() {
    setSearchExpanded((v) => !v)
  }

  function collapseSearchBar() {
    setSearchExpanded(false)
  }

  const hasMultiLevel = useMemo(() => tree.some((n) => n.children.length > 0), [tree])
  const allParentCollapsed = useMemo(() => {
    const parents = tree.filter((n) => n.children.length > 0)
    return parents.length > 0 && parents.every((n) => collapsed.has(n.index))
  }, [tree, collapsed])
  const volumeIndices = useMemo(() => {
    return tree.filter((n) => n.displayDepth === 1 && n.children.length > 0).map((n) => n.index)
  }, [tree])

  // Auto-expand path to current chapter when it changes or the panel opens.
  useEffect(() => {
    if (currentIndex < 0) return
    const next = new Set<number>()
    let node: TocNode | undefined = tree[currentIndex]
    while (node) {
      if (node.parent !== null) {
        next.add(node.parent)
      }
      node = node.parent !== null ? tree[node.parent] : undefined
    }
    setCollapsed((prev) => {
      if (next.size === 0) return prev
      const merged = new Set(prev)
      for (const n of next) merged.delete(n)
      if (merged.size === prev.size) return prev
      return merged
    })
  }, [currentIndex, tree, open, tab])

  function goTo(href: string) {
    // Clicks land while the book is still mounting — queue the jump for
    // Reader instead of dropping it
    if (renderer) void renderer.display(href)
    else setPendingTocHref(href)
    if (!locked) onClose?.()
  }

  function handleItemClick(node: TocNode) {
    goTo(node.href)
    if (node.children.length > 0 && collapsed.has(node.index)) {
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.delete(node.index)
        return next
      })
    }
  }

  function handleExpanderClick(e: React.MouseEvent, index: number) {
    e.stopPropagation()
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function toggleAllCollapse() {
    if (allParentCollapsed) {
      setCollapsed(new Set())
      return
    }
    const parentIndices = tree.filter((n) => n.children.length > 0).map((n) => n.index)
    setCollapsed((prev) => {
      const next = new Set(prev)
      for (const i of parentIndices) next.add(i)
      if (next.size === prev.size) return prev
      return next
    })
  }

  const updateStuckVolume = useCallback(() => {
    const container = listRef.current
    if (!container || tab !== 'toc' || searchExpanded) {
      setStuckVolumeIndex((prev) => (prev !== null ? null : prev))
      return
    }
    if (container.scrollTop <= 2 || volumeIndices.length === 0) {
      setStuckVolumeIndex((prev) => (prev !== null ? null : prev))
      return
    }

    const cTop = container.getBoundingClientRect().top
    let activeStuckIndex: number | null = null

    for (const vIdx of volumeIndices) {
      if (collapsed.has(vIdx)) continue
      const el = volumeLiRefs.current.get(vIdx)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.top <= cTop + 1 && rect.bottom > cTop + 28) {
        activeStuckIndex = vIdx
        break
      }
    }

    setStuckVolumeIndex((prev) => (prev !== activeStuckIndex ? activeStuckIndex : prev))
  }, [tab, searchExpanded, volumeIndices, collapsed])

  // Remember the directory scroll position when the user scrolls the TOC panel.
  // This lets us reopen at the same position without re-scrolling.
  function handleScroll() {
    const container = listRef.current
    if (container && tab === 'toc' && !searchExpanded) {
      savedScrollTop.current = container.scrollTop
      updateStuckVolume()
    }
  }

  useEffect(() => {
    if (tab === 'toc' && open && !searchExpanded) {
      updateStuckVolume()
    }
  }, [tab, open, searchExpanded, updateStuckVolume])

  // On reopen or tab change, restore the saved TOC scroll position only if the current chapter hasn't changed.
  // When the chapter changes, the auto-scroll effect below will scroll to the new chapter instead.
  // useLayoutEffect restores before paint so the panel doesn't flash at the wrong position.
  useLayoutEffect(() => {
    const container = listRef.current
    if (!container || !open || tab !== 'toc' || searchExpanded) return
    if (savedScrollTop.current !== null && currentIndex === lastScrolledIndex.current) {
      container.scrollTop = savedScrollTop.current
    }
  }, [open, tab, currentIndex, searchExpanded])

  // Scroll the current chapter into view when the panel opens or current chapter changes.
  // Position the current item at roughly the top 1/4 of the panel viewport for better context.
  useEffect(() => {
    if (tab !== 'toc' || !open || currentIndex < 0 || searchExpanded) return
    if (currentIndex === lastScrolledIndex.current) return
    const timer = setTimeout(() => {
      scrollToCurrentChapter()
    }, 300)
    return () => clearTimeout(timer)
  }, [tab, open, currentIndex, collapsed, searchExpanded, scrollToCurrentChapter])

  const pendingSearchQuery = useReaderState((s) => s.pendingSearchQuery)
  const setPendingSearchQuery = useReaderState((s) => s.setPendingSearchQuery)

  // "Search selection" from the toolbar lands here
  useEffect(() => {
    if (pendingSearchQuery == null) return
    setQuery(pendingSearchQuery)
    setSearchExpanded(true)
    setPendingSearchQuery(null)
  }, [pendingSearchQuery, setPendingSearchQuery])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState<number | null>(null)
  const [searchIndex, setSearchIndex] = useState(0)
  const [searchScope, setSearchScope] = useState<'book' | 'chapter'>('book')
  const [searchMatchCase, setSearchMatchCase] = useState(false)
  const [searchMode, setSearchMode] = useState<'contains' | 'regex'>('contains')
  const searchGenRef = useRef(0)
  // Search-history chips are per-book, deduped, and capped at 10;
  // only completed searches with hits are recorded
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadSearchHistory(bookId))
  // Mirror of `open` for the debounced search: `open` is deliberately out of
  // the effect deps (reopening must not re-run the search), so the timer
  // checks this ref to avoid searching in the background while closed
  const openRef = useRef(open)
  openRef.current = open
  // Same trick for `tab`: switching to notes and back must keep the cached
  // results, so the debounced effect reads the tab through this ref instead
  const tabRef = useRef(tab)
  tabRef.current = tab

  // Consecutive matches from the same chapter collapse into one group, in book order
  const resultGroups = useMemo(() => {
    const groups: { chapter: string | null; items: SearchResult[] }[] = []
    for (const r of searchResults) {
      const chapter = r.chapter ?? null
      const last = groups[groups.length - 1]
      if (last && last.chapter === chapter) last.items.push(r)
      else groups.push({ chapter, items: [r] })
    }
    return groups
  }, [searchResults])

  async function doSearch() {
    if (!query.trim() || !renderer?.search) return
    const gen = ++searchGenRef.current
    setSearching(true)
    setSearchProgress(0)
    setSearchResults([])
    setSearchIndex(0)
    try {
      const results = await renderer.search(
        query.trim(),
        { scope: searchScope, matchCase: searchMatchCase, mode: searchMode },
        (partial, progress) => {
          if (gen !== searchGenRef.current) return
          setSearchResults(partial)
          setSearchProgress(progress)
        },
      )
      if (gen !== searchGenRef.current) return
      setSearchResults(results)
      if (results.length > 0) {
        setSearchHistory((prev) => {
          const next = pushSearchTerm(prev, query.trim())
          saveSearchHistory(bookId, next)
          return next
        })
      }
    } finally {
      if (gen === searchGenRef.current) {
        setSearching(false)
        setSearchProgress(null)
      }
    }
  }

  function clearSearch() {
    setQuery('')
    setSearchResults([])
    searchGenRef.current++
    setSearching(false)
    setSearchProgress(null)
    setSearchIndex(0)
    renderer?.clearSearch()
  }

  // Navigate to a result — via list click or the prev/next card — keeping the
  // pointer in sync so "next" always continues from what's on screen
  function goToResult(index: number) {
    const r = searchResults[index]
    if (!r) return
    setSearchIndex(index)
    void renderer?.display(r.cfi)
    if (!locked) onClose?.()
  }

  // Search as you type, debounced. Invalid regex just yields no results.
  // `open` and `tab` stay out of the deps: state survives while the panel is
  // closed or another tab is active, so returning here renders the cached
  // results instantly instead of re-searching.
  useEffect(() => {
    if (tabRef.current !== 'toc' || !open) return
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(() => {
      if (openRef.current) void doSearch()
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchScope, searchMode, searchMatchCase])

  function renderSubtree(nodes: number[]) {
    return (
      <ul className="space-y-0.5">
        {nodes.map((index) => {
          const node = tree[index]
          const isCurrent = index === currentIndex
          const isFlashing = index === flashChapterIndex
          const hasChildren = node.children.length > 0
          const isExpanded = !collapsed.has(index)
          const hidden = node.parent !== null && collapsed.has(node.parent)
          if (hidden) return null

          const isVolume = node.displayDepth === 1 && hasChildren

          return (
            <li
              key={index}
              ref={
                isVolume
                  ? (el) => {
                      if (el) volumeLiRefs.current.set(index, el)
                      else volumeLiRefs.current.delete(index)
                    }
                  : undefined
              }
              className={cn(isVolume && 'mt-1.5 first:mt-0')}
            >
              <VolumeHeaderItem
                node={node}
                isCurrent={isCurrent}
                isFlashing={isFlashing}
                hasChildren={hasChildren}
                isExpanded={isExpanded}
                isVolume={isVolume}
                isStuck={isVolume && isExpanded && stuckVolumeIndex === index}
                itemRef={(el) => {
                  if (el) itemRefs.current.set(index, el)
                  else itemRefs.current.delete(index)
                }}
                onItemClick={handleItemClick}
                onExpanderClick={handleExpanderClick}
                t={_}
              />
              {hasChildren && isExpanded && renderSubtree(node.children)}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div data-sidebar-panel="true" className="flex h-full flex-col">
      {tab === 'notes' && notesSelectionMode ? (
        <div
          className="sticky top-0 z-10 flex h-12 items-center border-b border-[var(--bd-read-accent)] px-3"
          style={{ backgroundColor: 'var(--bd-read-bg)' }}
        >
          <button
            type="button"
            onClick={selectAllNotes}
            title={_('annotation.selectAll')}
            aria-label={_('annotation.selectAll')}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current transition-colors"
          >
            <SelectionIcon state={notesSelectionState} />
            <span className="tabular-nums font-medium text-current">
              {_('annotation.exportSelected', { n: selectedNoteIds.size })}
            </span>
          </button>

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setNotesExportOpen(true)}
              disabled={selectedNoteIds.size === 0}
              title={_('annotation.exportTitle')}
              aria-label={_('annotation.exportTitle')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current disabled:opacity-35 transition-colors"
            >
              <DocumentExportIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => setBatchDeleteConfirmOpen(true)}
              disabled={selectedNoteIds.size === 0}
              title={_('annotation.batchDelete')}
              aria-label={_('annotation.batchDelete')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-35 transition-colors"
            >
              <TrashIcon size={16} />
            </button>
            <button
              type="button"
              onClick={exitNotesSelectionMode}
              title={_('annotation.cancel')}
              aria-label={_('annotation.cancel')}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current transition-colors"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
      ) : tab === 'toc' && searchExpanded ? (
        <div
          className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--bd-read-accent)] px-3"
          style={{ backgroundColor: 'var(--bd-read-bg)' }}
        >
          <button
            type="button"
            onClick={collapseSearchBar}
            title={_('reader.backToToc')}
            aria-label={_('reader.backToToc')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="relative flex-1">
            <svg
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--bd-read-sub)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                const val = e.target.value
                if (val.trim()) setQuery(val)
                else clearSearch()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  markEscConsumed()
                  if (query) clearSearch()
                  else collapseSearchBar()
                }
              }}
              placeholder={_('reader.searchPlaceholder')}
              className="w-full rounded-lg border border-stone-200/60 bg-transparent py-1.5 pl-8 pr-8 text-sm outline-none placeholder:text-[var(--bd-read-sub)] dark:border-stone-800/60"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current"
                aria-label="清除"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>
      ) : tab !== 'ai' && (
        <div
          className="sticky top-0 z-10 flex h-12 items-center border-b border-[var(--bd-read-accent)] px-4"
          style={{ backgroundColor: 'var(--bd-read-bg)' }}
        >
          {tab === 'toc' ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-current">{_('reader.toc')}</span>
              {tree.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-stone-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--bd-read-sub)]">
                  {tree.length}
                </span>
              )}
            </div>
          ) : tab === 'notes' ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-current">{_('reader.notes')}</span>
              {annotationItems.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-stone-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--bd-read-sub)]">
                  {notesFilter.filtered.length !== annotationItems.length
                    ? `${notesFilter.filtered.length}/${annotationItems.length}`
                    : annotationItems.length}
                </span>
              )}
            </div>
          ) : tab === 'stats' ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-current">{_('reader.stats')}</span>
              {statsTotalSeconds > 0 && (
                <span className="inline-flex items-center rounded-full bg-stone-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--bd-read-sub)]">
                  {formatDuration(statsTotalSeconds, _)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm font-semibold text-current">
              {_('reader.ai')}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {tab === 'toc' && hasMultiLevel && (
              <button
                type="button"
                onClick={toggleAllCollapse}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current transition-colors"
                aria-label={allParentCollapsed ? _('reader.expandAll') : _('reader.collapseAll')}
                title={allParentCollapsed ? _('reader.expandAll') : _('reader.collapseAll')}
              >
                {allParentCollapsed ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m7 15 5 5 5-5" />
                    <path d="m7 9 5-5 5 5" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m7 20 5-5 5 5" />
                    <path d="m7 4 5 5 5-5" />
                  </svg>
                )}
              </button>
            )}
            {showLocate && (
              <button
                type="button"
                onClick={scrollToCurrentChapter}
                title={_('reader.locateChapter')}
                aria-label={_('reader.locateChapter')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </button>
            )}
            {tab === 'toc' && (
              <button
                type="button"
                onClick={toggleSearchBar}
                title={_('reader.search')}
                aria-label={_('reader.search')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>
            )}
            {tab === 'notes' && hasExpandableNotes && (
              <button
                type="button"
                onClick={toggleAllNotesExpand}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current transition-colors"
                aria-label={allNotesExpanded ? _('reader.collapseAll') : _('reader.expandAll')}
                title={allNotesExpanded ? _('reader.collapseAll') : _('reader.expandAll')}
              >
                {allNotesExpanded ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m7 15 5 5 5-5" />
                    <path d="m7 9 5-5 5 5" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m7 20 5-5 5 5" />
                    <path d="m7 4 5 5 5-5" />
                  </svg>
                )}
              </button>
            )}
            {tab === 'notes' && (
              <button
                type="button"
                onClick={toggleNotesSearchBar}
                title={_('reader.search')}
                aria-label={_('reader.search')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  notesSearchExpanded
                    ? 'bg-stone-500/10 text-current'
                    : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current',
                )}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>
            )}
            {tab === 'notes' && (
              <button
                ref={notesFilterBtnRef}
                type="button"
                onClick={() => setNotesFilterOpen((v) => !v)}
                title={_('annotation.filter')}
                aria-label={_('annotation.filter')}
                className={cn(
                  'relative flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  notesFilterOpen || notesFilter.hasActiveFilter || displayTypes.size < ALL_KINDS.length
                    ? 'bg-stone-500/10 text-current'
                    : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current',
                )}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                </svg>
                {(notesFilter.hasActiveFilter || displayTypes.size < ALL_KINDS.length) && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--bd-read-primary)] ring-1 ring-[var(--bd-read-bg)]" />
                )}
              </button>
            )}
            {tab === 'notes' && (
              <button
                type="button"
                onClick={enterNotesSelectionMode}
                title={_('annotation.batchManage')}
                aria-label={_('annotation.batchManage')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current transition-colors"
              >
                <BatchSelectIcon size={16} />
              </button>
            )}
          </div>
        </div>
      )}


      {/* Notes tab search bar & filter */}
      {tab === 'notes' && (
        <div className="px-4">
          <ExpandingSearchBar
            expanded={notesSearchExpanded}
            query={notesFilter.query}
            placeholder={_('reader.noteSearchPlaceholder')}
            onQueryChange={notesFilter.setQuery}
            onCollapse={toggleNotesSearchBar}
          />
          <NotesFilterPanel
            open={notesFilterOpen}
            anchorRef={notesFilterBtnRef}
            onClose={() => setNotesFilterOpen(false)}
            displayTypes={displayTypes}
            onToggleType={toggleDisplayType}
            sort={notesFilter.sort}
            onSortChange={notesFilter.setSort}
            styleFilter={notesFilter.styleFilter}
            colorFilter={notesFilter.colorFilter}
            onToggleStyle={notesFilter.toggleStyle}
            onToggleColor={notesFilter.toggleColor}
            onReset={resetNotesFilter}
          />
        </div>
      )}

      {/* Body: TOC Search Mode or Normal Tabs */}
      {tab === 'toc' && searchExpanded ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Filter Pills - single intuitive way to filter */}
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2.5 pb-2 border-b border-[var(--bd-read-accent)]/20">
            <button
              type="button"
              onClick={() => setSearchScope('book')}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                searchScope === 'book'
                  ? 'bg-stone-500/20 text-current font-medium'
                  : 'border border-stone-200/80 text-[var(--bd-read-sub)] hover:border-stone-400 hover:text-current dark:border-stone-800',
              )}
            >
              {_('reader.searchScopeBook')}
            </button>
            <button
              type="button"
              onClick={() => setSearchScope('chapter')}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                searchScope === 'chapter'
                  ? 'bg-stone-500/20 text-current font-medium'
                  : 'border border-stone-200/80 text-[var(--bd-read-sub)] hover:border-stone-400 hover:text-current dark:border-stone-800',
              )}
            >
              {_('reader.searchScopeChapter')}
            </button>
            <button
              type="button"
              onClick={() => setSearchMatchCase((v) => !v)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                searchMatchCase
                  ? 'bg-stone-500/20 text-current font-medium'
                  : 'border border-stone-200/80 text-[var(--bd-read-sub)] hover:border-stone-400 hover:text-current dark:border-stone-800',
              )}
            >
              {_('reader.searchMatchCase')}
            </button>
            <button
              type="button"
              onClick={() => setSearchMode(searchMode === 'regex' ? 'contains' : 'regex')}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                searchMode === 'regex'
                  ? 'bg-stone-500/20 text-current font-medium'
                  : 'border border-stone-200/80 text-[var(--bd-read-sub)] hover:border-stone-400 hover:text-current dark:border-stone-800',
              )}
            >
              {_('reader.searchModeRegex')}
            </button>
          </div>

          {!query.trim() ? (
            <div className="flex-1 overflow-y-auto reader-scrollbar p-4 space-y-5">
              {searchHistory.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[var(--bd-read-sub)]">
                    <span className="font-medium">{_('reader.searchRecent')}</span>
                    <button
                      type="button"
                      onClick={() => {
                        clearSearchHistory(bookId)
                        setSearchHistory([])
                      }}
                      title={_('reader.clearSearchHistory')}
                      aria-label={_('reader.clearSearchHistory')}
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {searchHistory.map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => setQuery(term)}
                        title={term}
                        className="max-w-full truncate rounded-full border border-stone-200/80 bg-stone-500/5 px-3 py-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:border-stone-400 hover:bg-stone-500/10 hover:text-current dark:border-stone-800"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--bd-read-sub)]">
                  <svg className="mb-2.5 h-8 w-8 opacity-35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <p className="text-xs">{_('reader.searchHint')}</p>
                </div>
              )}
            </div>
          ) : (
            <div
              ref={listRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto reader-scrollbar [scrollbar-gutter:stable] pl-2 pr-3 py-3 text-sm"
            >
              <div className="space-y-3">
                {searchProgress != null && searchProgress < 1 && (
                  <div className="px-1 pb-1">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-stone-500/15">
                      <div
                        data-testid="search-progress"
                        className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
                        style={{ width: `${Math.round(searchProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div className="px-1 text-xs text-[var(--bd-read-sub)]">
                    {searchResults.length} {_('reader.matches')}
                  </div>
                )}
                {searchResults.length === 0 && !searching && (
                  <p className="text-xs text-[var(--bd-read-sub)] px-1 py-8 text-center">{_('reader.noMatches')}</p>
                )}
                {resultGroups.map((group, gi) => (
                  <div key={group.chapter ?? gi}>
                    {group.chapter && (
                      <div className="mb-1.5 px-1 text-sm font-semibold text-current">{group.chapter}</div>
                    )}
                    <ul className="space-y-1">
                      {group.items.map((r) => (
                        <li key={r.index}>
                          <button
                            onClick={() => goToResult(r.index)}
                            className="w-full rounded-lg px-2 py-2 text-left text-xs leading-relaxed text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/5 hover:text-current"
                          >
                            {r.excerpt ? (
                              <>
                                {r.excerpt.pre}
                                <mark className="rounded-xs bg-[var(--bd-read-primary)]/25 px-0.5 font-medium text-current selection:bg-transparent">{r.excerpt.match}</mark>
                                {r.excerpt.post}
                              </>
                            ) : (
                              r.text
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={handleScroll}
          className={cn(
            'flex-1',
            tab === 'ai'
              ? 'overflow-hidden px-0 py-0'
              : 'overflow-y-auto reader-scrollbar [scrollbar-gutter:stable] pl-2 pr-3 pt-0 pb-2 text-sm',
            tab === 'notes' && 'flex flex-col',
          )}
        >
          {tab === 'toc' && (
            <ul className="space-y-0.5 pt-1">
              {renderSubtree(rootNodes.map((n) => n.index))}
            </ul>
          )}
        {tab === 'notes' && annotationsQuery.isError ? (
          <QueryErrorState
            className="py-8 text-[var(--bd-read-sub)]"
            isRetrying={annotationsQuery.isFetching}
            onRetry={annotationsQuery.refetch}
          />
        ) : tab === 'notes' && (
          <NotesPanel
            items={notesFilter.filtered}
            allItems={annotationItems}
            total={annotationItems.length}
            sort={notesFilter.sort}
            locked={locked}
            onClose={onClose}
            chapterOrder={chapterOrder}
            bookId={bookId}
            selectionMode={notesSelectionMode}
            onExitSelection={exitNotesSelectionMode}
            allExpanded={allNotesExpanded}
            selectedIds={selectedNoteIds}
            onToggleSelected={toggleSelectNote}
            hideSelectionToolbar={true}
          />
        )}
        {tab === 'stats' && !statsDisabled && <StatsPanel bookId={bookId} />}
        <div className={tab === 'ai' ? 'h-full' : 'hidden'}>
          <AiPanel bookId={bookId} />
        </div>
      </div>
      )}
      {searchActive && searchResults.length > 0 && (
        <div
          className="fixed bottom-14 left-1/2 z-[60] flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-full border border-stone-200/60 bg-[var(--bd-read-bg)] px-1.5 shadow-xl dark:border-stone-800/60"
          style={{ animation: 'note-editor-in 140ms ease-out forwards', '--note-dx': '0px', '--note-dy': '8px' } as CSSProperties}
        >
          <button
            onClick={() => goToResult((searchIndex - 1 + searchResults.length) % searchResults.length)}
            title={_('reader.prev')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="mx-1 flex min-w-0 items-center text-sm text-current">
            <span className="shrink-0">{_('reader.searchResultsPrefix')}</span>
            <span className="max-w-40 truncate">{query.trim()}</span>
            <span className="shrink-0">{_('reader.searchResultsSuffix')}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--bd-read-sub)]">
            {searchIndex + 1}/{searchResults.length}
          </span>
          <button
            onClick={collapseSearchBar}
            title={_('annotation.cancel')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
          >
            <CloseIcon />
          </button>
          <button
            onClick={() => goToResult((searchIndex + 1) % searchResults.length)}
            title={_('reader.next')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}
      {notesExportOpen && (
        <AnnotationExportDialog
          bookId={bookId}
          annotations={annotationItems.filter((item) => selectedNoteIds.has(item.id))}
          sort={notesFilter.sort}
          chapterOrder={chapterOrder}
          onClose={() => setNotesExportOpen(false)}
        />
      )}
      {batchDeleteConfirmOpen && (
        <ConfirmDialog
          title={_('annotation.batchDelete')}
          message={_('annotation.batchDeleteConfirm', { n: selectedNoteIds.size })}
          confirmLabel={_('annotation.batchDelete')}
          confirmVariant="danger"
          onConfirm={handleBatchDelete}
          onClose={() => setBatchDeleteConfirmOpen(false)}
        />
      )}
    </div>
  )
}))
