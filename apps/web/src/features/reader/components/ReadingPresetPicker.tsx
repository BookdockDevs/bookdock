import { useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore } from '@/stores/ui.store'
import { resolveReadingTheme } from '@/lib/reading-theme'

import { useViewSettings } from '../view-settings-context'
import {
  nextPresetName,
  parseReadingConfig,
  type ReadingPreset,
} from '../lib/reading-profiles'

// Reading-setting presets (grill 定案 2026-08-12): icon-ish chips colored by
// the preset's own reading theme + its name; single-select toggling (clicking
// the active chip again returns to the global config). Create/rename/delete
// are icon-only affordances; the only text input is the name field.
export default function ReadingPresetPicker() {
  const _ = useTranslation()
  const readingConfig = useUiStore((s) => s.readingConfig)
  const customThemes = useUiStore((s) => s.customThemes)
  const createReadingPreset = useUiStore((s) => s.createReadingPreset)
  const renameReadingPreset = useUiStore((s) => s.renameReadingPreset)
  const deleteReadingPreset = useUiStore((s) => s.deleteReadingPreset)
  const activateReadingPreset = useUiStore((s) => s.activateReadingPreset)
  // 仅本书's raw diff rides into the new preset so a preset created while a
  // book-level override is active captures the effective (WYSIWYG) values.
  const viewSettings = useViewSettings()

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const cfg = parseReadingConfig(readingConfig)
  const presets = cfg?.presets ?? []
  const activeId = cfg?.active ?? null

  function startCreate() {
    if (creating || !cfg) return
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

  if (!cfg) return null

  return (
    <div className="mb-5">
      <label className="mb-2 flex items-center gap-1.5 text-xs text-[var(--bd-read-sub)]" title={_('reader.presetSection')}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        {_('reader.presetSection')}
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => {
          const active = preset.id === activeId
          const theme = resolveReadingTheme(preset.snapshot.readingThemeId as string, customThemes)
          return (
            <div key={preset.id} className="group/preset flex items-center gap-1">
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
                  className="h-7 w-24 rounded-lg border border-current bg-transparent px-2 text-xs text-current outline-none placeholder:text-[var(--bd-read-sub)]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => activateReadingPreset(active ? null : preset.id)}
                  title={active ? _('reader.presetBackToGlobal') : preset.name}
                  className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors ${
                    active
                      ? 'border-current bg-current/10 text-current'
                      : 'border-stone-200 text-[var(--bd-read-sub)] hover:text-current dark:border-stone-800'
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-stone-400/40"
                    style={{ backgroundColor: theme.bg }}
                  />
                  <span className="max-w-20 truncate">{preset.name}</span>
                </button>
              )}

              {/* Icon-only actions emerge from the chip's right side on hover,
                  pushing the following presets aside; collapse on mouse leave.
                  The named group keeps the trigger scoped to this chip — the
                  reader header (a bare `group`) wraps the settings popover. */}
              {renamingId !== preset.id && (
                <span className="hidden items-center gap-1 group-hover/preset:flex">
                  <button
                    type="button"
                    title={_('reader.presetRename')}
                    onClick={() => startRename(preset)}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-stone-500 text-white transition-colors hover:bg-stone-600"
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
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-stone-500 text-white transition-colors hover:bg-red-500"
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

        {creating ? (
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
            className="h-7 w-24 rounded-lg border border-current bg-transparent px-2 text-xs text-current outline-none placeholder:text-[var(--bd-read-sub)]"
          />
        ) : (
          <button
            type="button"
            onClick={startCreate}
            title={_('reader.presetCreate')}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-stone-300 text-[var(--bd-read-sub)] transition-colors hover:border-current hover:text-current dark:border-stone-700"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
