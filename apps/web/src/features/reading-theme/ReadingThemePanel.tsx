import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { HighlightRuleDef, ReaderBookThemeSettings } from '@bookdock/shared'

import { localRecordId } from '@/features/local-library/id'
import SmartMenu, { readerMenuDangerItemClass, readerMenuItemClass } from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { downloadBlob } from '@/lib/download'
import { pointerAnchor, type MenuAnchor } from '@/lib/menu-anchor'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { getThemeLibrarySnapshot, selectGlobalAppearanceState, selectReadingThemeSlot, useUiStore } from '@/stores/ui.store'
import { trialAppearanceAfterTheme, type ResolvedAppearance } from './appearance'

import PaletteChip from './PaletteChip'
import SelectChip from './SelectChip'
import ThemeCombinationDialog from './ThemeCombinationDialog'
import ThemeEditorDialog, { type ThemeCardEdit } from './ThemeEditorDialog'
import ThemeIcon from './ThemeIcon'
import { useThemeAssetUrls } from './asset-urls'
import { ThemeAssetStore } from './assets'
import { publishThemeDeleteUndo } from './theme-delete-undo'
import { materializeTheme, normalizeThemeCards, removeThemeCard, themeLibraryNames, uniqueName, upsertThemeCard, type ReadingThemeLibrary, type SavedReadingTheme, type ThemeCssCard, type ThemePalette } from './theme-library'
import { buildThemeLibraryPackage, themeLibraryPackageFileName } from './theme-package'

interface ReadingThemePanelProps {
  /** Resolved appearance of the slot being edited (global + book layers). */
  appearance?: ResolvedAppearance
  /** The book's theme group; trials simulate an apply inside it. */
  bookTheme?: ReaderBookThemeSettings
  onPickTheme?: (themeId: string) => void
  onPickPalette?: (paletteId: string) => void
  onSetCss?: (mode: 'off' | 'card', cssId?: string | null) => void
  onToggleHighlight?: (ruleId: string) => void
  bookId?: string
}

type Group = 'theme' | ThemeCardEdit['kind']
const collapsedCount = 6
const iconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current/65 transition-colors hover:bg-(--bd-sel-bg-hover) hover:text-current focus-visible:outline-2 focus-visible:outline-current'

function withCard(library: ReadingThemeLibrary, edit: ThemeCardEdit): ReadingThemeLibrary {
  if (!edit.card) return library
  if (edit.kind === 'palette') return { ...library, palettes: upsertThemeCard(library.palettes, edit.card) }
  if (edit.kind === 'css') return { ...library, css: upsertThemeCard(library.css, edit.card) }
  return { ...library, highlights: upsertThemeCard(library.highlights, edit.card) }
}

