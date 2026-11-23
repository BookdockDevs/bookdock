import { useMemo, useRef, useState } from 'react'


import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SegmentedControl from '@/components/ui/SegmentedControl'
import SmartMenu, { readerMenuItemClass } from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { pointerAnchor, type MenuAnchor } from '@/lib/menu-anchor'
import { deriveReadingTheme } from '@/lib/reading-theme'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import type { ThemeCardEdit } from './ThemeEditorDialog'
import SelectChip from './SelectChip'
import ThemeIcon from './ThemeIcon'
import ThemeTrialBar from './ThemeTrialBar'
import { useThemeAssetUrls } from './asset-urls'
import type { ReadingThemeLibrary, SavedReadingTheme, ThemeDefinitionCards } from './theme-library'

interface ThemeCombinationDialogProps {
  initial: SavedReadingTheme
  existing: boolean
  library: ReadingThemeLibrary
  variant: 'default' | 'reader'
  onClose: () => void
  onSave: (theme: SavedReadingTheme, scope?: 'user' | 'instance') => void | Promise<void>
  onCreateCard: (kind: ThemeCardEdit['kind'], onCreated: (id: string) => void) => void
  onEditCard?: (edit: ThemeCardEdit) => void
  onCopyCard?: (kind: ThemeCardEdit['kind'], card: ThemeCardEdit['card']) => void
  onCopy?: (theme: SavedReadingTheme) => void
  onDelete?: () => void | Promise<void>
  onExport?: () => void
  onTrial?: (theme: SavedReadingTheme | null) => void
  scope?: 'user' | 'instance'
  canChangeScope?: boolean
  readOnly?: boolean
}

const inputClass =
  'w-full min-w-0 rounded-lg border border-stone-300/80 bg-transparent px-3 py-2 text-sm text-current placeholder:text-current/35 outline-none transition-colors focus:border-stone-400 focus:bg-stone-500/5 focus:ring-1 focus:ring-stone-400/20 dark:border-stone-700/80'

