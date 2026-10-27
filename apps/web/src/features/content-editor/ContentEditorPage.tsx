import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearch } from '@tanstack/react-router'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TocRulePattern } from '@bookdock/shared'

import { useTocRules } from '@/api/hooks/useTocRules'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import {
  applyEditorBatch,
  createEditorDraft,
  deleteEditorUnits,
  editEditorUnit,
  getEditorDraftDiff,
  insertEditorUnits,
  mergeEditorUnits,
  moveEditorUnitsBefore,
  redoEditorDraft,
  splitEditorUnit,
  undoEditorDraft,
  type EditorDraft,
  type EditorTocRuleSelection,
  type EditorUnit,
} from './lib/editor-draft'
import { createUnits } from './lib/create-editor-units'
import { useEditorBook, useEditorChapters, useEditorTxtSource, useSaveEditorTxt } from './hooks/useEditorContent'
import ContentToolDialog from './components/ContentToolDialog'
import ContentEditorPending from './components/ContentEditorPending'
import EpubContentEditor from './components/EpubContentEditor'
import { useDraftNavigationGuard } from './hooks/useDraftNavigationGuard'
import { ContentEditorHeader } from './components/ContentEditorHeader'
import { ContentEditorDiffModal } from './components/ContentEditorDiffModal'
import LocalDraftRecovery from './components/LocalDraftRecovery'
import LeaveEditorDialog from './components/LeaveEditorDialog'
import { useEditorAccess } from './hooks/useEditorAccess'
import { useLocalEditorDraft } from './hooks/useLocalEditorDraft'
import { restoreTxtDraft, serializeTxtDraft, txtPayloadSchema } from './lib/local-draft-payload'

function makeUnitId(): string {
  return `draft-${globalThis.crypto.randomUUID()}`
}

function formatWordCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

interface ChapterSortableRowProps {
  unit: EditorUnit
  isActive: boolean
  isSelected: boolean
  selectedIds: readonly string[]
  hasChildren: boolean
  isCollapsed: boolean
  minLevel: number
  onToggleCollapse: () => void
  onSelect: (event: React.MouseEvent) => void
  onHtmlDrop: (draggedIds: string[]) => void
  draggedIdsRef: React.MutableRefObject<string[]>
}

function ChapterSortableRow({
  unit,
  isActive,
  isSelected,
  selectedIds,
  hasChildren,
  isCollapsed,
  minLevel,
  onToggleCollapse,
  onSelect,
  onHtmlDrop,
  draggedIdsRef,
}: ChapterSortableRowProps) {
  const dragged = useRef(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: unit.id,
    animateLayoutChanges: () => false,
  })

  const displayDepth = Math.max(1, (unit.level ?? 0) - minLevel + 1)

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      draggable
      onDragStart={(event) => {
        const idsToDrag = isSelected && selectedIds.length > 1 ? [...selectedIds] : [unit.id]
        draggedIdsRef.current = idsToDrag
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', unit.id)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const ids = [...draggedIdsRef.current]
        draggedIdsRef.current = []
        if (ids.length && !ids.includes(unit.id)) {
          onHtmlDrop(ids)
        }
      }}
      onPointerDownCapture={() => {
        dragged.current = false
      }}
      onPointerMoveCapture={() => {
        if (isDragging) dragged.current = true
      }}
      className={cn('relative min-w-0 list-none', isDragging && 'z-30 opacity-60')}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        onClick={(event) => {
          if (!dragged.current) onSelect(event)
        }}
        className={cn(
          'group relative flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors select-none',
          isActive
            ? 'font-medium text-stone-900 ring-1 ring-stone-500/20 bg-stone-500/12 dark:text-stone-100'
            : isSelected
              ? 'bg-stone-500/8 text-stone-900 ring-1 ring-stone-500/10 dark:bg-stone-500/15 dark:text-stone-100'
              : 'text-stone-600 hover:bg-stone-500/5 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-500/10 dark:hover:text-stone-100',
        )}
        style={{ paddingLeft: `${(displayDepth - 1) * 14 + 8}px` }}
        title={unit.title}
      >
        {/* Active Left Indicator Bar - 1:1 NavigationPanel */}
        {isActive && (
          <span
            className="absolute left-1 top-1.5 bottom-1.5 w-1 rounded-full bg-stone-900 dark:bg-stone-100"
            aria-hidden="true"
          />
        )}

        {/* Expand/Collapse Chevron or spacer - 1:1 NavigationPanel */}
        {hasChildren ? (
          <svg
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse()
            }}
            className={cn(
              'h-3.5 w-3.5 shrink-0 cursor-pointer text-stone-400 transition-transform duration-200 hover:text-stone-700 dark:hover:text-stone-200',
              !isCollapsed && 'rotate-90',
            )}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label={isCollapsed ? '展开' : '折叠'}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Chapter Title */}
        <span className="flex-1 truncate">{unit.title || '（未命名章节）'}</span>

        {/* Word Count */}
        <span className="ml-auto shrink-0 pr-1 text-xs text-stone-400 tabular-nums">
          {formatWordCount(unit.content.length)}
        </span>
      </button>
    </li>
  )
}

