import { useMemo, useRef, useState, type ReactNode } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { HighlightRuleDef } from '@bookdock/shared'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Spinner from '@/components/ui/Spinner'
import { localRecordId } from '@/features/local-library/id'
import { useThemeAssetUrls } from '@/features/reading-theme/asset-urls'
import { ThemeAssetStore } from '@/features/reading-theme/assets'
import PaletteChip from '@/features/reading-theme/PaletteChip'
import SelectChip from '@/features/reading-theme/SelectChip'
import ThemeCombinationDialog from '@/features/reading-theme/ThemeCombinationDialog'
import ThemeEditorDialog, { type ThemeCardEdit } from '@/features/reading-theme/ThemeEditorDialog'
import { publishThemeDeleteUndo } from '@/features/reading-theme/theme-delete-undo'
import {
  buildThemeLibraryPackage,
  importThemePackage,
  themeLibraryPackageFileName,
  ThemePackageError,
  type ThemePackageSelection,
} from '@/features/reading-theme/theme-package'
import {
  mergeThemeBundle,
  normalizeThemeCards,
  removeThemeCard,
  themeLibraryNames,
  uniqueName,
  upsertThemeCard,
  type ReadingThemeLibrary,
  type SavedReadingTheme,
  type ThemeBundleCounts,
  type ThemeCssCard,
  type ThemePalette,
} from '@/features/reading-theme/theme-library'
import { useTranslation } from '@/hooks/useTranslation'
import { downloadBlob } from '@/lib/download'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'
import { getThemeLibrarySnapshot, useUiStore } from '@/stores/ui.store'

import EditModeButton from './EditModeButton'
import RuleSelectAllBar from './RuleSelectAllBar'
import RuleSelectionActions from './RuleSelectionActions'
import SettingsCard from './SettingsCard'
import { ExportIcon, ImportIcon, PlusIcon } from './row-icons'

type Group = 'theme' | 'palette' | 'css' | 'highlight'

const GROUPS: Group[] = ['theme', 'palette', 'css', 'highlight']
/** The four seeded pairs; they are the starting point, never bulk-selectable. */
const BUILTIN_IDS = new Set(['paper', 'cream', 'sepia', 'night'])

const iconButton =
  'flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200'

const LIST_KEY: Record<Group, 'themes' | 'palettes' | 'css' | 'highlights'> = {
  theme: 'themes', palette: 'palettes', css: 'css', highlight: 'highlights',
}

function PaletteIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 0 18h1.4a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.2H18c2 0 3-1.4 3-3.1A9 9 0 0 0 12 3Z" />
      <path d="M7 12h.01M9 8h.01M14 7h.01M17 10h.01" strokeWidth="2.5" />
    </svg>
  )
}

function Region({ label, count, addLabel, onAdd, editing, children }: {
  label: string
  count: number
  addLabel: string
  onAdd: () => void
  editing: boolean
  children: ReactNode
}) {
  return (
    <section aria-label={label} className="grid gap-1.5 border-b border-stone-200/60 pb-3 last:border-b-0 last:pb-0 dark:border-stone-800/60">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-stone-600 dark:text-stone-300">
          {label}
          {count > 0 && <span className="ml-1.5 font-normal tabular-nums text-stone-400 dark:text-stone-500">· {count}</span>}
        </span>
        {!editing && (
          <button type="button" aria-label={addLabel} title={addLabel} className={iconButton} onClick={onAdd}>
            <PlusIcon size={15} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * One draggable slot in a region. In edit mode the whole chip is the drag
 * handle — pointer movement under 5px still reads as the click that toggles
 * the selection, so a second grip control would only cost width.
 */
function SortableItem({ id, editing, children }: { id: string; editing: boolean; children: ReactNode }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, animateLayoutChanges: () => false })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`min-w-0 ${editing ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${isDragging ? 'relative z-10 opacity-60' : ''}`}
      {...(editing ? listeners : {})}
    >
      {children}
    </div>
  )
}