export default function ThemeCombinationDialog({
  initial,
  existing,
  library,
  variant,
  onClose,
  onSave,
  onCreateCard,
  onEditCard,
  onCopyCard,
  onCopy,
  onDelete,
  onTrial,
  scope = 'user',
  canChangeScope = false,
  readOnly = false,
}: ThemeCombinationDialogProps) {
  const _ = useTranslation()
  const assetScope = useAuthStore((state) => state.user?.id ?? 'device')
  const [draft, setDraft] = useState(initial)
  const [draftScope, setDraftScope] = useState<'user' | 'instance'>(scope)
  const [trial, setTrial] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{
    anchor: MenuAnchor
    onEdit?: () => void
    onCopy?: () => void
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const cards = draft.cards
  const hasPalette = library.palettes.some(({ id }) => id === cards.paletteId)

  const paletteAssetIds = useMemo(
    () => library.palettes.flatMap((item) => (item.wallpaperAssetId ? [item.wallpaperAssetId] : [])),
    [library.palettes],
  )
  const { urls: wallpapers } = useThemeAssetUrls(assetScope, paletteAssetIds)

  const change = (patch: Partial<ThemeDefinitionCards>) =>
    setDraft((current) => ({ ...current, cards: { ...current.cards, ...patch } }))
  const toggleRule = (id: string) =>
    setDraft((current) => {
      const ids = current.cards.highlightIds
      const highlightIds = ids.includes(id)
        ? ids.filter((rule) => rule !== id)
        : [...ids, id]
      return { ...current, cards: { ...current.cards, highlightIds } }
    })
  // A theme must keep at least one component (palette / CSS / highlights).
  const hasComponent = cards.paletteId != null || cards.cssId != null || cards.highlightIds.length > 0
  const create = (kind: ThemeCardEdit['kind']) => {
    onCreateCard(kind, (id) => {
      if (kind === 'palette') change({ paletteId: id })
      else if (kind === 'css') change({ cssId: id })
      else toggleRule(id)
    })
  }
  const submit = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (deleting) await onDelete?.()
      else await onSave({ ...draft, name: draft.name.trim() }, canChangeScope ? draftScope : undefined)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (trial) return <ThemeTrialBar onBack={() => { onTrial?.(null); setTrial(false) }} />

  return (
    <Modal
      title={_(existing ? 'reader.editTheme' : 'reader.newTheme')}
      variant={variant}
      containerProps={{ 'data-settings-toggle': '' }}
      onClose={() => { if (!busy) onClose() }}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {!deleting && !busy && onTrial && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onTrial(draft)
                  setTrial(true)
                }}
              >
                <ThemeIcon name="preview" size={14} />
                <span>{_('reader.themeTrial')}</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={deleting ? () => setDeleting(false) : onClose}
            >
              {_(readOnly ? 'library.close' : 'library.cancel')}
            </Button>
            {deleting && !readOnly ? (
              <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void submit()}>
                {_('reader.deleteTheme')}
              </Button>
            ) : !readOnly ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy || !hasComponent || (cards.paletteId != null && !hasPalette) || !draft.name.trim()}
                title={!hasComponent ? _('reader.themeNeedsComponent') : undefined}
                onClick={() => void submit()}
              >
                {_('reader.saveTheme')}
              </Button>
            ) : onCopy ? (
              <Button type="button" variant="primary" size="sm" onClick={() => onCopy(draft)}>
                {_('reader.copyTheme')}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {deleting ? (
        <p className="px-5 py-6 text-sm text-current/80">
          {_('reader.themeConfirmDeleteTheme', { name: initial.name })}
        </p>
      ) : (
        <div className="flex flex-col gap-4.5 px-1 py-1">
          <div className={canChangeScope ? 'flex flex-col gap-3 sm:flex-row sm:items-end' : ''}>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs font-normal text-current/55">{_('reader.themeName')}</span>
              <input
                value={draft.name}
                maxLength={100}
                disabled={readOnly}
                aria-label={_('reader.themeName')}
                className={inputClass}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {canChangeScope && (
              <div className="flex shrink-0 flex-col gap-1.5 sm:w-44">
                <span className="text-xs font-normal text-current/55">{_('settings.resourceScope')}</span>
                <SegmentedControl
                  ariaLabel={_('settings.resourceScope')}
                  value={draftScope}
                  onChange={setDraftScope}
                  size="md"
                  fullWidth
                  options={(['user', 'instance'] as const).map((value) => ({
                    value,
                    label: _(value === 'user' ? 'settings.resourceScopeUser' : 'settings.resourceScopeInstance'),
                  }))}
                />
              </div>
            )}
          </div>

          {/* Palette selection area */}
          <div className="flex flex-col gap-2.5 border-t border-current/10 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-current/90">{_('reader.themePaletteLabel')}</span>
              <button
                type="button"
                aria-label={_('reader.themeNewPalette')}
                title={_('reader.themeNewPalette')}
                onClick={() => create('palette')}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-current/70 transition-colors hover:bg-stone-500/10 hover:text-current"
              >
                <ThemeIcon name="plus" size={12} />
                <span>{_('reader.themeNewPalette')}</span>
              </button>
            </div>
            <select
              className="sr-only"
              aria-label={_('reader.themePaletteLabel')}
              value={hasPalette ? cards.paletteId : ''}
              onChange={(e) => change({ paletteId: e.target.value })}
              tabIndex={-1}
            >
              {!hasPalette && <option value="" disabled>—</option>}
              {library.palettes.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
              {library.palettes.map((palette) => {
                const selected = cards.paletteId === palette.id
                const color = deriveReadingTheme(palette.colors)
                const wallpaper = palette.wallpaperAssetId ? wallpapers[palette.wallpaperAssetId] : undefined
                return (
                  <button
                    key={palette.id}
                    type="button"
                    aria-pressed={selected}
                    title={palette.name}
                    style={{ backgroundColor: color.bg, color: color.text }}
                    onClick={() => change({ paletteId: selected ? undefined : palette.id })}
                    onContextMenu={(e) => {
                      if (!onEditCard && !onCopyCard) return
                      e.preventDefault()
                      setContextMenu({
                        anchor: pointerAnchor(e.currentTarget, { x: e.clientX, y: e.clientY }),
                        onEdit: onEditCard ? () => onEditCard({ kind: 'palette', card: palette }) : undefined,
                        onCopy: onCopyCard ? () => onCopyCard('palette', palette) : undefined,
                      })
                    }}
                    className={cn(
                      'flex h-9 min-w-0 items-center gap-2 rounded-lg border-[1.5px] px-2.5 text-left text-xs transition-[background-color,border-color] duration-150 select-none outline-none active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current',
                      selected
                        ? 'border-current/55 bg-current/8 font-medium'
                        : 'border-current/15 font-normal hover:border-current/30',
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 shadow-2xs"
                      style={{ backgroundColor: color.primary }}
                    />
                    <span className="min-w-0 flex-1 truncate">{palette.name}</span>
                    {palette.wallpaperAssetId && (
                      <span
                        className="flex h-4.5 w-4.5 shrink-0 items-center justify-center overflow-hidden rounded border border-current/15 bg-current/5"
                        title={_('reader.themeWallpaper')}
                      >
                        {wallpaper ? (
                          <img src={wallpaper} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <ThemeIcon name="image" size={10} />
                        )}
                      </span>
                    )}
                    {selected && <ThemeIcon name="check" size={12} className="shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom CSS selection area */}
          <div className="flex flex-col gap-2.5 border-t border-current/10 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-current/90">{_('reader.themeCssLabel')}</span>
              <button
                type="button"
                aria-label={_('reader.themeNewCss')}
                title={_('reader.themeNewCss')}
                onClick={() => create('css')}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-current/70 transition-colors hover:bg-stone-500/10 hover:text-current"
              >
                <ThemeIcon name="plus" size={12} />
                <span>{_('reader.themeNewCss')}</span>
              </button>
            </div>
            <select
              className="sr-only"
              aria-label={_('reader.themeCssLabel')}
              value={cards.cssId ?? ''}
              onChange={(e) => change({ cssId: e.target.value || null })}
              tabIndex={-1}
            >
              <option value="">{_('reader.themeNoCss')}</option>
              {library.css.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            {library.css.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300/60 p-3 text-center text-xs text-current/50 dark:border-stone-700/60">
                {_('reader.themeCssEmpty')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {library.css.map((card) => {
                  const selected = cards.cssId === card.id
                  return (
                    <SelectChip
                      key={card.id}
                      selected={selected}
                      onClick={() => change({ cssId: selected ? null : card.id })}
                      onContextMenu={(e) => {
                        if (!onEditCard && !onCopyCard) return
                        e.preventDefault()
                        setContextMenu({
                          anchor: pointerAnchor(e.currentTarget, { x: e.clientX, y: e.clientY }),
                          onEdit: onEditCard ? () => onEditCard({ kind: 'css', card }) : undefined,
                          onCopy: onCopyCard ? () => onCopyCard('css', card) : undefined,
                        })
                      }}
                    >
                      {card.name}
                    </SelectChip>
                  )
                })}
              </div>
            )}
          </div>

          {/* Highlight rules selection area */}
          <div className="flex flex-col gap-2.5 border-t border-current/10 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-current/90">{_('reader.themeHighlightRulesTitle')}</span>
              <button
                type="button"
                aria-label={_('reader.themeNewHighlight')}
                title={_('reader.themeNewHighlight')}
                onClick={() => create('highlight')}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-current/70 transition-colors hover:bg-stone-500/10 hover:text-current"
              >
                <ThemeIcon name="plus" size={12} />
                <span>{_('reader.themeNewHighlight')}</span>
              </button>
            </div>
            {library.highlights.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300/60 p-3 text-center text-xs text-current/50 dark:border-stone-700/60">
                {_('reader.themeHighlightEmpty')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {library.highlights.map(({ id, name }) => {
                  const selected = cards.highlightIds.includes(id)
                  const rule = library.highlights.find((h) => h.id === id)
                  return (
                    <SelectChip
                      key={id}
                      selected={selected}
                      onClick={() => toggleRule(id)}
                      onContextMenu={(e) => {
                        if ((!onEditCard && !onCopyCard) || !rule) return
                        e.preventDefault()
                        setContextMenu({
                          anchor: pointerAnchor(e.currentTarget, { x: e.clientX, y: e.clientY }),
                          onEdit: onEditCard ? () => onEditCard({ kind: 'highlight', card: rule }) : undefined,
                          onCopy: onCopyCard ? () => onCopyCard('highlight', rule) : undefined,
                        })
                      }}
                    >
                      {name}
                    </SelectChip>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {contextMenu && (
        <SmartMenu
          id="combination-card-context-menu"
          innerRef={menuRef}
          variant="reader"
          anchor={contextMenu.anchor}
          size={{ width: 110, height: contextMenu.onEdit && contextMenu.onCopy ? 74 : 42 }}
          onClose={() => setContextMenu(null)}
        >
          {contextMenu.onEdit && (
            <button
              type="button"
              onClick={() => {
                const run = contextMenu.onEdit
                setContextMenu(null)
                run?.()
              }}
              className={readerMenuItemClass}
            >
              <ThemeIcon name="edit" size={14} />
              <span>{_('library.edit')}</span>
            </button>
          )}
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
        </SmartMenu>
      )}
    </Modal>
  )
}