export default function ContentEditorPage() {
  const { id } = useParams({ from: '/books/$id/editor' })
  const target = useSearch({ from: '/books/$id/editor' })
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return <ContentEditorWorkbench key={JSON.stringify([accountId, id, target.libraryId, target.libraryBookId, target.versionLinkId])} />
}

function ContentEditorWorkbench() {
  const _ = useTranslation()
  const { id } = useParams({ from: '/books/$id/editor' })
  const { libraryId, libraryBookId, versionLinkId } = useSearch({ from: '/books/$id/editor' })
  const managedTarget = libraryId && libraryBookId && versionLinkId ? { libraryId, libraryBookId, versionLinkId } : undefined
  const invalidTarget = Boolean((libraryId || libraryBookId || versionLinkId) && !managedTarget)
  const bookQuery = useEditorBook(id)
  const book = bookQuery.data?.data
  usePageTitle(book ? _('editor.documentTitle', { title: book.title }) : _('editor.title'))
  const chaptersQuery = useEditorChapters(id, book?.format === 'txt')
  const sourceQuery = useEditorTxtSource(book)
  const saveMutation = useSaveEditorTxt(id, managedTarget)
  const tocRulesQuery = useTocRules()

  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveConflict, setSaveConflict] = useState(false)
  const [contentTool, setContentTool] = useState<'add' | 'rechapter' | null>(null)
  const [chapterSearch, setChapterSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  )

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const lastSelectedIdRef = useRef<string | null>(null)
  const draggedIds = useRef<string[]>([])
  const initializedKey = useRef<string | null>(null)
  const draftRevisionId = useRef<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const savingRef = useRef(false)
  const [hasCursor, setHasCursor] = useState(false)

  const activeUnit = draft?.units.find((unit) => unit.id === draft.activeUnitId) ?? null
  const activeIndex = draft?.units.findIndex((unit) => unit.id === activeUnit?.id) ?? -1
  const differences = useMemo(() => (draft ? getEditorDraftDiff(draft) : []), [draft])
  const customPatterns = Array.isArray(book?.meta?.customTocPatterns) ? (book.meta.customTocPatterns as TocRulePattern[]) : undefined

  const validSelectedIds = useMemo(() => {
    if (!draft) return []
    const existing = new Set(draft.units.map((u) => u.id))
    const valid = selectedIds.filter((id) => existing.has(id))
    if (valid.length > 0) return valid
    if (activeUnit?.id && existing.has(activeUnit.id)) return [activeUnit.id]
    return []
  }, [draft, selectedIds, activeUnit?.id])

  const canMergeSelected = useMemo(() => {
    if (!draft || validSelectedIds.length < 2) return false
    const selectedIdsSet = new Set(validSelectedIds)
    const indexes = draft.units.flatMap((unit, index) => selectedIdsSet.has(unit.id) ? [index] : [])
    if (indexes.length < 2 || indexes.length !== selectedIdsSet.size || indexes.at(-1)! - indexes[0]! + 1 !== indexes.length) return false
    const selected = draft.units.slice(indexes[0], indexes.at(-1)! + 1)
    const level = selected[0]!.level ?? 0
    if (selected.some((unit) => (unit.level ?? 0) !== level)) return false
    if (draft.units[indexes.at(-1)! + 1] && (draft.units[indexes.at(-1)! + 1]!.level ?? 0) > level) return false
    return true
  }, [draft, validSelectedIds])

  function handleChapterSelect(unitId: string, event: React.MouseEvent) {
    if (event.shiftKey) {
      const anchorId = lastSelectedIdRef.current ?? activeUnit?.id ?? unitId
      const allIds = draft?.units.map((u) => u.id) ?? []
      const anchorIndex = allIds.indexOf(anchorId)
      const targetIndex = allIds.indexOf(unitId)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        const rangeIds = allIds.slice(start, end + 1)
        setSelectedIds(rangeIds)
      }
    } else if (event.ctrlKey || event.metaKey) {
      lastSelectedIdRef.current = unitId
      setSelectedIds((prev) => {
        const currentList = prev.length > 0 ? prev : (activeUnit?.id ? [activeUnit.id] : [])
        if (currentList.includes(unitId)) {
          if (currentList.length > 1) {
            return currentList.filter((id) => id !== unitId)
          }
          return currentList
        }
        return [...currentList, unitId]
      })
    } else {
      lastSelectedIdRef.current = unitId
      setSelectedIds([unitId])
      update((current) => ({ ...current, activeUnitId: unitId }))
    }
  }

  function handleDndEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || !draft) return
    const idsToMove = validSelectedIds.includes(active.id as string) && validSelectedIds.length > 1
      ? validSelectedIds
      : [active.id as string]
    const oldIndex = draft.units.findIndex((u) => u.id === active.id)
    const newIndex = draft.units.findIndex((u) => u.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    update((current) => moveEditorUnitsBefore(current, idsToMove, over.id as string))
  }

  useEffect(() => {
    if (!book || sourceQuery.data === undefined || !chaptersQuery.data) return
    const key = book.id
    if (initializedKey.current === key) return
    const meta = book.meta as Record<string, unknown> | undefined
    const custom = Array.isArray(meta?.customTocPatterns) ? (meta.customTocPatterns as TocRulePattern[]) : null
    setDraft(
      createEditorDraft(createUnits(sourceQuery.data, chaptersQuery.data.data), {
        ruleId: typeof meta?.tocRuleId === 'string' ? meta.tocRuleId : null,
        patterns: custom,
        label: typeof meta?.tocRuleLabel === 'string' ? meta.tocRuleLabel : null,
        auto: meta?.tocRuleAuto === true,
      }),
    )
    draftRevisionId.current = book.revisionId ?? null
    initializedKey.current = key
  }, [book, chaptersQuery.data, sourceQuery.data])

  function update(change: (current: EditorDraft) => EditorDraft) {
    if (savingRef.current) return
    setDraft((current) => (current ? change(current) : current))
  }

  useEffect(() => {
    setHasCursor(false)
  }, [activeUnit?.id])

  function splitAtCursor() {
    if (!draft || !activeUnit || !bodyRef.current) return
    const offset = bodyRef.current.selectionStart ?? 0
    update((current) =>
      splitEditorUnit(current, activeUnit.id, offset, {
        id: makeUnitId(),
        title: '新章节',
        content: '',
        level: activeUnit.level,
        structureOnlyTitle: true,
      }),
    )
    setHasCursor(false)
  }

  function handleDeleteActiveChapter() {
    if (!activeUnit) return
    update((current) => deleteEditorUnits(current, [activeUnit.id]))
    setSelectedIds((prev) => prev.filter((id) => id !== activeUnit.id))
  }

  async function saveDraft() {
    if (!draftRevisionId.current || !draft || (differences.length === 0 && !ruleSelectionChanged)) return
    if ((libraryId || libraryBookId || versionLinkId) && !managedTarget) {
      setSaveError(true)
      return
    }
    setSaveError(false)
    setSaveConflict(false)
    savingRef.current = true
    setSaving(true)
    try {
      const response = await saveMutation.mutateAsync({
        baseRevisionId: draftRevisionId.current,
        chapters: draft.units.map(({ id: unitId, title, content, level, structureOnlyTitle }) => ({
          id: unitId,
          title,
          content,
          level: level ?? 0,
          ...(structureOnlyTitle ? { structureOnlyTitle: true } : {}),
        })),
        tocRuleSelection: draft.tocRuleSelection,
      })
      await localDraft.clear()
      setDraft(createEditorDraft(draft.units.map((unit) => {
        const savedUnit = { ...unit, structureOnlyTitle: false }
        delete savedUnit.titleChanged
        delete savedUnit.contentChanged
        return savedUnit
      }), draft.tocRuleSelection))
      draftRevisionId.current = response.data.revisionId
      const unlocatedCount = Object.values(response.data.unlocated).reduce((sum, count) => sum + count, 0)
      if (unlocatedCount) notify.warning({ key: 'editor.savePartial', params: { count: unlocatedCount } })
      else notify.success({ key: 'editor.saveSuccess' })
      setDiffModalOpen(false)
    } catch {
      setSaveError(true)
      setSaveConflict(Boolean(book?.revisionId && draftRevisionId.current && book.revisionId !== draftRevisionId.current))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function serializeDraft() {
    return draft!.units.map((unit) => `${unit.title ? `${unit.title}\n\n` : ''}${unit.content}`).join('\n\n')
  }

  function applyContentTool(units: EditorUnit[], insertIndex: number, ruleSelection: EditorTocRuleSelection) {
    if (contentTool === 'add') update((current) => insertEditorUnits(current, insertIndex, units, ruleSelection))
    else if (contentTool === 'rechapter') update((current) => applyEditorBatch(current, units, ruleSelection))
    setContentTool(null)
  }

  const minLevel = useMemo(() => {
    if (!draft || draft.units.length === 0) return 0
    return Math.min(...draft.units.map((u) => u.level ?? 0))
  }, [draft])

  const hasMultiLevel = useMemo(() => {
    if (!draft) return false
    return draft.units.some((u) => (u.level ?? 0) > minLevel)
  }, [draft, minLevel])

  const allParentCollapsed = useMemo(() => {
    if (!draft) return false
    const parentIds = draft.units
      .filter((u, i) => (draft.units[i + 1]?.level ?? 0) > (u.level ?? 0))
      .map((u) => u.id)
    return parentIds.length > 0 && parentIds.every((pid) => collapsedIds.includes(pid))
  }, [draft, collapsedIds])

  const visibleUnits = useMemo(() => {
    if (!draft) return []
    const query = chapterSearch.trim().toLocaleLowerCase()
    const visible: EditorUnit[] = []
    let collapsedAt: number | null = null
    for (let index = 0; index < draft.units.length; index += 1) {
      const unit = draft.units[index]!
      const level = unit.level ?? 0
      if (collapsedAt !== null && level <= collapsedAt) collapsedAt = null
      if (collapsedAt !== null) continue
      if (!query || unit.title.toLocaleLowerCase().includes(query)) visible.push(unit)
      if (collapsedIds.includes(unit.id) && (draft.units[index + 1]?.level ?? 0) > level) collapsedAt = level
    }
    return visible
  }, [chapterSearch, collapsedIds, draft])

  const ruleSelectionChanged = Boolean(
    draft && JSON.stringify(draft.tocRuleSelection) !== JSON.stringify(draft.baselineTocRuleSelection),
  )
  const hasChanges = differences.length > 0 || ruleSelectionChanged
  const navigation = useDraftNavigationGuard(hasChanges, saving || saveMutation.isPending, id)
  const access = useEditorAccess(id, book?.revisionId, managedTarget, book?.format === 'txt' && !invalidTarget)
  const localDraft = useLocalEditorDraft({
    bookId: id, format: 'txt', target: managedTarget, revisionId: draftRevisionId.current,
    enabled: Boolean(book?.format === 'txt' && access === 'allowed' && draft && !sourceQuery.isError && !chaptersQuery.isError),
    dirty: hasChanges, schema: txtPayloadSchema, changeToken: draft,
    payload: () => serializeTxtDraft(draft!),
    restore: (payload) => { const recovered = draft && restoreTxtDraft(draft, payload); if (!recovered) return false; setDraft(recovered); return true },
  })

  if (bookQuery.isPending) {
    return <ContentEditorPending stage="content" />
  }
  if (bookQuery.isError || !book) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-sm text-red-600 dark:text-red-400">
        无法载入这本书。
      </main>
    )
  }
  if (invalidTarget) return <main className="p-8 text-red-600">内容目标不完整，无法确认编辑权限。本地草稿已保留。</main>
  if (book.format === 'epub') return <EpubContentEditor key={book.id} book={book} target={managedTarget} />
  if (book.format !== 'txt') {
    return <main className="mx-auto max-w-3xl p-8 text-stone-600 dark:text-stone-300">此格式暂不支持内容编辑。</main>
  }
  if (access === 'error') return <main className="p-8 text-red-600">无法确认当前内容或编辑权限，请返回后重试。本地草稿已保留。</main>
  if (sourceQuery.isPending || chaptersQuery.isPending) {
    return <ContentEditorPending stage="content" />
  }
  if (sourceQuery.isError || chaptersQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-sm text-red-600 dark:text-red-400">
        正文读取失败，请返回后重试。
      </main>
    )
  }
  if (!draft) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 p-8 text-sm text-stone-500 dark:bg-stone-950 dark:text-stone-400">
        正在准备草稿…
      </main>
    )
  }
  if (access === 'pending' || (!localDraft.ready && !localDraft.candidate)) return <main className="p-8">正在检查本地草稿…</main>
  if (localDraft.candidate) return <LocalDraftRecovery record={localDraft.candidate} revisionId={draftRevisionId.current!}
    text={localDraft.candidate.payload.units.map((item) => [item.title, item.content].filter(Boolean).join('\n\n')).filter(Boolean).join('\n\n')}
    onRestore={localDraft.restore} onDiscard={localDraft.discard} failure={localDraft.failure} />

  function handleBack() {
    navigation.back()
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-stone-100/60 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <ContentEditorHeader
        title={book.title}
        format="txt"
        bookId={book.id}
        dirty={hasChanges}
        changeCount={differences.length + Number(ruleSelectionChanged)}
        localStatus={localDraft.failure ? 'failed' : localDraft.status === 'saved' ? 'saved' : 'pending'}
        saving={saving || saveMutation.isPending}
        canUndo={draft.undoStack.length > 0}
        canRedo={draft.redoStack.length > 0}
        onUndo={() => update(undoEditorDraft)}
        onRedo={() => update(redoEditorDraft)}
        onSave={() => void saveDraft()}
        onDiscard={() => setDiscardConfirm(true)}
        onOpenDiff={() => setDiffModalOpen(true)}
        onDeleteChapter={activeUnit ? handleDeleteActiveChapter : undefined}
        onSplitAtCursor={hasCursor && activeUnit ? splitAtCursor : undefined}
        onBack={handleBack}
      />

      {/* Notifications and Alerts */}
      {localDraft.failure && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{localDraft.failure}</div>}
      {saveError && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {saveConflict
            ? _('editor.saveConflict')
            : _('editor.saveFailed')}
        </div>
      )}
      {/* Main Workbench Body */}
      <fieldset disabled={saving || saveMutation.isPending} className="contents">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Left: Table of Contents & Structure Navigation */}
          <aside className="flex min-h-0 flex-col overflow-hidden border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 md:border-b-0 md:border-r">
            {/* Sidebar Single-Row Header */}
            {searchOpen || chapterSearch ? (
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-stone-200 px-3 dark:border-stone-800">
                <svg className="h-4 w-4 shrink-0 text-stone-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  autoFocus
                  aria-label={_('editor.searchChapters') || '搜索章节'}
                  value={chapterSearch}
                  onChange={(event) => setChapterSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      if (chapterSearch) setChapterSearch('')
                      else setSearchOpen(false)
                    }
                  }}
                  placeholder={_('editor.searchPlaceholder') || '搜索章节标题…'}
                  className="min-w-0 flex-1 bg-transparent text-xs text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-100"
                />
                {chapterSearch && (
                  <button
                    type="button"
                    onClick={() => setChapterSearch('')}
                    className="flex h-5 w-5 items-center justify-center rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                    title="清空"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setChapterSearch('')
                    setSearchOpen(false)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                  title="关闭搜索"
                  aria-label="关闭搜索"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : validSelectedIds.length > 1 ? (
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-stone-200 bg-stone-50/80 px-3 dark:border-stone-800 dark:bg-stone-900/80">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="rounded-full bg-stone-900 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900">
                    已选 {validSelectedIds.length} 项
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(draft.units.map((u) => u.id))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-500/10 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                    title={_('editor.selectAll') || '全选'}
                    aria-label={_('editor.selectAll') || '全选'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 7 17l-5-5" />
                      <path d="m22 10-7.5 7.5L13 16" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={!canMergeSelected}
                    onClick={() => {
                      if (!canMergeSelected) return
                      update((current) => mergeEditorUnits(current, validSelectedIds))
                      setSelectedIds([])
                    }}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                      canMergeSelected
                        ? 'text-stone-500 hover:bg-stone-500/10 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                        : 'cursor-not-allowed opacity-30 text-stone-300 dark:text-stone-600',
                    )}
                    title={
                      canMergeSelected
                        ? _('editor.mergeSelected') || '合并所选章节'
                        : _('editor.cannotMergeSelected') || '仅支持合并相邻且同层级的章节'
                    }
                    aria-label={_('editor.mergeSelected') || '合并所选章节'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m8 6 4-4 4 4" />
                      <path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22" />
                      <path d="m20 22-5-5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      update((current) => deleteEditorUnits(current, validSelectedIds))
                      setSelectedIds([])
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-red-500/15 hover:text-red-600 dark:text-stone-400 dark:hover:bg-red-500/20 dark:hover:text-red-400"
                    title={_('editor.deleteSelected') || '删除所选'}
                    aria-label={_('editor.deleteSelected') || '删除所选'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                    title={_('common.cancel') || '取消选择'}
                    aria-label={_('common.cancel') || '取消选择'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-stone-200 px-3 dark:border-stone-800">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">{_('editor.tocTitle') || '目录'}</span>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                    {draft.units.length}
                  </span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  {hasMultiLevel && (
                    <button
                      type="button"
                      onClick={() => {
                        const parentIds = draft.units
                          .filter((u, i) => (draft.units[i + 1]?.level ?? 0) > (u.level ?? 0))
                          .map((u) => u.id)
                        const allCollapsed = parentIds.length > 0 && parentIds.every((pid) => collapsedIds.includes(pid))
                        setCollapsedIds(allCollapsed ? [] : parentIds)
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                      title={allParentCollapsed ? '展开全部' : '折叠全部'}
                      aria-label={allParentCollapsed ? '展开全部' : '折叠全部'}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        {allParentCollapsed ? (
                          <>
                            <path d="m7 15 5 5 5-5" />
                            <path d="m7 9 5-5 5 5" />
                          </>
                        ) : (
                          <>
                            <path d="m7 20 5-5 5 5" />
                            <path d="m7 4 5 5 5-5" />
                          </>
                        )}
                      </svg>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(true)
                      setTimeout(() => searchInputRef.current?.focus(), 50)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                    title={_('editor.searchChapters') || '搜索章节'}
                    aria-label={_('editor.searchChapters') || '搜索章节'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      update((current) =>
                        insertEditorUnits(current, activeIndex + 1, [
                          { id: makeUnitId(), title: _('editor.addChapter') || '新章节', content: '', level: activeUnit?.level ?? 0 },
                        ]),
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                    title={_('editor.addChapter') || '新建章节'}
                    aria-label={_('editor.addChapter') || '新建章节'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => setContentTool('add')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                    title={_('editor.appendContent') || '导入章节'}
                    aria-label={_('editor.appendContent') || '导入章节'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <polyline points="9 15 12 18 15 15" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => setContentTool('rechapter')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                    title={_('editor.rechapter') || '更换目录规则'}
                    aria-label={_('editor.rechapter') || '更换目录规则'}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7h4" />
                      <path d="M3 17h4c2.5 0 3.5-10 6-10h7" />
                      <path d="m17.5 4.5 2.5 2.5-2.5 2.5" />
                      <path d="M13 17h7" />
                      <path d="m17.5 14.5 2.5 2.5-2.5 2.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}


            {/* Chapter Items List */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDndEnd}
            >
              <SortableContext
                items={visibleUnits.map((u) => u.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol aria-label={_('editor.tocTitle') || '目录'} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pl-2 pr-3 pt-1 pb-2 custom-scrollbar">
                  {visibleUnits.map((unit) => {
                    const index = draft.units.findIndex((item) => item.id === unit.id)
                    const hasChildren = (draft.units[index + 1]?.level ?? 0) > (unit.level ?? 0)
                    const isCollapsed = collapsedIds.includes(unit.id)
                    const isActive = unit.id === activeUnit?.id
                    const isSelected = validSelectedIds.includes(unit.id)

                    return (
                      <ChapterSortableRow
                        key={unit.id}
                        unit={unit}
                        isActive={isActive}
                        isSelected={isSelected}
                        selectedIds={validSelectedIds}
                        hasChildren={hasChildren}
                        isCollapsed={isCollapsed}
                        minLevel={minLevel}
                        onToggleCollapse={() =>
                          setCollapsedIds((current) =>
                            isCollapsed ? current.filter((idValue) => idValue !== unit.id) : [...current, unit.id],
                          )
                        }
                        onSelect={(e) => handleChapterSelect(unit.id, e)}
                        onHtmlDrop={(ids) => update((current) => moveEditorUnitsBefore(current, ids, unit.id))}
                        draggedIdsRef={draggedIds}
                      />
                    )
                  })}
                </ol>
              </SortableContext>
            </DndContext>
          </aside>

          {/* Right: Chapter Content & Text Editor */}
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white dark:bg-stone-900">
            {activeUnit ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-4 lg:px-8 lg:pb-8">
                {/* Heading & Meta Toolbar */}
                <div className="mb-3 flex items-center justify-between gap-4 border-b border-stone-200 pb-2.5 dark:border-stone-800">
                  <input
                    aria-label={_('editor.chapterTitle') || '章节标题'}
                    value={activeUnit.title}
                    onChange={(event) =>
                      update((current) => editEditorUnit(current, activeUnit.id, { title: event.target.value }))
                    }
                    placeholder="章节标题…"
                    className="min-w-0 flex-1 bg-transparent text-xl font-bold tracking-tight text-stone-900 outline-none placeholder:text-stone-300 dark:text-stone-100 dark:placeholder:text-stone-600 sm:text-2xl"
                  />

                  <div className="flex shrink-0 items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                    <span>
                      {_('editor.chapterIndexRatio', { current: activeIndex + 1, total: draft?.units.length ?? 0 }) ||
                        `${activeIndex + 1} / ${draft?.units.length ?? 0} 章`}
                    </span>
                    <span>•</span>
                    <span>
                      {_('editor.chapterWordCount', { count: activeUnit.content.length }) ||
                        `${activeUnit.content.length} 字`}
                    </span>
                  </div>
                </div>

                {/* Textarea Editor */}
                <div className="relative flex flex-1 flex-col min-h-0">
                  <textarea
                    ref={bodyRef}
                    aria-label={_('editor.chapterBody') || '章节正文'}
                    value={activeUnit.content}
                    onChange={(event) =>
                      update((current) => editEditorUnit(current, activeUnit.id, { content: event.target.value }))
                    }
                    onFocus={() => setHasCursor(true)}
                    onBlur={() => setHasCursor(false)}
                    onSelect={() => setHasCursor(true)}
                    onClick={() => setHasCursor(true)}
                    onKeyUp={() => setHasCursor(true)}
                    placeholder="在此输入章节正文…"
                    className="h-full w-full resize-none bg-transparent font-serif text-base leading-relaxed tracking-normal text-stone-800 outline-none transition-colors placeholder:text-stone-300 custom-scrollbar dark:text-stone-200 dark:placeholder:text-stone-600 sm:leading-8"
                  />
                </div>
              </div>
            ) : (
              <div className="m-auto flex flex-col items-center gap-2 text-stone-400">
                <svg className="h-10 w-10 stroke-stone-300 dark:stroke-stone-700" viewBox="0 0 24 24" fill="none" strokeWidth="1.5">
                  <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span className="text-sm">从左侧章节列表中选择一个章节开始编辑</span>
              </div>
            )}
          </section>
        </div>

        {/* Diff Review Modal */}
        <ContentEditorDiffModal
          open={diffModalOpen}
          differences={differences}
          ruleChanged={ruleSelectionChanged}
          baselineRuleLabel={draft.baselineTocRuleSelection.label ?? draft.baselineTocRuleSelection.ruleId}
          currentRuleLabel={draft.tocRuleSelection.label ?? draft.tocRuleSelection.ruleId}
          onClose={() => setDiffModalOpen(false)}
          onSave={() => void saveDraft()}
          saving={saving || saveMutation.isPending}
        />

        {/* Leave Page Confirm Dialog */}
        {navigation.blocked && <LeaveEditorDialog saving={saving || saveMutation.isPending}
          preserve={() => localDraft.flush()} discard={() => localDraft.clear()}
          onLeave={() => navigation.proceed?.()} onClose={() => navigation.reset?.()} />}

        {/* Discard Draft Confirm Dialog */}
        {discardConfirm && (
          <ConfirmDialog
            title={_('editor.discardConfirmTitle') || '放弃当前草稿？'}
            message={_('editor.discardConfirmMessage') || '未保存的修改将会丢失，且无法撤销。确定要放弃吗？'}
            confirmLabel={_('editor.discard') || '放弃草稿'}
            confirmVariant="danger"
            onConfirm={async () => {
              await localDraft.clear()
              setDraft(createEditorDraft(draft.baseline, draft.baselineTocRuleSelection))
              setDiscardConfirm(false)
            }}
            onClose={() => setDiscardConfirm(false)}
          />
        )}

        {/* Content Tools Dialog */}
        {contentTool && (
          <ContentToolDialog
            mode={contentTool}
            bookId={book.id}
            initialText={contentTool === 'rechapter' ? serializeDraft() : ''}
            rules={tocRulesQuery.data?.data ?? []}
            customPatterns={
              draft.tocRuleSelection.ruleId === 'custom'
                ? draft.tocRuleSelection.patterns ?? undefined
                : customPatterns
            }
            existingUnits={draft.units}
            initialRuleId={
              draft.tocRuleSelection.auto
                ? 'auto'
                : draft.tocRuleSelection.ruleId ?? 'none'
            }
            unitCount={draft.units.length}
            defaultInsertIndex={Math.max(0, activeIndex + 1)}
            onApply={applyContentTool}
            onClose={() => setContentTool(null)}
          />
        )}
      </fieldset>
    </main>
  )
}
