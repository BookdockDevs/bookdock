import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { useReaderApi } from '../hooks/useReaderApi'
import { useReaderState } from '../state/reader-state'
import type { SearchResult } from '../types'
import { useAnnotations } from '../hooks/useAnnotations'
import { useBookChapters } from '../hooks/useBookChapters'
import { useNotesFilter, type ItemKind } from '../hooks/useNotesFilter'
import { CloseIcon } from './annotation-icons'
import { ExpandingSearchBar } from './ExpandingSearchBar'
import { NotesFilterPanel } from './NotesFilterPanel'
import { NotesPanel } from './NotesPanel'
import StatsPanel from './StatsPanel'

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

interface NavigationPanelProps {
  bookId: string
  open: boolean
  locked?: boolean
  onClose?: () => void
}

export const NavigationPanel = memo(forwardRef<NavigationPanelRef, NavigationPanelProps>(function NavigationPanel(
  { bookId, open, locked, onClose },
  ref,
) {
  const _ = useTranslation()
  const tab = useReaderState((s) => s.activeNavTab)
  const tocItems = useReaderState((s) => s.tocItems)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const { renderer } = useReaderApi()
  const { data: annotations } = useAnnotations(bookId)
  const chaptersQuery = useBookChapters(bookId)

  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
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
  const notesFilterBtnRef = useRef<HTMLButtonElement>(null)

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

  const tocChapters = useMemo(() => {
    if (tocItems.length) {
      return tocItems.map((item) => ({ ...item, level: item.level ?? 1 }))
    }
    if (chaptersQuery.data?.data?.length) {
      return chaptersQuery.data.data.map((c, i) => ({ label: c.title, href: `chapter:${i}`, level: c.level }))
    }
    return []
  }, [chaptersQuery.data, tocItems])

  const tree = useMemo(() => buildTocTree(tocChapters), [tocChapters])
  const chapterOrder = useMemo(() => tocChapters.map((c) => c.label), [tocChapters])
  const rootNodes = useMemo(() => tree.filter((n) => n.parent === null), [tree])

  const currentIndex = useMemo(() => {
    if (currentChapterIndex !== null && currentChapterIndex >= 0 && currentChapterIndex < tree.length) {
      return currentChapterIndex
    }
    if (!currentChapter) return -1
    const trimmed = currentChapter.trim()
    let idx = tree.findIndex((n) => n.label.trim() === trimmed)
    if (idx < 0) {
      idx = tree.findIndex((n) => {
        const label = n.label.trim()
        return label.includes(trimmed) || trimmed.includes(label)
      })
    }
    return idx
  }, [currentChapter, currentChapterIndex, tree])

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  /** Book-search mode: results overlay the TOC list while the bar is open with a query */
  const searchActive = searchExpanded && query.trim().length > 0

  // Tracks whether the current-chapter TOC entry is inside the scroll
  // viewport; drives the "locate current chapter" button in the header
  const [currentInView, setCurrentInView] = useState(true)

  useEffect(() => {
    if (tab !== 'toc' || !open || currentIndex < 0 || searchActive) return
    const item = itemRefs.current.get(currentIndex)
    const container = listRef.current
    if (!item || !container || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => setCurrentInView(entries[0]?.isIntersecting ?? true),
      { root: container },
    )
    observer.observe(item)
    return () => observer.disconnect()
  }, [tab, open, currentIndex, searchActive, collapsed, tree])

  const showLocate = tab === 'toc' && currentIndex >= 0 && !searchActive && !currentInView

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
    renderer?.display(href)
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

  // Remember the directory scroll position when the user scrolls the TOC panel.
  // This lets us reopen at the same position without re-scrolling.
  function handleScroll() {
    const container = listRef.current
    if (container && tab === 'toc' && !searchActive) {
      savedScrollTop.current = container.scrollTop
    }
  }

  // On reopen or tab change, restore the saved TOC scroll position only if the current chapter hasn't changed.
  // When the chapter changes, the auto-scroll effect below will scroll to the new chapter instead.
  // useLayoutEffect restores before paint so the panel doesn't flash at the wrong position.
  useLayoutEffect(() => {
    const container = listRef.current
    if (!container || !open || tab !== 'toc' || searchActive) return
    if (savedScrollTop.current !== null && currentIndex === lastScrolledIndex.current) {
      container.scrollTop = savedScrollTop.current
    }
  }, [open, tab, currentIndex, searchActive])

  // Scroll the current chapter into view when the panel opens or current chapter changes.
  // Position the current item at roughly the top 1/4 of the panel viewport for better context.
  useEffect(() => {
    if (tab !== 'toc' || !open || currentIndex < 0 || searchActive) return
    if (currentIndex === lastScrolledIndex.current) return
    const timer = setTimeout(() => {
      scrollToCurrentChapter()
    }, 300)
    return () => clearTimeout(timer)
  }, [tab, open, currentIndex, collapsed, searchActive, scrollToCurrentChapter])

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
  const [searchMenuOpen, setSearchMenuOpen] = useState(false)
  const [searchMenuPos, setSearchMenuPos] = useState<{ top: number; right: number } | null>(null)
  const searchMenuBtnRef = useRef<HTMLButtonElement>(null)
  const searchGenRef = useRef(0)
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

  // fixed-position menu: the panel's scroll container would clip an absolute one
  function toggleSearchMenu() {
    if (!searchMenuOpen && searchMenuBtnRef.current) {
      const rect = searchMenuBtnRef.current.getBoundingClientRect()
      setSearchMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setSearchMenuOpen((v) => !v)
  }

  useEffect(() => {
    if (!searchMenuOpen) return
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (!document.getElementById('search-options-menu')?.contains(target) && !searchMenuBtnRef.current?.contains(target)) {
        setSearchMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [searchMenuOpen])

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
          const hasChildren = node.children.length > 0
          const isExpanded = !collapsed.has(index)
          const hidden = node.parent !== null && collapsed.has(node.parent)
          if (hidden) return null

          return (
            <li key={index}>
              <button
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el)
                  else itemRefs.current.delete(index)
                }}
                onClick={() => handleItemClick(node)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-1.5 text-left text-sm transition-colors',
                  isCurrent
                    ? 'bg-stone-500/15 font-medium text-current ring-1 ring-inset ring-stone-500/20'
                    : 'text-[var(--bd-read-sub)] hover:bg-stone-500/5 hover:text-current',
                )}
                style={{ paddingLeft: `${(node.displayDepth - 1) * 14 + 8}px` }}
                title={node.label}
              >
                {hasChildren ? (
                  <svg
                    onClick={(e) => handleExpanderClick(e, node.index)}
                    className={cn('h-3 w-3 shrink-0 cursor-pointer text-[var(--bd-read-sub)] transition-transform', isExpanded && 'rotate-90')}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-label={isExpanded ? '折叠' : '展开'}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="flex-1 truncate">{node.label}</span>
              </button>
              {hasChildren && isExpanded && renderSubtree(node.children)}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="sticky top-0 z-10 flex h-12 items-center border-b border-[var(--bd-read-accent)] px-4"
        style={{ backgroundColor: 'var(--bd-read-bg)' }}
      >
        <span className="text-sm font-medium text-current">
          {tab === 'toc' && _('reader.toc')}
          {tab === 'notes' && _('reader.notes')}
          {tab === 'stats' && _('reader.stats')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {showLocate && (
            <button
              onClick={scrollToCurrentChapter}
              title={_('reader.locateChapter')}
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
            </button>
          )}
          {tab !== 'stats' && (
          <button
            onClick={tab === 'toc' ? toggleSearchBar : toggleNotesSearchBar}
            title={_('reader.search')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors',
              (tab === 'toc' ? searchExpanded : notesSearchExpanded)
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
              onClick={() => setNotesFilterOpen((v) => !v)}
              title={_('annotation.filter')}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded transition-colors',
                notesFilterOpen || notesFilter.hasActiveFilter || displayTypes.size < ALL_KINDS.length
                  ? 'bg-stone-500/10 text-current'
                  : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current',
              )}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
            </button>
          )}
          {tab === 'toc' && hasMultiLevel && (
            <button
              onClick={toggleAllCollapse}
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current"
              aria-label={allParentCollapsed ? '全部展开' : '全部折叠'}
            >
              {allParentCollapsed ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l-4 6 4 6" />
                  <path d="M15 6l4 6-4 6" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 6l4 6-4 6" />
                  <path d="M19 6l-4 6 4 6" />
                </svg>
              )}
            </button>
          )}
          {tab === 'toc' && (
            <span className="text-xs text-[var(--bd-read-sub)]">{`${tree.length} ${_('reader.chapters')}`}</span>
          )}
        </div>
      </div>
      {tab === 'toc' && (
        <div className="px-4">
          <ExpandingSearchBar
            expanded={searchExpanded}
            query={query}
            placeholder={_('reader.searchPlaceholder')}
            onQueryChange={(q) => (q.trim() ? setQuery(q) : clearSearch())}
            onCollapse={collapseSearchBar}
            progress={searchProgress}
          >
            <button
              ref={searchMenuBtnRef}
              onClick={toggleSearchMenu}
              title={_('reader.searchOptions')}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
                searchMenuOpen
                  ? 'border-current bg-current/10 text-current'
                  : 'border-stone-200/60 text-[var(--bd-read-sub)] hover:bg-stone-500/5 hover:text-current dark:border-stone-800/60',
              )}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
              </svg>
            </button>
          </ExpandingSearchBar>
          {searchMenuOpen && searchMenuPos && (
            <div
              id="search-options-menu"
              className="fixed z-[60] w-44 rounded-lg border border-stone-200/60 bg-[var(--bd-read-page-bg)] p-1 shadow-lg dark:border-stone-800/60"
              style={{ top: searchMenuPos.top, right: searchMenuPos.right }}
            >
              {(
                [
                  { type: 'scope' as const, key: 'book', label: _('reader.searchScopeBook'), active: searchScope === 'book', onClick: () => setSearchScope('book') },
                  { type: 'scope' as const, key: 'chapter', label: _('reader.searchScopeChapter'), active: searchScope === 'chapter', onClick: () => setSearchScope('chapter') },
                  { type: 'mode' as const, key: 'contains', label: _('reader.searchModeContains'), active: searchMode === 'contains', onClick: () => setSearchMode('contains') },
                  { type: 'mode' as const, key: 'regex', label: _('reader.searchModeRegex'), active: searchMode === 'regex', onClick: () => setSearchMode('regex') },
                  { type: 'toggle' as const, key: 'case', label: _('reader.searchMatchCase'), active: searchMatchCase, onClick: () => setSearchMatchCase((v) => !v) },
                ]
              ).map((item, i) => (
                <div key={item.key}>
                  {i === 2 || i === 4 ? <div className="mx-2 my-1 border-t border-stone-300 dark:border-stone-600" /> : null}
                  <button
                    onClick={item.onClick}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-current hover:bg-stone-500/5"
                  >
                    <span className="w-4 shrink-0 text-center text-xs">
                      {item.active ? '✓' : ''}
                    </span>
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto pl-2 pr-4 py-4 text-sm">
        {tab === 'toc' && (searchActive ? (
          <div className="space-y-3">
            {searchResults.length > 0 && (
              <div className="px-1 text-xs text-[var(--bd-read-sub)]">
                {searchResults.length} {_('reader.matches')}
              </div>
            )}
            {searchResults.length === 0 && !searching && (
              <p className="text-xs text-[var(--bd-read-sub)]">{_('reader.noMatches')}</p>
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
                            <mark className="bg-yellow-500/30 text-current">{r.excerpt.match}</mark>
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
        ) : (
          <ul className="space-y-0.5">
            {renderSubtree(rootNodes.map((n) => n.index))}
          </ul>
        ))}
        {tab === 'notes' && (
          <NotesPanel
            items={notesFilter.filtered}
            total={annotationItems.length}
            sort={notesFilter.sort}
            locked={locked}
            onClose={onClose}
            chapterOrder={chapterOrder}
            bookId={bookId}
          />
        )}
        {tab === 'stats' && <StatsPanel bookId={bookId} />}
      </div>
      {searchActive && searchResults.length > 0 && (
        <div
          className="fixed bottom-16 left-1/2 z-[60] flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-full border border-stone-200/60 bg-[var(--bd-read-bg)] px-1.5 shadow-xl dark:border-stone-800/60"
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
            onClick={clearSearch}
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
    </div>
  )
}))
