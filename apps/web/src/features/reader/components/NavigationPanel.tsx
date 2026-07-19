import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { useReaderApi } from '../hooks/useReaderApi'
import { useReaderState } from '../state/reader-state'
import type { SearchResult } from '../types'
import { useAnnotations, useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { useBookChapters } from '../hooks/useBookChapters'
import { HIGHLIGHT_COLORS } from './annotation-colors'

export interface NavigationPanelRef {
  saveScroll: () => void
}

interface NavigationPanelProps {
  bookId: string
}

interface TocNode {
  index: number
  label: string
  href: string
  level: number
  children: number[]
  parent: number | null
}

function buildTocTree(items: { label: string; href: string; level: number }[]): TocNode[] {
  const tree: TocNode[] = items.map((item, index) => ({ ...item, index, children: [], parent: null }))
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
  return tree
}

function formatTime(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface NavigationPanelProps {
  bookId: string
  open: boolean
  locked?: boolean
  onClose?: () => void
}

export const NavigationPanel = forwardRef<NavigationPanelRef, NavigationPanelProps>(function NavigationPanel(
  { bookId, open, locked, onClose },
  ref,
) {
  const tab = useReaderState((s) => s.activeNavTab)
  const tocItems = useReaderState((s) => s.tocItems)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const { renderer } = useReaderApi()
  const { data: annotations } = useAnnotations(bookId)
  const chaptersQuery = useBookChapters(bookId)
  const queryClient = useQueryClient()
  const deleteAnnotation = useDeleteAnnotation()
  const updateAnnotation = useUpdateAnnotation()

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

  const items = annotations?.data ?? []
  const bookmarks = items.filter((a) => a.type === 'bookmark')
  const notes = items.filter((a) => a.type === 'note' || a.type === 'highlight')

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

  function toggleCollapse(index: number, e: React.MouseEvent) {
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
    if (container && tab === 'toc') {
      savedScrollTop.current = container.scrollTop
    }
  }

  // On reopen or tab change, restore the saved TOC scroll position only if the current chapter hasn't changed.
  // When the chapter changes, the auto-scroll effect below will scroll to the new chapter instead.
  // useLayoutEffect restores before paint so the panel doesn't flash at the wrong position.
  useLayoutEffect(() => {
    const container = listRef.current
    if (!container || !open || tab !== 'toc') return
    if (savedScrollTop.current !== null && currentIndex === lastScrolledIndex.current) {
      container.scrollTop = savedScrollTop.current
    }
  }, [open, tab, currentIndex])

  // Scroll the current chapter into view when the panel opens or current chapter changes.
  // Position the current item at roughly the top 1/4 of the panel viewport for better context.
  useEffect(() => {
    if (tab !== 'toc' || !open || currentIndex < 0) return
    if (currentIndex === lastScrolledIndex.current) return
    const timer = setTimeout(() => {
      const item = itemRefs.current.get(currentIndex)
      const container = listRef.current
      if (!item || !container) return
      const containerRect = container.getBoundingClientRect()
      const itemRect = item.getBoundingClientRect()
      const desired = container.scrollTop + (itemRect.top - containerRect.top) - container.clientHeight * 0.25
      const target = Math.max(0, desired)
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: target, behavior: 'smooth' })
      } else {
        item.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
      lastScrolledIndex.current = currentIndex
      savedScrollTop.current = target
    }, 300)
    return () => clearTimeout(timer)
  }, [tab, open, currentIndex, collapsed])

  const [query, setQuery] = useState('')
  const pendingSearchQuery = useReaderState((s) => s.pendingSearchQuery)
  const setPendingSearchQuery = useReaderState((s) => s.setPendingSearchQuery)

  // "Search selection" from the toolbar lands here
  useEffect(() => {
    if (pendingSearchQuery == null) return
    setQuery(pendingSearchQuery)
    setPendingSearchQuery(null)
  }, [pendingSearchQuery, setPendingSearchQuery])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchIndex, setSearchIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchScope, setSearchScope] = useState<'book' | 'chapter'>('book')
  const [searchMatchCase, setSearchMatchCase] = useState(false)
  const [searchMode, setSearchMode] = useState<'contains' | 'regex'>('contains')
  const [searchMenuOpen, setSearchMenuOpen] = useState(false)
  const [searchMenuPos, setSearchMenuPos] = useState<{ top: number; right: number } | null>(null)
  const searchMenuBtnRef = useRef<HTMLButtonElement>(null)

  // fixed-position menu: the panel's scroll container would clip an absolute one
  function toggleSearchMenu() {
    if (!searchMenuOpen && searchMenuBtnRef.current) {
      const rect = searchMenuBtnRef.current.getBoundingClientRect()
      setSearchMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setSearchMenuOpen((v) => !v)
  }
  const bookmarkGroups = useMemo(() => {
    const groups = new Map<string, typeof bookmarks>()
    for (const b of bookmarks) {
      const key = b.chapter || t().reader.uncategorized
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(b)
    }
    return Array.from(groups.entries()).map(([chapter, items]) => ({ chapter, items }))
  }, [bookmarks])

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(bookmarkGroups.map((g) => g.chapter)))
  const prevBookmarkGroupsRef = useRef<string[]>([])
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'group' | 'item'
    chapter?: string
    bookmarkId?: string
    initialText?: string
  } | null>(null)

  // Auto-expand newly added bookmark groups while preserving user-collapsed existing ones.
  useEffect(() => {
    const current = bookmarkGroups.map((g) => g.chapter)
    const added = current.filter((chapter) => !prevBookmarkGroupsRef.current.includes(chapter))
    prevBookmarkGroupsRef.current = current
    if (added.length === 0) return
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      for (const chapter of added) next.add(chapter)
      return next
    })
  }, [bookmarkGroups])

  useEffect(() => {
    if (!contextMenu) return
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (!document.getElementById('bookmark-context-menu')?.contains(target)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [contextMenu])

  useEffect(() => {
    if (!searchMenuOpen) return
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (!document.getElementById('search-options-root')?.contains(target)) {
        setSearchMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [searchMenuOpen])

  async function doSearch() {
    if (!query.trim() || !renderer?.search) return
    setSearching(true)
    try {
      const results = await renderer.search(query.trim(), { scope: searchScope, matchCase: searchMatchCase, mode: searchMode })
      setSearchResults(results)
      setSearchIndex(0)
      if (results.length > 0) {
        renderer.display(results[0].cfi)
      }
    } finally {
      setSearching(false)
    }
  }

  // Readest-style: search as you type, debounced. Invalid regex just yields no results.
  useEffect(() => {
    if (tab !== 'search' || !open) return
    if (!query.trim()) {
      setSearchResults([])
      setSearchIndex(0)
      return
    }
    const timer = setTimeout(() => void doSearch(), 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchScope, searchMode, searchMatchCase, tab, open])

  function goToResult(delta: number) {
    if (!searchResults.length) return
    const next = (searchIndex + delta + searchResults.length) % searchResults.length
    setSearchIndex(next)
    renderer?.display(searchResults[next].cfi)
  }

  function refreshAnnotations() {
    void queryClient.invalidateQueries({ queryKey: ['annotations', bookId] })
  }

  function clearBookmarks() {
    if (!bookmarks.length) return
    if (!window.confirm(t().reader.clearBookmarksConfirm)) return
    for (const b of bookmarks) {
      deleteAnnotation.mutate(b.id)
    }
  }

  function toggleGroup(chapter: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(chapter)) next.delete(chapter)
      else next.add(chapter)
      return next
    })
  }

  function handleGroupContextMenu(e: React.MouseEvent, chapter: string) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'group', chapter })
  }

  function handleItemContextMenu(e: React.MouseEvent, bookmark: typeof bookmarks[number]) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'item',
      bookmarkId: bookmark.id,
      initialText: bookmark.text,
    })
  }

  function deleteGroupBookmarks(chapter: string) {
    setContextMenu(null)
    const items = bookmarkGroups.find((g) => g.chapter === chapter)?.items ?? []
    if (items.length === 0) return
    if (!window.confirm(`确定删除 "${chapter}" 中的 ${items.length} 个书签吗？`)) return
    for (const b of items) {
      deleteAnnotation.mutate(b.id)
    }
  }

  function deleteSingleBookmark(id: string) {
    setContextMenu(null)
    deleteAnnotation.mutate(id)
  }

  function startRename(id: string, currentText: string) {
    setContextMenu(null)
    const newText = window.prompt('重命名书签', currentText)
    if (newText === null) return
    updateAnnotation.mutate({ id, body: { text: newText.trim() || currentText } })
  }

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
            <li key={index} style={{ paddingLeft: `${Math.max(0, node.level - 1) * 0.75}rem` }}>
              <div className="flex items-center">
                {hasChildren ? (
                  <button
                    onClick={(e) => toggleCollapse(index, e)}
                    className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10"
                    aria-label={isExpanded ? '折叠' : '展开'}
                  >
                    <svg
                      className={cn('h-3 w-3 transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                ) : (
                  <span className="mr-1 h-5 w-5 shrink-0" />
                )}
                <button
                  ref={(el) => {
                    if (el) itemRefs.current.set(index, el)
                    else itemRefs.current.delete(index)
                  }}
                  onClick={() => goTo(node.href)}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    isCurrent
                      ? 'bg-stone-500/15 font-medium text-current ring-1 ring-inset ring-stone-500/20'
                      : 'text-[var(--bd-read-sub)] hover:bg-stone-500/5 hover:text-current',
                  )}
                >
                  {node.label}
                </button>
              </div>
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
          {tab === 'toc' && t().reader.toc}
          {tab === 'bookmarks' && t().reader.bookmarks}
          {tab === 'notes' && t().reader.notes}
          {tab === 'search' && t().reader.search}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'bookmarks' && bookmarks.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={refreshAnnotations}
                className="flex h-7 w-7 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current"
                aria-label={t().reader.refresh}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
              <button
                onClick={clearBookmarks}
                className="flex h-7 w-7 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-red-500/10 hover:text-red-500"
                aria-label={t().reader.clear}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
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
          <span className="text-xs text-[var(--bd-read-sub)]">
            {tab === 'toc' && `${tree.length} ${t().reader.chapters ?? '章'}`}
            {tab === 'bookmarks' && `${bookmarks.length}`}
            {tab === 'notes' && `${notes.length}`}
          </span>
        </div>
      </div>
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 text-sm">
        {tab === 'toc' && (
          <ul className="space-y-0.5">
            {renderSubtree(rootNodes.map((n) => n.index))}
          </ul>
        )}
        {tab === 'bookmarks' && (
          <div className="h-full">
            {bookmarks.length === 0 ? (
              <p className="mt-8 text-center text-xs text-[var(--bd-read-sub)]">{t().reader.noBookmarks}</p>
            ) : (
              <ul className="space-y-3">
                {bookmarkGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.chapter)
                  return (
                    <li key={group.chapter} className="rounded-lg border border-stone-200/60 p-2 dark:border-stone-800/60">
                      <button
                        data-testid={`bookmark-group-${group.chapter}`}
                        onClick={() => toggleGroup(group.chapter)}
                        onContextMenu={(e) => handleGroupContextMenu(e, group.chapter)}
                        className="flex w-full items-center justify-between px-2 py-1 text-left"
                      >
                        <span className="flex items-center gap-1 text-xs font-medium text-current">
                          <svg
                            className={cn('h-3 w-3 transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                          {group.chapter}
                        </span>
                        <span className="text-xs text-[var(--bd-read-sub)]">{group.items.length}</span>
                      </button>
                      {isExpanded && (
                        <ul className="mt-1 space-y-1">
                          {group.items.map((b) => (
                            <li
                              key={b.id}
                              className="rounded-lg p-2 hover:bg-stone-500/5"
                              onContextMenu={(e) => handleItemContextMenu(e, b)}
                            >
                              <button
                                onClick={() => goTo(b.cfiAnchor || b.cfiRange)}
                                className="w-full text-left"
                              >
                                <p className="mb-1 text-xs text-current line-clamp-2">{b.text || t().reader.bookmark}</p>
                                <p className="text-[10px] text-[var(--bd-read-sub)]">{formatTime(b.createdAt)}</p>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
        {tab === 'notes' && (
          notes.length === 0 ? (
            <p className="mt-8 text-center text-xs text-[var(--bd-read-sub)]">{t().reader.noNotes}</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      renderer?.display(n.cfiRange)
                      if (!locked) onClose?.()
                    }}
                    className="w-full rounded-lg border border-stone-200/60 p-3 text-left transition-colors hover:bg-stone-500/5 dark:border-stone-800/60"
                    style={{ borderLeft: `3px solid ${HIGHLIGHT_COLORS.find((c) => c.name === n.color)?.hex ?? '#eab308'}` }}
                  >
                    <p className="mb-1 line-clamp-2 text-xs opacity-80">{n.text || t().reader.notes}</p>
                    {n.note && <p className="text-xs text-[var(--bd-read-sub)]">{n.note}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === 'search' && (
          <div className="space-y-3">
            <div className="relative" id="search-options-root">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') goToResult(e.shiftKey ? -1 : 1)
                  }}
                  placeholder={t().reader.searchPlaceholder}
                  className="min-w-0 flex-1 rounded-lg border border-stone-200/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--bd-read-sub)] dark:border-stone-800/60"
                />
                <button
                  ref={searchMenuBtnRef}
                  onClick={toggleSearchMenu}
                  aria-label={t().reader.searchOptions}
                  className={cn(
                    'shrink-0 rounded-lg border px-2 py-2 text-sm transition-colors',
                    searchMenuOpen
                      ? 'border-current bg-current/10 text-current'
                      : 'border-stone-200/60 text-[var(--bd-read-sub)] hover:bg-stone-500/5 hover:text-current dark:border-stone-800/60',
                  )}
                >
                  <span aria-hidden>▾</span>
                </button>
              </div>
              {searchMenuOpen && searchMenuPos && (
                <div
                  className="fixed z-50 w-44 rounded-lg border border-stone-200/60 bg-[var(--bd-read-page-bg)] p-1 shadow-lg dark:border-stone-800/60"
                  style={{ top: searchMenuPos.top, right: searchMenuPos.right }}
                >
                  {(
                    [
                      { key: 'book', label: t().reader.searchScopeBook, active: searchScope === 'book', onClick: () => setSearchScope('book') },
                      { key: 'chapter', label: t().reader.searchScopeChapter, active: searchScope === 'chapter', onClick: () => setSearchScope('chapter') },
                      { key: 'contains', label: t().reader.searchModeContains, active: searchMode === 'contains', onClick: () => setSearchMode('contains') },
                      { key: 'regex', label: t().reader.searchModeRegex, active: searchMode === 'regex', onClick: () => setSearchMode('regex') },
                      { key: 'case', label: t().reader.searchMatchCase, active: searchMatchCase, onClick: () => setSearchMatchCase((v) => !v) },
                    ] as const
                  ).map((item, i) => (
                    <div key={item.key}>
                      {i === 2 || i === 4 ? <div className="mx-2 my-1 border-t border-stone-200/60 dark:border-stone-800/60" /> : null}
                      <button
                        onClick={item.onClick}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-current hover:bg-stone-500/5"
                      >
                        <span className="w-4 shrink-0 text-center">{item.active ? '✓' : ''}</span>
                        {item.label}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between text-xs text-[var(--bd-read-sub)]">
                <span>{searchResults.length} {t().reader.matches}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => goToResult(-1)}
                    className="rounded px-2 py-1 hover:bg-stone-500/10"
                  >
                    {t().reader.prev}
                  </button>
                  <span className="px-1 py-1 tabular-nums">{searchIndex + 1} / {searchResults.length}</span>
                  <button
                    onClick={() => goToResult(1)}
                    className="rounded px-2 py-1 hover:bg-stone-500/10"
                  >
                    {t().reader.next}
                  </button>
                </div>
              </div>
            )}
            {searchResults.length === 0 && query.trim() && !searching && (
              <p className="text-xs text-[var(--bd-read-sub)]">{t().reader.noMatches}</p>
            )}
            <ul className="space-y-2">
              {searchResults.map((r, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setSearchIndex(i)
                      renderer?.display(r.cfi)
                    }}
                    className={cn(
                      'w-full rounded-lg px-2 py-2 text-left text-xs transition-colors',
                      i === searchIndex ? 'bg-stone-500/10 font-medium text-current' : 'text-[var(--bd-read-sub)] hover:bg-stone-500/5 hover:text-current',
                    )}
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
        )}
      </div>
      {contextMenu && (
        <div
          id="bookmark-context-menu"
          className="fixed z-50 min-w-[8rem] rounded-lg border border-stone-200/60 bg-[var(--bd-read-bg)] py-1 shadow-xl dark:border-stone-800/60"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'group' && (
            <button
              onClick={() => deleteGroupBookmarks(contextMenu.chapter!)}
              className="block w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-stone-500/5"
            >
              删除本章全部书签
            </button>
          )}
          {contextMenu.type === 'item' && (
            <>
              <button
                onClick={() => startRename(contextMenu.bookmarkId!, contextMenu.initialText ?? '')}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
              >
                重命名
              </button>
              <button
                onClick={() => deleteSingleBookmark(contextMenu.bookmarkId!)}
                className="block w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-stone-500/5"
              >
                删除
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
})