export default function ReadingThemePanel({
  appearance,
  bookTheme,
  onPickTheme,
  onPickPalette,
  onSetCss,
  onToggleHighlight,
  bookId,
}: ReadingThemePanelProps) {
  const _ = useTranslation()
  const library = useUiStore((state) => state.themeLibrary)
  const setLibrary = useUiStore((state) => state.setThemeLibrary)
  const setTrial = useUiStore((state) => state.setReaderThemeTrial)
  const globalAppearanceState = useUiStore(selectGlobalAppearanceState)
  const slot = useUiStore(selectReadingThemeSlot)
  const scope = useAuthStore((state) => state.user?.id ?? 'device')
  const [expanded, setExpanded] = useState<Partial<Record<Group, boolean>>>({})
  const [themeEditor, setThemeEditor] = useState<{ theme: SavedReadingTheme; existing: boolean } | null>(null)
  const [cardEditor, setCardEditor] = useState<{ edit: ThemeCardEdit; onCreated?: (id: string) => void } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    anchor: MenuAnchor
    onEdit: () => void
    onCopy?: () => void
    onDelete?: () => void
    /** In-use theme: the row swaps to a confirm step instead of deleting at once. */
    deleteHint?: string
    confirming?: boolean
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { if (bookId) setTrial(bookId, null) }, [bookId, setTrial])

  const paletteId = appearance?.effectivePaletteId ?? 'paper'
  const cssId = appearance?.cssId ?? null
  const highlightIds = useMemo(() => appearance?.highlightIds ?? [], [appearance])
  const selectedThemeId = appearance?.selectedThemeId ?? null
  const variant = 'reader'
  const palettes = library.palettes
  const paletteAssetIds = useMemo(() => library.palettes.flatMap((item) => item.wallpaperAssetId ? [item.wallpaperAssetId] : []), [library.palettes])
  const { urls: wallpapers, missing: missingWallpapers } = useThemeAssetUrls(scope, paletteAssetIds)

  const toggleHighlight = (id: string) => onToggleHighlight?.(id)
  const newTheme = () => setThemeEditor({ theme: { id: localRecordId(), name: '', cards: { paletteId, cssId, highlightIds } }, existing: false })
  const saveTheme = (theme: SavedReadingTheme) => {
    const current = useUiStore.getState().themeLibrary
    setLibrary({ ...current, themes: upsertThemeCard(current.themes, { ...theme, cards: normalizeThemeCards(current, theme.cards) }) })
    setThemeEditor(null)
  }

  const closeCard = () => {
    if (bookId) setTrial(bookId, null)
    setCardEditor(null)
  }
  const saveCard = (edit: ThemeCardEdit) => {
    const card = edit.card
    if (!card) return
    setLibrary(withCard(useUiStore.getState().themeLibrary, edit))
    cardEditor?.onCreated?.(card.id)
    closeCard()
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
    closeCard()
  }
  const themeInUse = (theme: SavedReadingTheme) => {
    const state = useUiStore.getState()
    return theme.id === state.readingThemeId || theme.id === state.lightReadingThemeId
      || theme.id === state.darkReadingThemeId || selectedThemeId === theme.id
  }
  const deleteTheme = (theme: SavedReadingTheme) => {
    const state = useUiStore.getState()
    const before = getThemeLibrarySnapshot()
    const inUse = themeInUse(theme)
    state.deleteCustomTheme(theme.id)
    publishThemeDeleteUndo(
      before,
      { key: inUse ? 'reader.themeDeletedInUse' : 'reader.themeDeleted', params: { name: theme.name } },
    )
  }
  const trialCard = (edit: ThemeCardEdit | null) => {
    if (!bookId) return
    if (!edit?.card) { setTrial(bookId, null); return }
    const { id } = edit.card
    const next = withCard(library, edit)
    const selected = { paletteId, cssId, highlightIds: [...highlightIds] }
    if (edit.kind === 'palette') selected.paletteId = id
    else if (edit.kind === 'css') selected.cssId = id
    // Toggling appends the rule at the end of the chain — the trial must
    // mirror that priority, not grant the new rule the front slot.
    else if (!selected.highlightIds.includes(id)) selected.highlightIds = [...selected.highlightIds, id]
    setTrial(bookId, materializeTheme(next, { id: 'trial', name: '', cards: selected }))
  }
  // A whole-theme trial resolves what applying the draft would produce (the
  // theme's own components replace, undefined components are kept) instead of
  // materializing the draft in isolation.
  const trialTheme = (draft: SavedReadingTheme | null) => {
    if (!bookId || !draft) { setTrial(bookId ?? null, null); return }
    const resolved = trialAppearanceAfterTheme(library, globalAppearanceState, bookTheme, slot, draft)
    setTrial(bookId, materializeTheme(library, {
      id: 'trial',
      name: '',
      cards: { paletteId: resolved.effectivePaletteId, cssId: resolved.cssId, highlightIds: resolved.highlightIds },
    }))
  }
  const exportTheme = async (theme: SavedReadingTheme) => {
    const current = useUiStore.getState().themeLibrary
    const selection = { themes: [theme], palettes: [], css: [], highlights: [] }
    try {
      const { blob, missing } = await buildThemeLibraryPackage(selection, current, new ThemeAssetStore(), scope)
      if (!blob) {
        notify.error({ key: 'reader.themeExportMissing', params: { count: missing.length } })
        return
      }
      if (scope !== (useAuthStore.getState().user?.id ?? 'device')) return
      downloadBlob(themeLibraryPackageFileName(selection), blob)
      notify.success({ key: 'reader.themeExportDone', params: { count: 1 } })
    } catch {
      notify.error({ key: 'reader.themeExportFailed' })
    }
  }

  function region<T extends { id: string }>(
    group: Group,
    label: string,
    addLabel: string,
    items: T[],
    current: string[],
    render: (item: T) => ReactNode,
    onAdd: () => void,
    action?: ReactNode,
  ) {
    const isExpanded = expanded[group] === true
    const visible = isExpanded ? items : items.filter(({ id }, index) => index < collapsedCount || current.includes(id))
    return (
      <section key={group} aria-label={label} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
        {/* 标题行不参与图标按钮的居中：28px 按钮与 16px 文字行高差的一半用 -mt-1.5 抵掉，
            否则标题会比其它 tab（字体/布局/显示）的区块标题低 6px */}
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-semibold text-current/75">{label}</span>
          <div className="-mt-1.5 flex shrink-0 items-center gap-0.5">
            {action}
            {(isExpanded || visible.length < items.length) && (
              <button
                type="button"
                className={cn(iconButton, isExpanded && 'rotate-180')}
                aria-expanded={isExpanded}
                aria-label={_(isExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                title={_(isExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                onClick={() => setExpanded({ ...expanded, [group]: !isExpanded })}
              >
                <ThemeIcon name="more" size={13} />
              </button>
            )}
            <button
              type="button"
              aria-label={addLabel}
              title={addLabel}
              className={iconButton}
              onClick={onAdd}
            >
              <ThemeIcon name="plus" size={13} />
            </button>
          </div>
        </div>
        {visible.length > 0 ? (
          <div className={group === 'palette' ? 'grid grid-cols-2 gap-1.5' : 'flex flex-wrap gap-1.5'}>
            {visible.map(render)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--bd-read-accent)]/50 p-3 text-center text-xs text-current/55">
            {group === 'css' ? _('reader.themeCssEmpty') : _('reader.themeHighlightEmpty')}
          </div>
        )}
      </section>
    )
  }

  const nameCard = (
    id: string,
    name: string,
    selected: boolean,
    onSelect: () => void,
    onEdit: () => void,
    options?: { disabled?: boolean; onCopy?: () => void; onDelete?: () => void; deleteHint?: string },
  ) => {
    const disabled = options?.disabled ?? false
    return (
      <SelectChip
        key={id}
        title={name}
        selected={selected}
        disabled={disabled}
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({
            anchor: pointerAnchor(e.currentTarget, { x: e.clientX, y: e.clientY }),
            onEdit,
            onCopy: options?.onCopy,
            onDelete: options?.onDelete,
            deleteHint: options?.deleteHint,
          })
        }}
      >
        {name}
      </SelectChip>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--bd-read-accent)]/35">
      {region(
        'theme',
        _('reader.themeSavedLabel'),
        _('reader.newTheme'),
        library.themes,
        selectedThemeId ? [selectedThemeId] : [],
        (theme) => {
          const isBuiltIn = ['paper', 'cream', 'sepia', 'night'].includes(theme.id)
          return nameCard(
            theme.id,
            theme.name,
            theme.id === selectedThemeId,
            () => onPickTheme?.(theme.id),
            () => setThemeEditor({ theme, existing: true }),
            {
              onCopy: () =>
                setThemeEditor({
                  existing: false,
                  theme: {
                    ...theme,
                    id: localRecordId(),
                    name: uniqueName(theme.name, themeLibraryNames(library, 'theme')),
                  },
                }),
              onDelete: isBuiltIn ? undefined : () => deleteTheme(theme),
              deleteHint: isBuiltIn || !themeInUse(theme) ? undefined : _('reader.themeDeleteInUse'),
            },
          )
        },
        newTheme,
      )}
      {region(
        'palette',
        _('reader.themePaletteLabel'),
        _('reader.themeNewPalette'),
        palettes,
        [paletteId],
        (palette) => {
          const selected = Boolean(palette.id === paletteId)
          const wallpaper = palette.wallpaperAssetId ? wallpapers[palette.wallpaperAssetId] : undefined
          const edit = () => setCardEditor({ edit: { kind: 'palette', card: palette } })
          const isBuiltIn = ['paper', 'cream', 'sepia', 'night'].includes(palette.id)
          return (
            <PaletteChip
              key={palette.id}
              name={palette.name}
              colors={palette.colors}
              hasWallpaper={Boolean(palette.wallpaperAssetId)}
              wallpaperUrl={wallpaper}
              wallpaperPending={Boolean(palette.wallpaperAssetId) && !wallpaper && !missingWallpapers.includes(palette.wallpaperAssetId!)}
              wallpaperLabel={_('reader.themeWallpaper')}
              selected={selected}
              onClick={() => {
                if (!selected) onPickPalette?.(palette.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({
                  anchor: pointerAnchor(e.currentTarget, { x: e.clientX, y: e.clientY }),
                  onEdit: edit,
                  onCopy: () => {
                    const card = {
                      ...palette,
                      id: localRecordId(),
                      name: uniqueName(palette.name, themeLibraryNames(library, 'palette')),
                    }
                    saveCard({ kind: 'palette', card })
                  },
                  onDelete: isBuiltIn ? undefined : () => deleteCard({ kind: 'palette', card: palette }),
                })
              }}
            />
          )
        },
        () => setCardEditor({ edit: { kind: 'palette' } }),
      )}
      {region(
        'css',
        _('reader.themeCssLabel'),
        _('reader.themeNewCss'),
        library.css,
        cssId ? [cssId] : [],
        (card) =>
          nameCard(
            card.id,
            card.name,
            cssId === card.id,
            () => onSetCss?.(cssId === card.id ? 'off' : 'card', card.id),
            () => setCardEditor({ edit: { kind: 'css', card } }),
            {
              onCopy: () => {
                const copyCard = {
                  ...card,
                  id: localRecordId(),
                  name: uniqueName(card.name, themeLibraryNames(library, 'css')),
                }
                saveCard({ kind: 'css', card: copyCard })
              },
              onDelete: () => deleteCard({ kind: 'css', card }),
            },
          ),
        () => setCardEditor({ edit: { kind: 'css' } }),
      )}
      {region(
        'highlight',
        _('reader.themeHighlightRulesTitle'),
        _('reader.themeNewHighlight'),
        library.highlights,
        highlightIds,
        (card) => {
          const selected = highlightIds.includes(card.id)
          return nameCard(
            card.id,
            card.name,
            selected,
            () => toggleHighlight(card.id),
            () => setCardEditor({ edit: { kind: 'highlight', card } }),
            {
              onCopy: () => {
                const copyCard = {
                  ...card,
                  id: localRecordId(),
                  name: uniqueName(card.name, themeLibraryNames(library, 'highlight'), 50),
                }
                saveCard({ kind: 'highlight', card: copyCard })
              },
              onDelete: () => deleteCard({ kind: 'highlight', card }),
            },
          )
        },
        () => setCardEditor({ edit: { kind: 'highlight' } }),
      )}
      {themeEditor && <ThemeCombinationDialog key={themeEditor.theme.id} initial={themeEditor.theme} existing={themeEditor.existing} library={library} variant={variant}
        onClose={() => { if (bookId) setTrial(bookId, null); setThemeEditor(null) }} onSave={saveTheme}
        onCreateCard={(kind, onCreated) => setCardEditor({ edit: { kind }, onCreated })}
        onEditCard={(edit) => setCardEditor({ edit })}
        onCopyCard={(kind, card) => {
          if (!card) return
          const copyName = kind === 'highlight'
            ? uniqueName(card.name, themeLibraryNames(library, 'highlight'), 50)
            : uniqueName(card.name, themeLibraryNames(library, kind), 100)
          if (kind === 'palette') {
            saveCard({ kind: 'palette', card: { ...(card as ThemePalette), id: localRecordId(), name: copyName } })
          } else if (kind === 'css') {
            saveCard({ kind: 'css', card: { ...(card as ThemeCssCard), id: localRecordId(), name: copyName } })
          } else {
            saveCard({ kind: 'highlight', card: { ...(card as HighlightRuleDef), id: localRecordId(), name: copyName } })
          }
        }}
        onCopy={(draft) => setThemeEditor({ existing: false, theme: { ...draft, id: localRecordId(), name: uniqueName(draft.name, themeLibraryNames(library, 'theme')) } })}
        onDelete={() => { deleteTheme(themeEditor.theme); setThemeEditor(null) }}
        onExport={() => void exportTheme(themeEditor.theme)}
        onTrial={bookId ? trialTheme : undefined} />}
      {cardEditor && <ThemeEditorDialog key={`${cardEditor.edit.kind}:${cardEditor.edit.card?.id ?? 'new'}`}
        editor={cardEditor.edit} variant={variant} onClose={closeCard} onSave={saveCard}
        onDelete={!cardEditor.edit.card ? undefined : () => deleteCard(cardEditor.edit)} onTrial={bookId ? trialCard : undefined} />}
      {contextMenu && (
        <SmartMenu
          id="theme-card-context-menu"
          innerRef={menuRef}
          variant="reader"
          anchor={contextMenu.anchor}
          size={{ width: contextMenu.confirming ? 190 : 130, height: contextMenu.onDelete ? 115 : 78 }}
          onClose={() => setContextMenu(null)}
        >
          <button
            type="button"
            onClick={() => {
              const run = contextMenu.onEdit
              setContextMenu(null)
              run()
            }}
            className={readerMenuItemClass}
          >
            <ThemeIcon name="edit" size={14} />
            <span>{_('library.edit')}</span>
          </button>
          {contextMenu.onCopy && (
            <button
              type="button"
              onClick={() => {
                const run = contextMenu.onCopy
                setContextMenu(null)
                run?.()
              }}
              className={readerMenuItemClass}
            >
              <ThemeIcon name="copy" size={14} />
              <span>{_('reader.themeCopyCard')}</span>
            </button>
          )}
          {contextMenu.onDelete && (contextMenu.confirming ? (
            <div className="px-1 pt-1 pb-0.5">
              <p className="px-1.5 pb-2 text-[11px] leading-snug text-stone-600 dark:text-stone-300">{contextMenu.deleteHint}</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const run = contextMenu.onDelete
                    setContextMenu(null)
                    run?.()
                  }}
                  className="flex-1 rounded-md bg-red-600 px-2 py-1 text-center text-[11px] font-medium text-white transition-colors hover:bg-red-700"
                >
                  {_('reader.deleteTheme')}
                </button>
                <button
                  type="button"
                  onClick={() => setContextMenu(null)}
                  className="flex-1 rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-1 text-center text-[11px] font-medium text-stone-700 dark:text-stone-300 transition-colors hover:bg-stone-200 dark:hover:bg-stone-700"
                >
                  {_('library.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (contextMenu.deleteHint) {
                  setContextMenu({ ...contextMenu, confirming: true })
                  return
                }
                const run = contextMenu.onDelete
                setContextMenu(null)
                run?.()
              }}
              className={readerMenuDangerItemClass}
            >
              <ThemeIcon name="delete" size={14} />
              <span>{_('reader.deleteTheme')}</span>
            </button>
          ))}
        </SmartMenu>
      )}
    </div>
  )
}
