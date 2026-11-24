import { editorSourceRevision, editorSourceEntries } from '../lib/editor-publication-source'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ClientLibraryDetailView, EditorEpubLoadRes, EditorEpubSaveReq } from '@bookdock/shared'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { ManagedEditorTarget } from '../hooks/useEditorContent'
import { useEditorEpubSource, useEditorManifest, useEditorSpineText, useSaveEditorEpub } from '../hooks/useEditorContent'
import { useDraftNavigationGuard } from '../hooks/useDraftNavigationGuard'
import {
  createEpubEditorDraft,
  editEpubDocument,
  editEpubTocEntry,
  getEpubTocSubtreeEnd,
  hasEpubEditorChanges,
  moveEpubTocSelection,
  redoEpubEditorDraft,
  undoEpubEditorDraft,
  type EpubEditorDraftState,
} from '../lib/epub-editor-draft'
import { applyEpubBackgroundContrast, applyEpubEditorTheme, epubEditorFrame, locateEpubFragment, markEpubImplicitTableBodies, serializeVisibleBody, syncEpubHeading, validateEpubXhtml } from '../lib/epub-document-adapter'
import { prepareEditorResources } from '../lib/epub-editor-resources'
import { buildEpubTocTree, findSafeEpubHeading, splitTocHref, visibleEpubTocNodes, type EpubTocNode } from '../lib/epub-editor-navigation'
import EpubTocRow from './EpubTocRow'
import EpubFileTree from './EpubFileTree'
import EpubEditorDiffModal from './EpubEditorDiffModal'
import { getEpubEditorDiff } from '../lib/epub-editor-diff'
import { ContentEditorHeader } from './ContentEditorHeader'
import ContentEditorPending from './ContentEditorPending'
import CodeEditor from '@/components/ui/CodeEditor'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'
import { useEditorAccess } from '../hooks/useEditorAccess'
import { useLocalEditorDraft } from '../hooks/useLocalEditorDraft'
import { epubPayloadSchema, restoreEpubDraft } from '../lib/local-draft-payload'
import LocalDraftRecovery from './LocalDraftRecovery'
import LeaveEditorDialog from './LeaveEditorDialog'

interface EpubContentEditorProps {
  book: ClientLibraryDetailView
  target?: ManagedEditorTarget
}

function initialDraft(source: EditorEpubLoadRes): EpubEditorDraftState {
  return createEpubEditorDraft({ documents: source.documents, tocEntries: source.tocEntries, spineOrder: source.spineOrder })
}

function changedDocuments(draft: EpubEditorDraftState): EditorEpubSaveReq['documents'] {
  return draft.documents.filter((document) => document.changed).map(({ href, content }) => ({ href, content }))
}

function parentIndices(nodes: EpubTocNode[]): number[] {
  return nodes.flatMap((node) => (node.children.length ? [node.index, ...parentIndices(node.children)] : []))
}

function visibleIndices(nodes: EpubTocNode[], expanded: Set<number>, searchActive: boolean): number[] {
  return nodes.flatMap((node) => [
    node.index,
    ...(node.children.length > 0 && (expanded.has(node.index) || searchActive) ? visibleIndices(node.children, expanded, searchActive) : []),
  ])
}

function setOfIndices(indices: number[]): Set<number> {
  return new Set(indices)
}

function tocParentIndex(entries: EpubEditorDraftState['tocEntries'], index: number): number | null {
  const level = entries[index]?.level
  if (level === undefined) return null
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (entries[candidate]!.level < level) return candidate
  }
  return null
}

function tocSelectionRoots(entries: EpubEditorDraftState['tocEntries'], indices: number[]): number[] {
  return [...new Set(indices)].filter((index) => index >= 0 && index < entries.length)
    .sort((a, b) => a - b)
    .filter((index, _, all) => !all.some((candidate) => candidate < index && getEpubTocSubtreeEnd(entries, candidate) > index))
}

function canMoveTocSelection(entries: EpubEditorDraftState['tocEntries'], indices: number[], targetIndex: number | null, placement: 'before' | 'after' | 'end'): boolean {
  const roots = tocSelectionRoots(entries, indices)
  if (roots.length === 0) return false
  const parent = tocParentIndex(entries, roots[0]!)
  if (roots.some((index) => tocParentIndex(entries, index) !== parent)) return false
  if (placement === 'end') return parent === null && roots.every((index) => entries[index]!.level === 1)
  if (targetIndex === null || targetIndex < 0 || targetIndex >= entries.length) return false
  if (roots.some((index) => targetIndex >= index && targetIndex < getEpubTocSubtreeEnd(entries, index))) return false
  return tocParentIndex(entries, targetIndex) === parent && roots.every((index) => entries[index]!.level === entries[targetIndex]!.level)
}

