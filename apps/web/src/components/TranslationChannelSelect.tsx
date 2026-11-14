import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { isAiEmbeddingModel, type AiConfigRes, type AiModelEntryRes, type TranslationChannel } from '@bookdock/shared'

import AiBrandIcon from '@/components/ui/AiBrandIcon'
import AiModelOptionList, { type AiModelGroup } from '@/components/ui/AiModelOptionList'
import { useReconciledMenuPosition } from '@/hooks/useMenuAnchor'
import { useTranslation } from '@/hooks/useTranslation'
import type { MenuAnchor } from '@/lib/menu-anchor'

interface TranslationChannelSelectProps {
  config?: AiConfigRes
  value: TranslationChannel
  onChange: (value: TranslationChannel) => void
  disabled?: boolean
}

const isChatModel = (model: Pick<AiModelEntryRes, 'upstreamModelId' | 'name'>) =>
  !isAiEmbeddingModel({ id: model.upstreamModelId, name: model.name })

export default function TranslationChannelSelect({ config, value, onChange, disabled }: TranslationChannelSelectProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const connections = config?.connections ?? []
  // A switched-off model stays manageable in settings but cannot run, so the
  // execution picker only offers enabled ones; a saved one shows as unavailable.
  const chatModels = (config?.models ?? []).filter((model) => model.enabled && isChatModel(model))
  const groups: AiModelGroup[] = connections
    .map((connection) => ({ id: connection.id, name: connection.name, models: chatModels.filter((model) => model.connectionId === connection.id) }))
    .filter((group) => group.models.length > 0)
  const hasAnyService = groups.length > 0

  const selected = chatModels.find((model) => model.id === value.modelId)
  const unavailable = Boolean(value.modelId && !selected)
  const selectedName = selected?.name ?? null

  const triggerLabel = selectedName ?? _('translation.selectModel')

  const anchor: MenuAnchor | null = open && buttonRef.current
    ? { kind: 'element', el: buttonRef.current, placement: 'above', align: 'start', gap: 6 }
    : null
  // `above` keeps the picker growing away from the bottom edge, which is where
  // this control lives in the reader settings panel.
  const menuPos = useReconciledMenuPosition(anchor, menuRef, { width: 260, height: 240 }, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('click', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('click', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open])

  const choose = (modelId: string) => {
    onChange({ kind: 'ai', modelId })
    setOpen(false)
  }

  return (
    <div className="relative min-w-0 max-w-full">
      {/* Native select for form accessibility and test compatibility */}
      <select
        aria-label={_('translation.channel')}
        value={value.modelId ?? ''}
        disabled={disabled || !hasAnyService}
        onChange={(event) => onChange({ kind: 'ai', modelId: event.target.value || null })}
        tabIndex={-1}
        className="sr-only"
      >
        {unavailable && <option value={value.modelId!} disabled>{_('translation.unavailable')}</option>}
        {groups.map((group) => (
          <optgroup key={group.id} label={group.name}>
            {group.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </optgroup>
        ))}
      </select>

      {/* Polished interactive trigger button */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={triggerLabel}
        disabled={disabled || !hasAnyService}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[var(--bd-read-accent)]/60 bg-stone-500/5 px-2 text-left text-xs font-medium text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 hover:border-[var(--bd-read-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? 'bg-stone-500/15 border-[var(--bd-read-accent)]' : ''
        }`}
      >
        {selectedName && (
          <AiBrandIcon
            name={selectedName}
            model={selected ? { id: selected.upstreamModelId, name: selected.name } : null}
            provider={selected?.provider ?? null}
            className="h-3.5 w-3.5 shrink-0"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <svg
          className={`h-3 w-3 shrink-0 text-[var(--bd-read-sub)] transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>

      {/* Floating menu popover */}
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          data-reader-translation-popover
          aria-label={_('translation.channel')}
          className="reader-scrollbar fixed z-[80] max-h-56 min-w-56 overflow-y-auto overscroll-contain rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 shadow-xl"
          style={{ left: 0, top: 0, translate: `${menuPos.left}px ${menuPos.top}px`, maxWidth: Math.min(320, window.innerWidth - 16) }}
        >
          {!hasAnyService ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--bd-read-sub)]">{_('translation.noServices')}</p>
          ) : (
            <>
              <AiModelOptionList groups={groups} selectedModelId={value.modelId} onSelect={choose} />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
