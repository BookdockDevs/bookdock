import { useRef, useState } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import SelectChip from '@/features/reading-theme/SelectChip'
import ThemeIcon from '@/features/reading-theme/ThemeIcon'
import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore } from '@/stores/ui.store'
import { pointerAnchor, type MenuAnchor } from '@/lib/menu-anchor'

import { useViewSettings } from '../view-settings-context'
import { useIsTouch } from '../hooks/useIsTouch'
import { PencilIcon, PinIcon, TrashIcon } from './annotation-icons'
import {
  nextPresetName,
  parseReadingConfig,
  type ReadingPreset,
} from '../lib/reading-profiles'

// Reading-setting presets (grill 定案 2026-08-12, activation rework
// 2026-08-13): icon-ish chips colored by the preset's own reading theme +
// its name. The highlighted chip is the EFFECTIVE preset (book binding wins
// over the device active). Click semantics: on an unbound book it toggles
// the device active; on a bound book it re-binds (also adopting the preset
// as device active), or unbinds when the effective chip is clicked again.
// Create/rename/delete/bind affordances: a right-click context menu on
// pointer devices, inline ghost icon buttons on touch; the only text input
// is the name field.
export default function ReadingPresetPicker() {
  const _ = useTranslation()
  const readingConfig = useUiStore((s) => s.readingConfig)
  const activeId = useUiStore((s) => s.activePresetId)
  const createReadingPreset = useUiStore((s) => s.createReadingPreset)
  const renameReadingPreset = useUiStore((s) => s.renameReadingPreset)
  const deleteReadingPreset = useUiStore((s) => s.deleteReadingPreset)
  const activateReadingPreset = useUiStore((s) => s.activateReadingPreset)
  // Book context: 仅本书's raw diff rides into the new preset so a preset
  // created while a book-level override is active captures the effective
  // (WYSIWYG) values; the binding fields drive the pin affordance.
  const viewSettings = useViewSettings()
  const boundPresetId = viewSettings?.boundPresetId ?? null
  const setBoundPreset = viewSettings?.setBoundPreset ?? null
  // Touch has no hover: the chip action group stays visible
  const isTouch = useIsTouch()

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const cfg = parseReadingConfig(readingConfig)
  const presets = cfg?.presets ?? []
  const effectiveId = boundPresetId && presets.some((p) => p.id === boundPresetId)
    ? boundPresetId
    : activeId
  const menuPreset = presets.find((p) => p.id === menu?.id) ?? null

  function onChipClick(preset: ReadingPreset) {
    const effective = preset.id === effectiveId
    if (boundPresetId !== null && setBoundPreset) {
      if (effective) {
        // Unbind: falls back to the device active preset
        setBoundPreset(null)
      } else {
        // Rebind and adopt the preset as the device active too
        setBoundPreset(preset.id)
        activateReadingPreset(preset.id)
      }
    } else {
      activateReadingPreset(effective ? null : preset.id)
    }
  }

  function startCreate() {
    if (creating) return
    setDraftName(nextPresetName(cfg, _('reader.presetDefaultBase')))
    setCreating(true)
  }

  function commitCreate() {
    const name = draftName.trim()
    if (!name) {
      setCreating(false)
      return
    }
    createReadingPreset(name, viewSettings?.perBookDiff as Record<string, unknown> | undefined)
    setCreating(false)
  }

  function startRename(preset: ReadingPreset) {
    setRenamingId(preset.id)
    setRenameDraft(preset.name)
  }

  function commitRename() {
    const name = renameDraft.trim()
    if (renamingId && name) renameReadingPreset(renamingId, name)
    setRenamingId(null)
  }

  return (
    <div>
      <div className="mb-2.5 flex items-start justify-between">
        <span className="text-sm font-medium text-current" title={_('reader.presetSection')}>
          {_('reader.presetSection')}
        </span>
        {/* -mt-1 keeps the 28px icon button centred on the 20px title line
            instead of pushing the title down by half the difference */}
        <button
          type="button"
          onClick={startCreate}
          title={_('reader.presetCreate')}
          aria-label={_('reader.presetCreate')}
          className="-mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current/65 transition-colors hover:bg-(--bd-sel-bg-hover) hover:text-current focus-visible:outline-2 focus-visible:outline-current"
        >
          <ThemeIcon name="plus" size={13} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => {
          const effective = preset.id === effectiveId
          const bound = preset.id === boundPresetId
          return (
            <div
              key={preset.id}
              className="flex items-center gap-1"
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: preset.id, anchor: pointerAnchor(e.currentTarget, { x: e.clientX, y: e.clientY }) })
              }}
            >
              {renamingId === preset.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={commitRename}
                  placeholder={_('reader.presetNamePlaceholder')}
                  className="h-8 w-24 rounded-lg border-[1.5px] border-(--bd-sel-border-on) bg-(--bd-sel-bg) px-2 text-xs text-(--bd-sel-text-on) outline-none placeholder:text-(--bd-hint-text)"
                />
              ) : (
                <SelectChip
                  title={effective ? (bound ? _('reader.presetUnbind') : _('reader.presetBackToGlobal')) : preset.name}
                  selected={effective}
                  onClick={() => onChipClick(preset)}
                  meta={bound && (
                    /* Bound-to-this-book marker: plain text suffix — the tiny
                       pin badge rendered as an unreadable dot at 8px */
                    <span className="shrink-0 text-[10px] leading-none text-(--bd-hint-text)">
                      · {_('reader.presetBoundBadge')}
                    </span>
                  )}
                >
                  {preset.name}
                </SelectChip>
              )}

              {/* Bind/rename/delete affordances: pointer devices get a
                  right-click context menu (rendered below); touch has no
                  contextmenu, so it keeps these inline ghost icon buttons. */}
              {isTouch && renamingId !== preset.id && (
                <span className="flex items-center gap-0.5">
                  {setBoundPreset && (
                    <button
                      type="button"
                      title={bound ? _('reader.presetUnbind') : _('reader.presetBind')}
                      onClick={() => setBoundPreset(bound ? null : preset.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-(--bd-sel-text) transition-colors hover:bg-(--bd-sel-bg-hover) hover:text-current"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5" />
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    title={_('reader.presetRename')}
                    onClick={() => startRename(preset)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-(--bd-sel-text) transition-colors hover:bg-(--bd-sel-bg-hover) hover:text-current"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title={_('reader.presetDelete')}
                    onClick={() => deleteReadingPreset(preset.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-(--bd-sel-text) transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
          )
        })}

        {creating && (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreate()
              if (e.key === 'Escape') setCreating(false)
            }}
            onBlur={commitCreate}
            placeholder={_('reader.presetNamePlaceholder')}
            className="h-8 w-24 rounded-lg border-[1.5px] border-(--bd-sel-border-on) bg-(--bd-sel-bg) px-2 text-xs text-(--bd-sel-text-on) outline-none placeholder:text-(--bd-hint-text)"
          />
        )}
        {presets.length === 0 && !creating && (
          <p className="py-0.5 text-xs text-(--bd-hint-text)">
            {_('reader.presetNone')}
          </p>
        )}
      </div>

      {menu && menuPreset && (
        <SmartMenu
          id="preset-context-menu"
          innerRef={menuRef}
          variant="reader"
          anchor={menu.anchor}
          size={{ width: 130, height: 140 }}
          onClose={() => setMenu(null)}
        >
          {setBoundPreset && (
            <button
              type="button"
              onClick={() => {
                setBoundPreset(menuPreset.id === boundPresetId ? null : menuPreset.id)
                setMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5"><PinIcon /></span>
              {menuPreset.id === boundPresetId ? _('reader.presetUnbind') : _('reader.presetBind')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              startRename(menuPreset)
              setMenu(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10"
          >
            <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5"><PencilIcon /></span>
            {_('reader.presetRename')}
          </button>
          <button
            type="button"
            onClick={() => {
              deleteReadingPreset(menuPreset.id)
              setMenu(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
          >
            <span className="[&>svg]:h-3.5 [&>svg]:w-3.5"><TrashIcon /></span>
            {_('reader.presetDelete')}
          </button>
        </SmartMenu>
      )}
    </div>
  )
}