export default function EpubContentEditor({ book, target }: EpubContentEditorProps) {
  const _ = useTranslation()
  const sourceQuery = useEditorEpubSource(book.id, book.revisionId, book.format === 'epub', target)
  const manifestQuery = useEditorManifest(book)
  const source = sourceQuery.data?.data
  const [draft, setDraft] = useState<EpubEditorDraftState | null>(null)
  const [activeHref, setActiveHref] = useState<string | null>(null)
  const [activeFragment, setActiveFragment] = useState<string | null>(null)
  const [frameGeneration, setFrameGeneration] = useState(0)
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)
  const [resourceWarning, setResourceWarning] = useState(false)
  const [originalStyles, setOriginalStyles] = useState(true)
  const [backgroundContrast, setBackgroundContrast] = useState(false)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [pendingFrameEdit, setPendingFrameEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tocSearch, setTocSearch] = useState('')
  const [selectedTocIndices, setSelectedTocIndices] = useState<Set<number>>(() => new Set())
  const [activeTocIndex, setActiveTocIndex] = useState<number | null>(null)
  const [expandedTocIndices, setExpandedTocIndices] = useState<Set<number>>(() => new Set())
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [view, setView] = useState<'toc' | 'files'>('toc')
  const [editorMode, setEditorMode] = useState<'wysiwyg' | 'source' | 'split'>('wysiwyg')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [splitFrameDocument, setSplitFrameDocument] = useState<Document | null>(null)
  const splitIframeRef = useRef<HTMLIFrameElement>(null)
  const viewScrollRef = useRef<{ toc: { href: string | null; top: number } | null; files: { href: string | null; top: number } | null }>({ toc: null, files: null })
  const restoreScrollRef = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; placement: 'before' | 'after' } | null>(null)
  const lastSelectedTocIndexRef = useRef<number | null>(null)
  const darkTheme = useUiStore((state) => state.systemTheme === 'dark')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const editableDocument = draft?.documents.find((document) => document.href === activeHref) ?? null
  const previewEntry = !editableDocument && activeHref && source && manifestQuery.data && editorSourceRevision(manifestQuery.data) === source.revisionId
    ? editorSourceEntries(manifestQuery.data).find((entry) => entry.path === activeHref) : undefined
  const previewIsText = Boolean(previewEntry && /^(application\/(xhtml\+xml|xml)|text\/html)$/i.test(previewEntry.mediaType) && !/\.(opf|ncx)$/i.test(previewEntry.path))
  const previewIsCodeText = Boolean(
    previewEntry &&
    !previewIsText &&
    (/^(text\/(css|plain)|application\/(oebps-package\+xml|x-dtbncx\+xml|xml))$/i.test(previewEntry.mediaType) ||
      /\.(css|opf|ncx|xml|txt)$/i.test(previewEntry.path)),
  )
  const previewIsImage = Boolean(previewEntry && /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i.test(previewEntry.mediaType))
  const previewQuery = useEditorSpineText(book, manifestQuery.data, previewIsText || previewIsCodeText ? activeHref ?? undefined : undefined)
  const previewContent = previewIsText ? previewQuery.data : previewIsImage && activeHref
    ? `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><img alt="封面或书内图片" src="./${encodeURIComponent(activeHref.split('/').at(-1) ?? '')}${activeFragment ? `#${encodeURIComponent(activeFragment)}` : ''}"/></body></html>`
    : undefined
  const activeDocument = editableDocument ?? (activeHref && previewContent ? { href: activeHref, content: previewContent } : null)
  const previewOnly = !editableDocument
  const archiveEntries = useMemo(() => {
    if (manifestQuery.data && editorSourceRevision(manifestQuery.data) === source?.revisionId) {
      return editorSourceEntries(manifestQuery.data)
    }
    return (draft?.documents ?? []).map((doc) => ({
      path: doc.href,
      mediaType: 'application/xhtml+xml',
      size: doc.content.length,
    }))
  }, [draft?.documents, manifestQuery.data, source?.revisionId])
  const changedDocHrefs = useMemo(
    () => new Set((draft?.documents ?? []).filter((doc) => doc.changed).map((doc) => doc.href)),
    [draft?.documents],
  )
  const activeXhtmlValidation = useMemo(
    () => (editableDocument ? validateEpubXhtml(editableDocument.content) : { valid: true, issue: null }),
    [editableDocument],
  )
  const [collapsedFileDirs, setCollapsedFileDirs] = useState<Set<string>>(() => new Set())
  const allFileDirs = useMemo(() => {
    const dirs = new Set<string>()
    for (const entry of archiveEntries) {
      const parts = entry.path.split('/').filter(Boolean)
      let current = ''
      for (let i = 0; i < parts.length - 1; i += 1) {
        current = current ? `${current}/${parts[i]!}` : parts[i]!
        dirs.add(current)
      }
    }
    return [...dirs]
  }, [archiveEntries])
  const lastValidSplitMarkupRef = useRef<{ href: string; content: string } | null>(null)
  if (editableDocument && activeXhtmlValidation.valid) {
    lastValidSplitMarkupRef.current = { href: editableDocument.href, content: editableDocument.content }
  }
  const splitPreviewContent = useMemo(() => {
    if (!editableDocument) return undefined
    return lastValidSplitMarkupRef.current?.href === editableDocument.href
      ? lastValidSplitMarkupRef.current.content
      : editableDocument.content
  }, [editableDocument])
  const splitInitialContentRef = useRef<{ href: string; content: string; srcDoc: string } | null>(null)
  if (editorMode === 'split' && activeHref && splitPreviewContent) {
    if (splitInitialContentRef.current?.href !== activeHref) {
      splitInitialContentRef.current = { href: activeHref, content: splitPreviewContent, srcDoc: epubEditorFrame(splitPreviewContent, darkTheme) }
    }
  } else {
    splitInitialContentRef.current = null
  }
  const splitInitial = splitInitialContentRef.current
  const [debouncedSplit, setDebouncedSplit] = useState<{ href: string; content: string } | null>(null)
  const appliedSplitContentRef = useRef<{ doc: Document; content: string } | null>(null)
  const splitContent = splitInitial && (debouncedSplit?.href === splitInitial.href ? debouncedSplit.content : splitInitial.content)

  useEffect(() => {
    if (editorMode !== 'split' || !activeHref || !splitPreviewContent) {
      setDebouncedSplit(null)
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedSplit({ href: activeHref, content: splitPreviewContent })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [editorMode, activeHref, splitPreviewContent])
  const draftRef = useRef(draft)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const activeDocumentRef = useRef(activeDocument)
  const previewOnlyRef = useRef(previewOnly)
  const activeFragmentRef = useRef(activeFragment)
  const sourceRevision = useRef<string | null>(null)
  const savingRef = useRef(false)
  const frameEditTimer = useRef<number | null>(null)
  const pendingFrameEditRef = useRef<{ href: string; markup: string; body: Element } | null>(null)

  draftRef.current = draft
  activeDocumentRef.current = activeDocument
  previewOnlyRef.current = previewOnly
  activeFragmentRef.current = activeFragment
  const iframeContent = useMemo(() => {
    const document = activeHref ? draftRef.current?.documents.find((item) => item.href === activeHref) ?? (previewContent ? { content: previewContent } : null) : null
    return { key: `${activeHref}:${frameGeneration}`, srcDoc: document ? epubEditorFrame(document.content) : undefined }
  }, [activeHref, frameGeneration, previewContent])
  const dirty = Boolean(draft && hasEpubEditorChanges(draft)) || pendingFrameEdit
  const localChangeToken = useMemo(() => ({ draft, view, activeHref, activeTocIndex, pendingFrameEdit }), [draft, view, activeHref, activeTocIndex, pendingFrameEdit])
  const access = useEditorAccess(book.id, source?.revisionId, target)
  const localDraft = useLocalEditorDraft({
    bookId: book.id, format: 'epub', target, revisionId: sourceRevision.current,
    enabled: Boolean(access === 'allowed' && source && draft && !sourceQuery.isError),
    dirty, saving, schema: epubPayloadSchema, changeToken: localChangeToken,
    payload: () => ({ documents: changedDocuments(draft!), tocEntries: draft!.tocEntries, spineOrder: draft!.spineOrder, view, activeHref, activeTocIndex }),
    restore: (payload) => {
      const recovered = draft && restoreEpubDraft(draft, payload)
      if (!recovered) return false
      const href = payload.activeHref && recovered.documents.some((item) => item.href === payload.activeHref) ? payload.activeHref : recovered.spineOrder[0] ?? null
      setDraft(recovered); draftRef.current = recovered; setView(payload.view); setActiveHref(href)
      const index = payload.activeTocIndex !== null && recovered.tocEntries[payload.activeTocIndex] ? payload.activeTocIndex : null
      setActiveTocIndex(index); setSelectedTocIndices(index === null ? new Set() : new Set([index]))
      const location = index === null ? null : splitTocHref(recovered.tocEntries[index]!.href)
      setActiveFragment(location?.documentHref === href && payload.view === 'toc' ? location.fragment : null)
      setExpandedTocIndices(setOfIndices(parentIndices(buildEpubTocTree(recovered.tocEntries)))); setFrameGeneration((value) => value + 1)
      return true
    },
  })
  const saveMutation = useSaveEditorEpub(book.id, target, localDraft.clear)
  const tocTree = useMemo(() => buildEpubTocTree(draft?.tocEntries ?? []), [draft?.tocEntries])
  const filteredTocTree = useMemo(() => visibleEpubTocNodes(tocTree, tocSearch), [tocSearch, tocTree])
  const searchActive = tocSearch.trim().length > 0
  const tocDndIndices = visibleIndices(filteredTocTree, expandedTocIndices, searchActive)
  const selectedIndices = [...selectedTocIndices].filter((index) => index >= 0 && index < (draft?.tocEntries.length ?? 0)).sort((a, b) => a - b)
  const currentTocEntry = activeTocIndex !== null ? draft?.tocEntries[activeTocIndex] ?? null : null
  const currentDocument = currentTocEntry && draft ? draft.documents.find((document) => document.href === splitTocHref(currentTocEntry.href).documentHref) : null
  const baselineHeadingEntry = currentTocEntry && draft
    ? draft.baseline.tocEntries.filter((entry) => entry.href === currentTocEntry.href)
    : []
  const headingSyncEntry = currentTocEntry && (currentTocEntry.href.includes('#')
    ? currentTocEntry
    : baselineHeadingEntry.length === 1 ? { ...currentTocEntry, title: baselineHeadingEntry[0]!.title } : currentTocEntry)
  const headingSync = currentTocEntry && currentDocument && headingSyncEntry
    ? findSafeEpubHeading(currentDocument, headingSyncEntry)
    : { headingIndex: null, reason: currentTocEntry ? '该目录项没有对应的正文文件。' : '先选择一个目录项。' }


  const sourceConflict = Boolean(source && sourceRevision.current && source.revisionId !== sourceRevision.current)
  const navigation = useDraftNavigationGuard(dirty, saving || saveMutation.isPending, book.id)
  const tocSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  useEffect(() => () => {
    if (frameEditTimer.current !== null) window.clearTimeout(frameEditTimer.current)
  }, [])

  useEffect(() => {
    const document = iframeRef.current?.contentDocument
    if (document) applyEpubEditorTheme(document, darkTheme)
  }, [darkTheme, activeHref, frameGeneration])

  useEffect(() => {
    const document = iframeRef.current?.contentDocument
    if (document) applyEpubBackgroundContrast(document, backgroundContrast)
  }, [backgroundContrast, frameDocument])

  useEffect(() => {
    const loaded = manifestQuery.data
    const active = activeDocumentRef.current
    if (!frameDocument || frameDocument !== iframeRef.current?.contentDocument || !active) return
    setResourceWarning(false)
    const resources = loaded && editorSourceRevision(loaded) === sourceRevision.current ? loaded : undefined
    return prepareEditorResources(frameDocument, active.content, active.href, resources, undefined, () => setResourceWarning(true), originalStyles)
  }, [editorMode, frameDocument, manifestQuery.data, activeHref, frameGeneration, originalStyles])

  useEffect(() => {
    if (editorMode !== 'split') return
    if (splitFrameDocument && splitFrameDocument === splitIframeRef.current?.contentDocument) {
      applyEpubEditorTheme(splitFrameDocument, darkTheme)
      applyEpubBackgroundContrast(splitFrameDocument, backgroundContrast)
    }
  }, [editorMode, splitFrameDocument, darkTheme, backgroundContrast])

  useEffect(() => {
    if (!splitInitial || !splitContent) return
    if (!splitFrameDocument || splitFrameDocument !== splitIframeRef.current?.contentDocument) return

    const prev = appliedSplitContentRef.current
    const renderedContent = prev?.doc === splitFrameDocument ? prev.content : splitInitial.content
    if (renderedContent === splitContent) return

    const parsed = new DOMParser().parseFromString(splitContent, 'application/xhtml+xml')
    const nextBody = parsed.getElementsByTagName('body')[0]
    if (parsed.querySelector('parsererror') || !nextBody) return

    const scrolling = splitFrameDocument.scrollingElement
    const top = scrolling?.scrollTop ?? 0
    splitFrameDocument.body.replaceChildren(...Array.from(nextBody.childNodes, (node) => splitFrameDocument.importNode(node, true)))
    if (scrolling) scrolling.scrollTop = top
    appliedSplitContentRef.current = { doc: splitFrameDocument, content: splitContent }
  }, [splitFrameDocument, splitInitial, splitContent])

  // Apply resources after the body patch so cleanup never restores attributes on the new nodes.
  useEffect(() => {
    if (!splitInitial || !splitContent || !splitFrameDocument || splitFrameDocument !== splitIframeRef.current?.contentDocument) return
    const loaded = manifestQuery.data
    const resources = loaded && editorSourceRevision(loaded) === sourceRevision.current ? loaded : undefined
    return prepareEditorResources(splitFrameDocument, splitContent, splitInitial.href, resources, undefined, undefined, originalStyles)
  }, [splitFrameDocument, splitInitial, splitContent, manifestQuery.data, originalStyles])

  useEffect(() => {
    if (!source || sourceRevision.current === source.revisionId || (draft && dirty)) return
    setDraft(initialDraft(source))
    const firstTocEntry = source.tocEntries.find((entry) => source.documents.some((document) => document.href === splitTocHref(entry.href).documentHref))
    const firstLocation = firstTocEntry ? splitTocHref(firstTocEntry.href) : null
    setActiveHref(firstLocation?.documentHref ?? source.spineOrder[0] ?? null)
    setActiveFragment(firstLocation?.fragment ?? null)
    setExpandedTocIndices(setOfIndices(parentIndices(buildEpubTocTree(source.tocEntries))))
    const firstTocIndex = firstTocEntry ? source.tocEntries.indexOf(firstTocEntry) : -1
    setSelectedTocIndices(firstTocIndex >= 0 ? new Set([firstTocIndex]) : new Set())
    setActiveTocIndex(firstTocIndex >= 0 ? firstTocIndex : null)
    lastSelectedTocIndexRef.current = firstTocIndex >= 0 ? firstTocIndex : null
    setFrameGeneration((value) => value + 1)
    sourceRevision.current = source.revisionId
  }, [dirty, draft, source])


  function flushPendingFrameEdit(): EpubEditorDraftState | null {
    if (frameEditTimer.current !== null) {
      window.clearTimeout(frameEditTimer.current)
      frameEditTimer.current = null
    }
    const pending = pendingFrameEditRef.current
    pendingFrameEditRef.current = null
    setPendingFrameEdit(false)
    if (!pending || !draftRef.current) return draftRef.current
    const serialized = serializeVisibleBody(pending.markup, pending.body)
    const nextDraft = editEpubDocument(draftRef.current, pending.href, serialized)
    draftRef.current = nextDraft
    setDraft(nextDraft)
    return nextDraft
  }

  function update(change: (current: EpubEditorDraftState) => EpubEditorDraftState) {
    if (savingRef.current) return
    const current = flushPendingFrameEdit() ?? draftRef.current
    if (!current) return
    const next = change(current)
    if (next.tocEntries !== current.tocEntries) preserveTocState(current, next)
    setDraft(next)
  }

  function navigateTo(href: string) {
    flushPendingFrameEdit()
    const { documentHref, fragment } = splitTocHref(href)
    setActiveHref(documentHref)
    setActiveFragment(fragment)
    setNavigationMessage(null)
    const document = iframeRef.current?.contentDocument
    if (document && activeHref === documentHref) {
      if (fragment) {
        const target = locateEpubFragment(document, fragment)
        if (target) target.scrollIntoView?.({ block: 'start' })
        else setNavigationMessage(`正文文件中找不到片段“${fragment}”，已定位到文件起始处。`)
      } else {
        document.body.scrollIntoView?.({ block: 'start' })
      }
    }
  }

  function switchView(next: 'toc' | 'files') {
    if (next === view) return
    flushPendingFrameEdit()
    const scrolling = iframeRef.current?.contentDocument?.scrollingElement
    viewScrollRef.current[view] = { href: activeHref, top: scrolling?.scrollTop ?? 0 }
    const entry = activeTocIndex === null ? null : draft?.tocEntries[activeTocIndex]
    const destination = next === 'files'
      ? (activeHref && draft?.spineOrder.includes(activeHref) ? activeHref : viewScrollRef.current.files?.href ?? draft?.spineOrder[0])
      : entry?.href
    const destinationHref = destination ? splitTocHref(destination).documentHref : activeHref
    const savedScroll = viewScrollRef.current[next]
    restoreScrollRef.current = savedScroll?.href === destinationHref ? savedScroll.top : null
    setView(next)
    if (destination) {
      navigateTo(destination)
    }
    if (scrolling && destinationHref === activeHref && restoreScrollRef.current !== null) {
      scrolling.scrollTop = restoreScrollRef.current
      restoreScrollRef.current = null
    }
  }

  function handleTocSelect(index: number, href: string, event: React.MouseEvent | React.KeyboardEvent) {
    if (event.shiftKey) {
      const anchor = lastSelectedTocIndexRef.current ?? activeTocIndex ?? index
      const start = Math.min(anchor, index)
      const end = Math.max(anchor, index)
      setSelectedTocIndices(new Set(Array.from({ length: end - start + 1 }, (_, offset) => start + offset)))
    } else if (event.ctrlKey || event.metaKey) {
      lastSelectedTocIndexRef.current = index
      setSelectedTocIndices((current) => {
        const next = new Set(current.size ? current : activeTocIndex !== null ? [activeTocIndex] : [])
        if (next.has(index)) {
          if (next.size > 1) next.delete(index)
        } else next.add(index)
        return next
      })
    } else {
      lastSelectedTocIndexRef.current = index
      setSelectedTocIndices(new Set([index]))
      setActiveTocIndex(index)
      navigateTo(href)
    }
  }

  function preserveTocState(previous: EpubEditorDraftState, next: EpubEditorDraftState) {
    const nextByIdentity = new Map(next.tocEntries.map((entry, index) => [entry, index]))
    const nextByValue = new Map<string, number[]>()
    const nextByHref = new Map<string, number[]>()
    next.tocEntries.forEach((entry, index) => {
      const key = JSON.stringify([entry.href, entry.title, entry.level])
      const values = nextByValue.get(key) ?? []
      values.push(index)
      nextByValue.set(key, values)
      const hrefs = nextByHref.get(entry.href) ?? []
      hrefs.push(index)
      nextByHref.set(entry.href, hrefs)
    })
    const valueOccurrences = new Map<string, number>()
    const hrefOccurrences = new Map<string, number>()
    const mappedIndices = previous.tocEntries.map((entry) => {
      const key = JSON.stringify([entry.href, entry.title, entry.level])
      const valueOccurrence = valueOccurrences.get(key) ?? 0
      const hrefOccurrence = hrefOccurrences.get(entry.href) ?? 0
      valueOccurrences.set(key, valueOccurrence + 1)
      hrefOccurrences.set(entry.href, hrefOccurrence + 1)
      return nextByIdentity.get(entry) ?? nextByValue.get(key)?.[valueOccurrence] ?? nextByHref.get(entry.href)?.[hrefOccurrence] ?? -1
    })
    const mapIndex = (index: number) => {
      return mappedIndices[index] ?? -1
    }
    setSelectedTocIndices(new Set([...selectedTocIndices].map(mapIndex).filter((index) => index >= 0)))
    const mappedActive = activeTocIndex === null ? null : mapIndex(activeTocIndex)
    setActiveTocIndex(mappedActive !== null && mappedActive >= 0 ? mappedActive : null)
    const anchor = lastSelectedTocIndexRef.current === null ? null : mapIndex(lastSelectedTocIndexRef.current)
    lastSelectedTocIndexRef.current = anchor !== null && anchor >= 0 ? anchor : null
    setExpandedTocIndices(new Set([...expandedTocIndices].map(mapIndex).filter((index) => index >= 0)))
  }

  function tocDropTarget({ active, over }: DragOverEvent) {
    if (!draft || !over) return null
    const activeIndex = Number(String(active.id).replace('toc-', ''))
    let index = Number(String(over.id).replace('toc-', ''))
    const indices = selectedTocIndices.has(activeIndex) ? selectedIndices : [activeIndex]
    const roots = tocSelectionRoots(draft.tocEntries, indices)
    const level = draft.tocEntries[roots[0]!]?.level
    while (draft.tocEntries[index] && level !== undefined && draft.tocEntries[index]!.level > level) {
      const parent = tocParentIndex(draft.tocEntries, index)
      if (parent === null) return null
      index = parent
    }
    const translated = active.rect.current.translated
    const placement = translated && translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2 ? 'after' : 'before'
    return canMoveTocSelection(draft.tocEntries, indices, index, placement) ? { index, placement } as const : null
  }

  function handleTocDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDropTarget(null)
    if (!draft || !over || active.id === over.id) return
    if (searchActive) {
      setNavigationMessage('搜索结果暂不可拖动；清除搜索后可按目录顺序调整。')
      return
    }
    const activeIndex = Number(String(active.id).replace('toc-', ''))
    const indices = selectedTocIndices.has(activeIndex) ? selectedIndices : [activeIndex]
    const target = tocDropTarget(event)
    if (!target) {
      setNavigationMessage('只能把目录项拖到同一父项下的同级位置；拖拽不会改变层级。')
      return
    }
    const current = flushPendingFrameEdit() ?? draft
    const nextDraft = moveEpubTocSelection(current, indices, target.index, target.placement)
    if (nextDraft === draft) {
      setNavigationMessage('拖放目标未改变目录顺序。')
      return
    }
    preserveTocState(draft, nextDraft)
    setDraft(nextDraft)
    setNavigationMessage(null)
  }

  function handleTocDragOver(event: DragOverEvent) {
    setDropTarget(tocDropTarget(event))
  }

  function syncBodyHeading() {
    if (!draft || activeTocIndex === null || !currentTocEntry || !currentDocument || headingSync.headingIndex === null || activeHref !== currentDocument.href) {
      setNavigationMessage(headingSync.reason ?? '先定位到对应正文文件后再同步标题。')
      return
    }
    const body = iframeRef.current?.contentDocument?.body
    const headings = body ? [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')] : []
    const heading = headings[headingSync.headingIndex]
    if (!body || !heading) {
      setNavigationMessage('当前正文未载入可同步的标题节点，请先重新定位该目录项。')
      return
    }
    try {
      const updated = syncEpubHeading(currentDocument, currentTocEntry, headingSync.headingIndex, body)
      update((current) => editEpubDocument(current, updated.href, updated.content))
    } catch {
      setNavigationMessage('当前正文未载入可同步的标题节点，请先重新定位该目录项。')
      return
    }
    setNavigationMessage(null)
  }

  function onFrameLoad() {
    const document = iframeRef.current?.contentDocument
    const editableDocument = activeDocumentRef.current
    if (!document?.body || !editableDocument) return
    setFrameDocument(document)
    markEpubImplicitTableBodies(document, editableDocument.content)
    applyEpubEditorTheme(document, darkTheme)
    applyEpubBackgroundContrast(document, backgroundContrast)
    document.body.contentEditable = savingRef.current || previewOnlyRef.current ? 'false' : 'true'
    document.body.setAttribute('aria-label', 'EPUB 正文编辑区')
    document.addEventListener('click', (event) => {
      if ((event.target as Element | null)?.closest('a')) event.preventDefault()
    })
    document.addEventListener('auxclick', (event) => {
      if ((event.target as Element | null)?.closest('a')) event.preventDefault()
    })
    document.addEventListener('submit', (event) => event.preventDefault())
    document.body.addEventListener('input', () => {
      if (savingRef.current || previewOnlyRef.current) return
      setPendingFrameEdit(true)
      if (frameEditTimer.current !== null) window.clearTimeout(frameEditTimer.current)
      const body = document.body!
      pendingFrameEditRef.current = { href: editableDocument.href, markup: editableDocument.content, body }
      frameEditTimer.current = window.setTimeout(() => {
        flushPendingFrameEdit()
      }, 250)
    })
    if (restoreScrollRef.current !== null) {
      const scroll = restoreScrollRef.current
      restoreScrollRef.current = null
      requestAnimationFrame(() => { if (document.scrollingElement) document.scrollingElement.scrollTop = scroll })
      return
    }
    const fragment = activeFragmentRef.current
    if (fragment) {
      const target = locateEpubFragment(document, fragment)
      if (target) target.scrollIntoView?.({ block: 'start' })
      else setNavigationMessage(`正文文件中找不到片段“${fragment}”，已定位到文件起始处。`)
    }
  }

  function handleBack() {
    navigation.back()
  }

  function switchEditorMode(nextMode: 'wysiwyg' | 'source' | 'split') {
    if (nextMode === editorMode) return
    if (editorMode === 'wysiwyg') {
      flushPendingFrameEdit()
      setSourceError(null)
      setEditorMode(nextMode)
      return
    }
    if (nextMode === 'wysiwyg') {
      if (!activeXhtmlValidation.valid) {
        setSourceError(activeXhtmlValidation.issue?.message ?? 'XHTML 语法有误，请先修复后再切换到所见即所得模式。')
        return
      }
      setSourceError(null)
      setFrameGeneration((value) => value + 1)
    }
    setEditorMode(nextMode)
  }

  async function save() {
    const baseRevisionId = sourceRevision.current
    if (savingRef.current || !draft || !baseRevisionId || !source || !dirty) return
    const currentDraft = pendingFrameEditRef.current ? flushPendingFrameEdit() : draft
    if (!currentDraft) return
    for (const doc of changedDocuments(currentDraft)) {
      const check = validateEpubXhtml(doc.content)
      if (!check.valid) {
        setActiveHref(doc.href)
        setEditorMode('source')
        setSourceError(`${doc.href} 第 ${check.issue?.line ?? 1} 行：${check.issue?.message ?? 'XHTML 语法错误，无法保存'}`)
        return
      }
    }
    setSourceError(null)
    setSaveError(false)
    savingRef.current = true
    setSaving(true)
    if (iframeRef.current?.contentDocument?.body) iframeRef.current.contentDocument.body.contentEditable = 'false'
    try {
      const result = await saveMutation.mutateAsync({
        baseRevisionId,
        documents: changedDocuments(currentDraft),
        tocEntries: currentDraft.tocEntries,
        spineOrder: currentDraft.spineOrder,
      })
      const unlocated = result.data.unlocated
      const unlocatedCount = unlocated.progress + unlocated.coverage + unlocated.highlights + unlocated.bookmarks + unlocated.notes + unlocated.pointReplacements
      if (unlocatedCount) notify.warning({ key: 'editor.savePartial', params: { count: unlocatedCount } })
      else notify.success({ key: 'editor.saveSuccess' })
      sourceRevision.current = null
      setDraft(null)
      await sourceQuery.refetch()
    } catch {
      if (iframeRef.current?.contentDocument?.body) iframeRef.current.contentDocument.body.contentEditable = previewOnlyRef.current ? 'false' : 'true'
      setSaveError(true)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function renderTocNodes(nodes: EpubTocNode[], depth = 0): ReactNode {
    return (
      <ol className="space-y-0.5" role="group">
        {nodes.map((node) => {
          const expanded = searchActive || expandedTocIndices.has(node.index)
          return (
            <li key={`${node.entry.href}:${node.index}`} role="treeitem" aria-level={depth + 1} aria-selected={selectedTocIndices.has(node.index)} aria-expanded={node.children.length ? expanded : undefined}>
              <EpubTocRow
                index={node.index}
                title={node.entry.title}
                depth={depth}
                selected={selectedTocIndices.has(node.index)}
                active={activeTocIndex === node.index}
                dropPlacement={dropTarget?.index === node.index && !(dropTarget.placement === 'after' && node.children.length > 0 && expanded) ? dropTarget.placement : null}
                expanded={expanded}
                hasChildren={node.children.length > 0}
                dragDisabled={searchActive}
                onSelect={(event) => handleTocSelect(node.index, node.entry.href, event)}
                onToggleExpanded={() =>
                  setExpandedTocIndices((current) => {
                    const next = new Set(current)
                    if (next.has(node.index)) next.delete(node.index)
                    else next.add(node.index)
                    return next
                  })
                }
              />
              {node.children.length > 0 && expanded && renderTocNodes(node.children, depth + 1)}
              {dropTarget?.index === node.index && dropTarget.placement === 'after' && node.children.length > 0 && expanded && <div className="pointer-events-none h-0.5 rounded-full bg-stone-500 dark:bg-stone-300" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    )
  }

  const syncTitleReason = activeTocIndex === null ? '先选择一个目录项。' : activeHref !== currentDocument?.href ? '先定位到该目录项对应的正文。' : headingSync.reason

  const diffSummary = useMemo(() => draft ? getEpubEditorDiff(draft, false) : null, [draft])
  const totalModifications = (diffSummary?.changeCount ?? 0) + (pendingFrameEdit && !diffSummary?.documents.some((document) => document.href === activeHref) ? 1 : 0)

  if (!draft && (sourceQuery.isError || (!source && !sourceQuery.isPending))) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-red-600 dark:text-red-400">EPUB 内容读取失败，请返回后重试。</main>
  }
  if (access === 'error') return <main className="p-8 text-red-600">无法确认当前内容或编辑权限，请返回后重试。本地草稿已保留。</main>
  if (sourceQuery.isPending || !draft) {
    return <ContentEditorPending stage="content" />
  }
  if (access === 'pending' || (!localDraft.ready && !localDraft.candidate)) return <main className="p-8">正在检查本地草稿…</main>
  if (localDraft.candidate) return <LocalDraftRecovery record={localDraft.candidate} revisionId={sourceRevision.current!}
    text={[localDraft.candidate.payload.tocEntries.map((item) => `${item.title} (${item.href})`).join('\n'), ...localDraft.candidate.payload.documents.map((item) => `${item.href}\n\n${item.content}`)].join('\n\n')}
    onRestore={localDraft.restore} onDiscard={localDraft.discard} failure={localDraft.failure} />

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-stone-100/60 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <ContentEditorHeader
        title={book.title}
        format="epub"
        bookId={book.id}
        dirty={dirty}
        changeCount={totalModifications}
        localStatus={localDraft.failure ? 'failed' : localDraft.status === 'saved' && !pendingFrameEdit ? 'saved' : 'pending'}
        saving={saving || saveMutation.isPending}
        canUndo={draft.undoStack.length > 0}
        canRedo={draft.redoStack.length > 0}
        onUndo={() => {
          update(undoEpubEditorDraft)
          setFrameGeneration((value) => value + 1)
        }}
        onRedo={() => {
          update(redoEpubEditorDraft)
          setFrameGeneration((value) => value + 1)
        }}
        onSave={() => void save()}
        onDiscard={() => setDiscardConfirm(true)}
        onOpenDiff={() => { flushPendingFrameEdit(); setShowDiff(true) }}
        onBack={handleBack}
      />

      {localDraft.failure && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{localDraft.failure}</div>}
      {saveError && !sourceConflict && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{_('editor.saveFailed')}</div>}
      {sourceConflict && (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          {_('editor.saveConflict')}
        </div>
      )}
      <fieldset disabled={saving || saveMutation.isPending} className="contents">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Left Column: TOC Directory & Hierarchy */}
          <aside className="flex min-h-0 flex-col overflow-hidden border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 md:border-b-0 md:border-r">
            {view === 'toc' && (searchOpen || tocSearch) ? (
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-stone-200 px-3 dark:border-stone-800">
                <svg className="h-4 w-4 shrink-0 text-stone-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  autoFocus
                  aria-label="搜索目录标题"
                  value={tocSearch}
                  onChange={(event) => setTocSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      if (tocSearch) setTocSearch('')
                      else setSearchOpen(false)
                    }
                  }}
                  placeholder="搜索目录标题…"
                  className="min-w-0 flex-1 bg-transparent text-xs text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-100"
                />
                {tocSearch && (
                  <button
                    type="button"
                    onClick={() => setTocSearch('')}
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
                    setTocSearch('')
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
            ) : view === 'toc' && selectedIndices.length > 1 ? (
              <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-stone-200 px-3 dark:border-stone-800">
                <span className="rounded-full bg-stone-900 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900">已选 {selectedIndices.length} 项</span>
                <button type="button" onClick={() => setSelectedTocIndices(new Set(activeTocIndex === null ? [] : [activeTocIndex]))} className="text-xs text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100">取消选择</button>
              </div>
            ) : (
              <div className="flex h-11 shrink-0 items-stretch justify-between gap-2 border-b border-stone-200 px-3 dark:border-stone-800">
                <div role="group" aria-label="EPUB 视图" className="flex items-stretch gap-4">
                  {(['toc', 'files'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-label={item === 'toc' ? '目录' : '文件'}
                      aria-pressed={view === item}
                      onClick={() => switchView(item)}
                      className={cn(
                        '-mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 text-xs transition-colors',
                        view === item
                          ? 'border-stone-900 font-semibold text-stone-900 dark:border-stone-100 dark:text-stone-100'
                          : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                      )}
                    >
                      <span>{item === 'toc' ? '目录' : '文件'}</span>
                      {item === 'toc' && (
                        <span aria-hidden="true" className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] leading-none tabular-nums text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                          {draft.tocEntries.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-0.5 self-center">
                  {view === 'toc' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(true)
                        setTimeout(() => searchInputRef.current?.focus(), 50)
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200"
                      title="搜索目录"
                      aria-label="搜索目录"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (view === 'toc') {
                        const allParents = setOfIndices(parentIndices(tocTree))
                        const allExpanded = allParents.size > 0 && [...allParents].every((idx) => expandedTocIndices.has(idx))
                        setExpandedTocIndices(allExpanded ? new Set() : allParents)
                      } else {
                        const allCollapsed = allFileDirs.length > 0 && allFileDirs.every((dir) => collapsedFileDirs.has(dir))
                        setCollapsedFileDirs(allCollapsed || collapsedFileDirs.size > 0 ? new Set() : new Set(allFileDirs))
                      }
                    }}
                    className="h-7 px-2 text-[11px] text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                    title={
                      view === 'toc'
                        ? (expandedTocIndices.size > 0 ? '全部折叠' : '全部展开')
                        : (collapsedFileDirs.size > 0 ? '全部展开' : '全部折叠')
                    }
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {(view === 'toc' ? expandedTocIndices.size > 0 : collapsedFileDirs.size === 0)
                        ? <><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></>
                        : <><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></>}
                    </svg>
                  </Button>
                </div>
              </div>
            )}
            <div className={view === 'toc' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>

            {/* Tree View */}
            <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
              {draft.tocEntries.length > 0 ? (
                <div role="tree" aria-label="书内目录">
                  {view === 'toc' && <DndContext sensors={tocSensors} collisionDetection={closestCenter} onDragMove={handleTocDragOver} onDragOver={handleTocDragOver} onDragCancel={() => setDropTarget(null)} onDragEnd={handleTocDragEnd}>
                    <SortableContext items={tocDndIndices.map((index) => `toc-${index}`)} strategy={verticalListSortingStrategy}>
                      {renderTocNodes(filteredTocTree)}
                    </SortableContext>
                  </DndContext>}
                  {filteredTocTree.length === 0 && <p className="p-3 text-xs text-stone-400">没有匹配的目录标题。</p>}
                </div>
              ) : (
                <p className="p-3 text-xs text-stone-400">此 EPUB 没有可用目录项。</p>
              )}

            </div>
            </div>
            <div className={view === 'files' ? 'min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar' : 'hidden'}>
              {view === 'files' && (
                <EpubFileTree
                  entries={archiveEntries}
                  spineOrder={draft.spineOrder}
                  activeHref={activeHref}
                  changedHrefs={changedDocHrefs}
                  collapsedDirs={collapsedFileDirs}
                  onToggleDir={(dirPath) => {
                    setCollapsedFileDirs((prev) => {
                      const next = new Set(prev)
                      if (next.has(dirPath)) next.delete(dirPath)
                      else next.add(dirPath)
                      return next
                    })
                  }}
                  onSelect={(href) => {
                    restoreScrollRef.current = null
                    navigateTo(href)
                  }}
                />
              )}
            </div>

          </aside>

          {/* Middle Column: Sandboxed iframe Text Editor */}
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white dark:bg-stone-900">
            <div className="mx-4 mt-3 flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 pb-2.5 sm:mx-6 sm:mt-4 dark:border-stone-800">
              {view === 'toc' ? (
                <input
                  aria-label={`目录标题 ${(activeTocIndex ?? 0) + 1}`}
                  disabled={activeTocIndex === null}
                  value={currentTocEntry?.title ?? ''}
                  onChange={(event) => activeTocIndex !== null && update((current) => editEpubTocEntry(current, activeTocIndex, { title: event.target.value }))}
                  placeholder={activeHref?.split('/').at(-1) || '选择目录项以编辑标题'}
                  className="min-w-0 flex-1 bg-transparent text-lg font-bold tracking-tight text-stone-900 outline-none placeholder:text-stone-400 disabled:cursor-default dark:text-stone-100 sm:text-xl"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-600 dark:text-stone-300">
                  {activeHref?.split('/').at(-1) || ''}
                </span>
              )}

              <div className="flex shrink-0 items-center gap-1.5">
                {editableDocument && (
                  <div role="group" aria-label="编辑模式" className="flex items-center gap-0.5 rounded-md bg-stone-100 p-0.5 dark:bg-stone-800">
                    {([
                      ['wysiwyg', '预览'],
                      ['source', '源码'],
                      ['split', '分栏'],
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={editorMode === mode}
                        onClick={() => switchEditorMode(mode)}
                        className={cn(
                          'rounded px-2 py-0.5 text-[11px] transition-colors',
                          editorMode === mode
                            ? 'bg-white font-medium text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                            : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {previewOnly && activeHref && (
                  <span
                    role="status"
                    title={previewContent || previewIsCodeText ? '此文件不可在工作台直接编辑，仅供预览。' : undefined}
                    className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                  >
                    {previewContent || (previewIsCodeText && previewQuery.data !== undefined)
                      ? '只读预览'
                      : previewQuery.isPending && (previewIsText || previewIsCodeText)
                        ? '加载预览…'
                        : '无可显示内容'}
                  </span>
                )}
                {view === 'toc' && !syncTitleReason && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={syncBodyHeading}
                    className="h-7 px-2.5 text-xs"
                  >
                    同步正文标题
                  </Button>
                )}
                {(resourceWarning || manifestQuery.isError) && (
                  <span
                    role="status"
                    title="部分图片或样式无法显示，原始引用会保留。"
                    aria-label="部分图片或样式无法显示，原始引用会保留。"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-amber-600 dark:text-amber-400"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  </span>
                )}
                <button
                  type="button"
                  aria-pressed={originalStyles}
                  aria-label={originalStyles ? '原书样式：开' : '原书样式：关'}
                  title={originalStyles ? '原书样式：开（点击切换为简洁白底编辑，保存仍保留原样式）' : '原书样式：关（当前为简洁编辑模式，保存仍保留原样式）'}
                  onClick={() => setOriginalStyles((value) => !value)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                    originalStyles
                      ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                      : 'border-stone-200 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-pressed={backgroundContrast}
                  aria-label={backgroundContrast ? '增强背景文字：开' : '增强背景文字：关'}
                  title={backgroundContrast ? '增强背景文字：开（深色背景时提高文字可读性）' : '增强背景文字：关（深色背景时提高文字可读性）'}
                  onClick={() => setBackgroundContrast((value) => !value)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                    backgroundContrast
                      ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                      : 'border-stone-200 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 3v18" />
                    <path d="M12 8l4-2.5" />
                    <path d="M12 12l5-3" />
                    <path d="M12 16l4-2.5" />
                  </svg>
                </button>
                {view === 'toc' && currentTocEntry && (
                  <span
                    title={`定位：${currentTocEntry.href}`}
                    aria-label={`定位：${currentTocEntry.href}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                  </span>
                )}
              </div>
            </div>

            {(navigationMessage || sourceError) && (
              <div className="mx-4 mt-2 shrink-0 space-y-1 text-xs sm:mx-6">
                {sourceError && <p role="alert" className="text-red-600 dark:text-red-400">{sourceError}</p>}
                {navigationMessage && <p role="status" className="text-amber-700 dark:text-amber-400">{navigationMessage}</p>}
              </div>
            )}

            {editableDocument && editorMode === 'source' ? (
              <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
                <CodeEditor
                  ariaLabel="EPUB 源码编辑区"
                  language="xhtml"
                  value={editableDocument.content}
                  onChange={(next) => {
                    setSourceError(null)
                    update((current) => editEpubDocument(current, editableDocument.href, next))
                  }}
                  issues={activeXhtmlValidation.issue ? [activeXhtmlValidation.issue] : []}
                  minHeight="0"
                  className="min-h-0 flex-1"
                />
              </div>
            ) : editableDocument && editorMode === 'split' ? (
              <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-stone-200 dark:divide-stone-800 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                <div className="flex min-h-0 flex-col p-3">
                  <CodeEditor
                    ariaLabel="EPUB 源码编辑区"
                    language="xhtml"
                    value={editableDocument.content}
                    onChange={(next) => {
                      setSourceError(null)
                      update((current) => editEpubDocument(current, editableDocument.href, next))
                    }}
                    issues={activeXhtmlValidation.issue ? [activeXhtmlValidation.issue] : []}
                    minHeight="0"
                    className="min-h-0 flex-1"
                  />
                </div>
                <iframe
                  ref={splitIframeRef}
                  key={activeHref ? `split:${activeHref}` : 'split:none'}
                  srcDoc={splitInitial?.srcDoc}
                  title="EPUB 源码实时预览"
                  sandbox="allow-same-origin"
                  onLoad={() => {
                    const doc = splitIframeRef.current?.contentDocument
                    if (doc) setSplitFrameDocument(doc)
                  }}
                  className="min-h-0 h-full w-full border-0 bg-white dark:bg-stone-900"
                />
              </div>
            ) : previewIsCodeText && activeHref ? (
              previewQuery.isPending ? (
                <div className="m-auto text-sm text-stone-400">正在加载源码…</div>
              ) : previewQuery.data !== undefined ? (
                <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
                  <CodeEditor
                    ariaLabel="EPUB 只读源码区"
                    language={/\.css$/i.test(activeHref) ? 'css' : 'xml'}
                    value={previewQuery.data}
                    onChange={() => {}}
                    readOnly
                    minHeight="0"
                    className="min-h-0 flex-1"
                  />
                </div>
              ) : (
                <div className="m-auto text-sm text-stone-400">无法读取此文件内容。</div>
              )
            ) : activeHref && activeDocument ? (
              <iframe
                ref={iframeRef}
                key={iframeContent.key}
                srcDoc={iframeContent.srcDoc}
                title="EPUB 正文编辑区"
                sandbox="allow-same-origin"
                onLoad={onFrameLoad}
                className="min-h-0 w-full flex-1 border-0 bg-white dark:bg-stone-900"
              />
            ) : (
              <div className="m-auto text-sm text-stone-400">{activeHref ? '无法打开此目录项。' : '没有可编辑的正文文件。'}</div>
            )}
          </section>

        </div>

        {showDiff && <EpubEditorDiffModal draft={draft} saving={saving || saveMutation.isPending} onClose={() => setShowDiff(false)} onSave={() => { setShowDiff(false); void save() }} onDiscard={() => { setShowDiff(false); setDiscardConfirm(true) }} />}

        {/* Leave Draft Confirm Dialog */}
        {navigation.blocked && <LeaveEditorDialog saving={saving || saveMutation.isPending}
          preserve={() => {
            const current = flushPendingFrameEdit() ?? draft
            return localDraft.flush({ documents: changedDocuments(current), tocEntries: current.tocEntries, spineOrder: current.spineOrder, view, activeHref, activeTocIndex })
          }}
          discard={() => localDraft.clear()} onLeave={() => navigation.proceed?.()} onClose={() => navigation.reset?.()} />}

        {/* Discard Confirm Dialog */}
        {discardConfirm && (
          <ConfirmDialog
            title={_('editor.discardConfirmTitle') || '放弃草稿'}
            message={_('editor.discardConfirmMessage') || '未保存的修改将会丢失，确定放弃吗？'}
            confirmLabel={_('editor.discard') || '放弃草稿'}
            confirmVariant="danger"
            onConfirm={async () => {
              await localDraft.clear()
              if (frameEditTimer.current !== null) window.clearTimeout(frameEditTimer.current)
              frameEditTimer.current = null
              pendingFrameEditRef.current = null
              setPendingFrameEdit(false)
              setDraft(createEpubEditorDraft(draft.baseline))
              setFrameGeneration((value) => value + 1)
              setDiscardConfirm(false)
            }}
            onClose={() => setDiscardConfirm(false)}
          />
        )}
      </fieldset>
    </main>
  )
}