export default function ReadingThemesSettingsSection() {
  const _ = useTranslation()
  const library = useUiStore((state) => state.themeLibrary)
  const setLibrary = useUiStore((state) => state.setThemeLibrary)
  const scope = useAuthStore((state) => state.user?.id ?? 'device')

  const [editing, setEditing] = useState(false)
  const [selection, setSelection] = useState<Record<Group, string[]>>({ theme: [], palette: [], css: [], highlight: [] })
  const [themeEditor, setThemeEditor] = useState<{ theme: SavedReadingTheme; existing: boolean } | null>(null)
  const [cardEditor, setCardEditor] = useState<{ edit: ThemeCardEdit; onCreated?: (id: string) => void } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Array<{ group: Group; id: string; name: string }> | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const paletteAssetIds = useMemo(
    () => library.palettes.flatMap((item) => item.wallpaperAssetId ? [item.wallpaperAssetId] : []),
    [library.palettes],
  )
  const { urls: wallpapers, missing: missingWallpapers } = useThemeAssetUrls(scope, paletteAssetIds)

  const selectable: Record<Group, string[]> = {
    theme: library.themes.filter((theme) => !BUILTIN_IDS.has(theme.id)).map((theme) => theme.id),
    palette: library.palettes.filter((palette) => !BUILTIN_IDS.has(palette.id)).map((palette) => palette.id),
    css: library.css.map((card) => card.id),
    highlight: library.highlights.map((rule) => rule.id),
  }
  const selectablePairs = GROUPS.flatMap((group) => selectable[group].map((id) => [group, id] as const))
  const selectedTotal = GROUPS.reduce((total, group) => total + selection[group].length, 0)
  const allSelected = selectablePairs.length > 0 && selectablePairs.every(([group, id]) => selection[group].includes(id))
  const isChecked = (group: Group, id: string) => editing && selection[group].includes(id)

  const toggleSelected = (group: Group, id: string) => {
    setSelection((current) => ({
      ...current,
      [group]: current[group].includes(id) ? current[group].filter((entry) => entry !== id) : [...current[group], id],
    }))
  }
  const clearSelection = () => setSelection({ theme: [], palette: [], css: [], highlight: [] })

  const selectionOf = (groups: Group[] = GROUPS): ThemePackageSelection => {
    const pick = <T extends { id: string }>(items: T[], group: Group) => items.filter((item) => selection[group].includes(item.id))
    return {
      themes: groups.includes('theme') ? pick(library.themes, 'theme') : [],
      palettes: groups.includes('palette') ? pick(library.palettes, 'palette') : [],
      css: groups.includes('css') ? pick(library.css, 'css') : [],
      highlights: groups.includes('highlight') ? pick(library.highlights, 'highlight') : [],
    }
  }
  const everything = (): ThemePackageSelection => ({
    themes: library.themes.filter((theme) => !BUILTIN_IDS.has(theme.id)),
    palettes: library.palettes.filter((palette) => !BUILTIN_IDS.has(palette.id)),
    css: library.css,
    highlights: library.highlights,
  })
  const countOf = (selection: ThemePackageSelection) =>
    selection.themes.length + selection.palettes.length + selection.css.length + selection.highlights.length
  const totalOf = (counts: ThemeBundleCounts) => counts.themes + counts.palettes + counts.css + counts.highlights

  const exportItems = (targets: ThemePackageSelection) => {
    const count = countOf(targets)
    if (!count || exporting) return
    setExporting(true)
    void (async () => {
      try {
        const { blob, missing } = await buildThemeLibraryPackage(targets, useUiStore.getState().themeLibrary, new ThemeAssetStore(), scope)
        if (!blob) {
          notify.error({ key: 'reader.themeExportMissing', params: { count: missing.length } })
          return
        }
        if (scope !== (useAuthStore.getState().user?.id ?? 'device')) return
        downloadBlob(themeLibraryPackageFileName(targets), blob)
        notify.success({ key: 'reader.themeExportDone', params: { count } })
      } catch {
        notify.error({ key: 'reader.themeExportFailed' })
      } finally {
        setExporting(false)
      }
    })()
  }

  const importFile = async (file?: File) => {
    if (!file || importing) return
    setImporting(true)
    try {
      const bundle = await importThemePackage(file, new ThemeAssetStore(), scope)
      if (scope !== (useAuthStore.getState().user?.id ?? 'device')) return
      const state = useUiStore.getState()
      const result = mergeThemeBundle(state.themeLibrary, bundle)
      state.setThemeLibrary(result.library)
      const added = totalOf(result.added)
      const merged = totalOf(result.merged)
      if (added > 0 && merged > 0) notify.success({ key: 'reader.themeImportMerged', params: { added, merged } })
      else if (added > 0) notify.success({ key: 'reader.themeImportDone', params: { count: added } })
      else notify.info({ key: 'reader.themeImportNothing' })
    } catch (error) {
      const category = error instanceof ThemePackageError ? error.category : undefined
      const reason = category === 'version' ? 'reader.themeImportBadVersion'
        : category === 'too-large' ? 'reader.themeImportTooLarge'
        : category === 'too-many-entries' ? 'reader.themeImportTooManyEntries'
        : category === 'asset-missing' || category === 'unresolved-reference' ? 'reader.themeImportMissingAsset'
        : category === 'asset-invalid' ? 'reader.themeImportBadAsset' : 'reader.themeImportInvalid'
      notify.error({ key: 'reader.themeImportFailed', params: { reason: _(reason) } })
    } finally {
      setImporting(false)
    }
  }

  const toggleEditing = () => {
    clearSelection()
    setEditing((current) => !current)
  }

  const saveCard = (edit: ThemeCardEdit) => {
    if (!edit.card) return
    const current = useUiStore.getState().themeLibrary
    let next: ReadingThemeLibrary
    if (edit.kind === 'palette') next = { ...current, palettes: upsertThemeCard(current.palettes, edit.card) }
    else if (edit.kind === 'css') next = { ...current, css: upsertThemeCard(current.css, edit.card) }
    else next = { ...current, highlights: upsertThemeCard(current.highlights, edit.card) }
    setLibrary(next)
    cardEditor?.onCreated?.(edit.card.id)
    setCardEditor(null)
  }

  const deleteCard = (edit: ThemeCardEdit) => {
    const card = edit.card
    if (!card) return
    const before = getThemeLibrarySnapshot()
    const { library: next, affected } = removeThemeCard(before.library, edit.kind, card.id)
    setLibrary(next)
    publishThemeDeleteUndo(
      before,
      affected > 0
        ? { key: 'reader.themeCardDeletedAffected', params: { name: card.name, count: affected } }
        : { key: 'reader.themeCardDeleted', params: { name: card.name } },
    )
    setCardEditor(null)
  }

  const deleteTheme = (theme: SavedReadingTheme) => {
    const state = useUiStore.getState()
    const before = getThemeLibrarySnapshot()
    const inUse = theme.id === state.readingThemeId || theme.id === state.lightReadingThemeId || theme.id === state.darkReadingThemeId
    state.deleteCustomTheme(theme.id)
    publishThemeDeleteUndo(
      before,
      { key: inUse ? 'reader.themeDeletedInUse' : 'reader.themeDeleted', params: { name: theme.name } },
    )
    setThemeEditor(null)
  }

  const requestDelete = () => {
    const items: Array<{ group: Group; id: string; name: string }> = []
    for (const group of GROUPS) {
      const source = group === 'theme' ? library.themes : group === 'palette' ? library.palettes : group === 'css' ? library.css : library.highlights
      for (const item of source) if (selection[group].includes(item.id)) items.push({ group, id: item.id, name: item.name })
    }
    if (items.length) setPendingDelete(items)
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const before = getThemeLibrarySnapshot()
    // Card deletes first: every theme that referenced one gets re-pointed, and
    // a theme delete afterwards works on the already-settled library.
    let next = before.library
    for (const item of pendingDelete) {
      if (item.group === 'theme') continue
      next = removeThemeCard(next, item.group, item.id).library
    }
    useUiStore.getState().setThemeLibrary(next)
    for (const item of pendingDelete) if (item.group === 'theme') useUiStore.getState().deleteCustomTheme(item.id)
    const count = pendingDelete.length
    setPendingDelete(null)
    clearSelection()
    publishThemeDeleteUndo(
      before,
      { key: 'reader.themeBulkDeleted', params: { count } },
    )
  }

  const reorder = (group: Group, activeId: string, overId: string) => {
    const current = useUiStore.getState().themeLibrary
    const items = current[LIST_KEY[group]] as Array<{ id: string }>
    const from = items.findIndex((item) => item.id === activeId)
    const to = items.findIndex((item) => item.id === overId)
    if (from < 0 || to < 0) return
    const moved = arrayMove(items, from, to)
    setLibrary({ ...current, [LIST_KEY[group]]: moved } as ReadingThemeLibrary)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!editing || !over || active.id === over.id) return
    const [activeGroup, activeId] = String(active.id).split(':')
    const [overGroup, overId] = String(over.id).split(':')
    if (activeGroup !== overGroup || !activeGroup || !activeId || !overId) return
    reorder(activeGroup as Group, activeId, overId)
  }

  const saveTheme = (theme: SavedReadingTheme) => {
    const current = useUiStore.getState().themeLibrary
    setLibrary({ ...current, themes: upsertThemeCard(current.themes, { ...theme, cards: normalizeThemeCards(current, theme.cards) }) })
    setThemeEditor(null)
  }

  const copyCard = (kind: ThemeCardEdit['kind'], card: ThemeCardEdit['card']) => {
    if (!card) return
    const current = useUiStore.getState().themeLibrary
    if (kind === 'palette') {
      saveCard({ kind, card: { ...(card as ThemePalette), id: localRecordId(), name: uniqueName(card.name, themeLibraryNames(current, 'palette')) } })
    } else if (kind === 'css') {
      saveCard({ kind, card: { ...(card as ThemeCssCard), id: localRecordId(), name: uniqueName(card.name, themeLibraryNames(current, 'css')) } })
    } else {
      saveCard({ kind, card: { ...(card as HighlightRuleDef), id: localRecordId(), name: uniqueName(card.name, themeLibraryNames(current, 'highlight'), 50) } })
    }
  }

  const groupAction = (group: Group) => {
    if (group === 'theme') setThemeEditor({ existing: false, theme: { id: localRecordId(), name: '', cards: { paletteId: library.palettes[0]?.id ?? 'paper', cssId: null, highlightIds: [] } } })
    else setCardEditor({ edit: { kind: group } })
  }

  const chips = (group: Group, items: Array<{ id: string; name: string }>, onEdit: (id: string) => void, options?: { selectable?: (id: string) => boolean }) => items.map((item) => {
    const selectableItem = options?.selectable ? options.selectable(item.id) : true
    return (
      <SortableItem key={item.id} id={`${group}:${item.id}`} editing={editing}>
        <SelectChip
          title={item.name}
          selected={isChecked(group, item.id) ? true : undefined}
          onClick={() => {
            if (!editing) { onEdit(item.id); return }
            if (selectableItem) toggleSelected(group, item.id)
          }}
        >
          {item.name}
        </SelectChip>
      </SortableItem>
    )
  })

  return (
    <>
      <SettingsCard
        icon={<PaletteIcon />}
        iconBgClass="bg-fuchsia-500/10 text-fuchsia-600 dark:bg-fuchsia-500/20 dark:text-fuchsia-400"
        title={
          <span className="flex items-baseline gap-1.5">
            <span>{_('reader.sectionTheme')}</span>
            {library.themes.length > 0 && (
              <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {library.themes.length}</span>
            )}
          </span>
        }
        action={
          <div className="flex shrink-0 items-center gap-1">
            {editing && (
              <RuleSelectionActions
                disabled={exporting || importing}
                exporting={exporting}
                selectedCount={selectedTotal}
                onExport={() => exportItems(selectionOf())}
                onDelete={requestDelete}
              />
            )}
            {!editing && (
              <>
                <button
                  type="button"
                  disabled={importing}
                  aria-busy={importing}
                  onClick={() => input.current?.click()}
                  className={iconButton}
                  aria-label={_('reader.themeImport')}
                  title={_('reader.themeImport')}
                >
                  {importing ? <Spinner size="xs" /> : <ImportIcon />}
                </button>
                <button
                  type="button"
                  disabled={exporting || importing || countOf(everything()) === 0}
                  aria-busy={exporting}
                  onClick={() => exportItems(everything())}
                  className={iconButton}
                  aria-label={_('reader.themeExportAll')}
                  title={_('reader.themeExportAll')}
                >
                  {exporting ? <Spinner size="xs" /> : <ExportIcon />}
                </button>
              </>
            )}
            <EditModeButton active={editing} disabled={exporting || importing} onClick={toggleEditing} />
          </div>
        }
        bodyClassName="pt-3"
      >
        <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void importFile(file)
        }} />

        {editing && (
          <RuleSelectAllBar
            disabled={selectablePairs.length === 0}
            allSelected={allSelected}
            indeterminate={selectedTotal > 0 && !allSelected}
            selectedCount={selectedTotal}
            label={_('reader.themeSelectAll')}
            countLabel={_('reader.themeSelectedCount', { count: selectedTotal })}
            onToggleAll={(checked) => setSelection(checked
              ? { theme: selectable.theme, palette: selectable.palette, css: selectable.css, highlight: selectable.highlight }
              : { theme: [], palette: [], css: [], highlight: [] })}
          />
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="grid gap-2.5">
            <Region
              label={_('reader.themeSavedLabel')}
              count={library.themes.length}
              addLabel={_('reader.newTheme')}
              onAdd={() => groupAction('theme')}
              editing={editing}
            >
              <SortableContext items={library.themes.map((theme) => `theme:${theme.id}`)} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap gap-1.5">
                  {library.themes.length === 0
                    ? <span className="text-xs text-stone-400 dark:text-stone-500">{_('reader.readingThemesEmpty')}</span>
                    : chips('theme', library.themes, (id) => {
                        const theme = library.themes.find((item) => item.id === id)
                        if (theme) setThemeEditor({ theme, existing: true })
                      }, { selectable: (id) => !BUILTIN_IDS.has(id) })}
                </div>
              </SortableContext>
            </Region>

            <Region
              label={_('reader.themePaletteLabel')}
              count={library.palettes.length}
              addLabel={_('reader.themeNewPalette')}
              onAdd={() => groupAction('palette')}
              editing={editing}
            >
              <SortableContext items={library.palettes.map((palette) => `palette:${palette.id}`)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-2 gap-1.5">
                  {library.palettes.map((palette) => {
                    const selectableItem = !BUILTIN_IDS.has(palette.id)
                    return (
                      <SortableItem key={palette.id} id={`palette:${palette.id}`} editing={editing}>
                        <PaletteChip
                          name={palette.name}
                          colors={palette.colors}
                          hasWallpaper={Boolean(palette.wallpaperAssetId)}
                          wallpaperUrl={palette.wallpaperAssetId ? wallpapers[palette.wallpaperAssetId] : undefined}
                          wallpaperPending={Boolean(palette.wallpaperAssetId) && !wallpapers[palette.wallpaperAssetId!] && !missingWallpapers.includes(palette.wallpaperAssetId!)}
                          wallpaperLabel={_('reader.themeWallpaper')}
                          selected={isChecked('palette', palette.id) ? true : undefined}
                          onClick={() => {
                            if (!editing) { setCardEditor({ edit: { kind: 'palette', card: palette } }); return }
                            if (selectableItem) toggleSelected('palette', palette.id)
                          }}
                        />
                      </SortableItem>
                    )
                  })}
                </div>
              </SortableContext>
            </Region>

            <Region
              label={_('reader.themeCssLabel')}
              count={library.css.length}
              addLabel={_('reader.themeNewCss')}
              onAdd={() => groupAction('css')}
              editing={editing}
            >
              <SortableContext items={library.css.map((card) => `css:${card.id}`)} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap gap-1.5">
                  {library.css.length === 0
                    ? <span className="text-xs text-stone-400 dark:text-stone-500">{_('reader.themeCssEmpty')}</span>
                    : chips('css', library.css, (id) => {
                        const card = library.css.find((item) => item.id === id)
                        if (card) setCardEditor({ edit: { kind: 'css', card } })
                      })}
                </div>
              </SortableContext>
            </Region>

            <Region
              label={_('reader.themeHighlightRulesTitle')}
              count={library.highlights.length}
              addLabel={_('reader.themeNewHighlight')}
              onAdd={() => groupAction('highlight')}
              editing={editing}
            >
              <SortableContext items={library.highlights.map((rule) => `highlight:${rule.id}`)} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap gap-1.5">
                  {library.highlights.length === 0
                    ? <span className="text-xs text-stone-400 dark:text-stone-500">{_('reader.themeHighlightEmpty')}</span>
                    : chips('highlight', library.highlights, (id) => {
                        const card = library.highlights.find((item) => item.id === id)
                        if (card) setCardEditor({ edit: { kind: 'highlight', card } })
                      })}
                </div>
              </SortableContext>
            </Region>
          </div>
        </DndContext>
      </SettingsCard>

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={<>
            <p>{_('reader.themeBulkDeleteConfirm', { count: pendingDelete.length })}</p>
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto break-words pl-4">
              {pendingDelete.map((item) => <li key={`${item.group}:${item.id}`}>{item.name}</li>)}
            </ul>
          </>}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {themeEditor && (
        <ThemeCombinationDialog
          key={themeEditor.theme.id}
          initial={themeEditor.theme}
          existing={themeEditor.existing}
          library={library}
          variant="default"
          onClose={() => setThemeEditor(null)}
          onSave={saveTheme}
          onCreateCard={(kind, onCreated) => setCardEditor({ edit: { kind }, onCreated })}
          onEditCard={(edit) => setCardEditor({ edit })}
          onCopyCard={copyCard}
          onCopy={(draft) => setThemeEditor({ existing: false, theme: { ...draft, id: localRecordId(), name: uniqueName(draft.name, themeLibraryNames(library, 'theme')) } })}
          onDelete={themeEditor.existing ? () => deleteTheme(themeEditor.theme) : undefined}
          onExport={themeEditor.existing ? () => exportItems({ themes: [themeEditor.theme], palettes: [], css: [], highlights: [] }) : undefined}
        />
      )}

      {cardEditor && (
        <ThemeEditorDialog
          key={`${cardEditor.edit.kind}:${cardEditor.edit.card?.id ?? 'new'}`}
          editor={cardEditor.edit}
          variant="default"
          onClose={() => setCardEditor(null)}
          onSave={saveCard}
          onDelete={cardEditor.edit.card ? () => deleteCard(cardEditor!.edit) : undefined}
        />
      )}
    </>
  )
}
