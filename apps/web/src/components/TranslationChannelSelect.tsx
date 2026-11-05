import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { isAiEmbeddingModel, type AiConfigRes, type TranslationChannel } from '@bookdock/shared'

import AiBrandIcon from '@/components/ui/AiBrandIcon'
import { CheckIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'

interface TranslationChannelSelectProps {
  config?: AiConfigRes
  value: TranslationChannel
  onChange: (value: TranslationChannel) => void
  disabled?: boolean
}

const isModelChatCapable = (model: { id: string; name?: string | null }) =>
  !isAiEmbeddingModel({ id: model.id, name: model.name ?? model.id })

const getProfileChatModels = (profile: { models: { id: string; name: string }[] }) =>
  (profile.models ?? []).filter(isModelChatCapable)

const isProfileUsable = (profile: { model?: string | null; models: { id: string; name: string }[] }) => {
  const chatModels = getProfileChatModels(profile)
  if (chatModels.length > 0) return true
  if (profile.model && isModelChatCapable({ id: profile.model, name: profile.model })) return true
  return false
}

export default function TranslationChannelSelect({ config, value, onChange, disabled }: TranslationChannelSelectProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; maxWidth?: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const encode = (profileId: string | null, model: string | null) => JSON.stringify([profileId, model])
  const profiles = config?.profiles ?? []
  const usableProfiles = profiles.filter(isProfileUsable)
  const hasAnyServices = usableProfiles.length > 0

  const selectedProfile = profiles.find((profile) => profile.id === value.profileId)
  const selectedChatModels = selectedProfile ? getProfileChatModels(selectedProfile) : []
  const isDefaultModelValid = Boolean(
    selectedProfile?.model && isModelChatCapable({ id: selectedProfile.model, name: selectedProfile.model }),
  )

  const isModelAvailable = Boolean(
    selectedProfile &&
    isProfileUsable(selectedProfile) &&
    (
      (value.model && selectedChatModels.some((m) => m.id === value.model)) ||
      (!value.model && (isDefaultModelValid || selectedChatModels.length > 0))
    ),
  )

  const selected = encode(value.profileId, value.model === selectedProfile?.model ? null : value.model)
  const effectiveModelId = value.model ?? selectedProfile?.model ?? selectedChatModels[0]?.id ?? null
  const selectedModelObj = selectedChatModels.find((model) => model.id === effectiveModelId)
  const selectedModelName = selectedModelObj?.name || (isModelAvailable ? (effectiveModelId || _('translation.defaultModel')) : '')

  const triggerLabel = isModelAvailable && selectedProfile
    ? `${selectedProfile.name} · ${selectedModelName}`
    : !hasAnyServices
      ? _('translation.noServices')
      : _('translation.unavailable')

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }

    const updatePos = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const bottom = Math.max(8, window.innerHeight - rect.top + 6)
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 260))
      setMenuPos({ left, bottom, maxWidth: Math.min(320, window.innerWidth - 16) })
    }

    updatePos()

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
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('click', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  return (
    <div className="relative min-w-0 max-w-full">
      {/* Native select for form accessibility and test compatibility */}
      <select
        aria-label={_('translation.channel')}
        value={selected}
        disabled={disabled || !hasAnyServices}
        onChange={(event) => {
          const [profileId, model] = JSON.parse(event.target.value) as [string | null, string | null]
          onChange({ kind: 'ai', profileId, model })
        }}
        tabIndex={-1}
        className="sr-only"
      >
        {!isModelAvailable && (
          <option value={selected} disabled>
            {_(!hasAnyServices ? 'translation.noServices' : 'translation.unavailable')}
          </option>
        )}
        {usableProfiles.map((profile) => {
          const chatModels = getProfileChatModels(profile)
          const hasDefault = Boolean(profile.model && isModelChatCapable({ id: profile.model, name: profile.model }))
          return (
            <optgroup key={profile.id} label={profile.name}>
              {hasDefault && (
                <option value={encode(profile.id, null)}>
                  {profile.name} · {profile.model}
                </option>
              )}
              {chatModels
                .filter((model) => !hasDefault || model.id !== profile.model)
                .map((model) => (
                  <option key={model.id} value={encode(profile.id, model.id)}>
                    {profile.name} · {model.name || model.id}
                  </option>
                ))}
            </optgroup>
          )
        })}
      </select>

      {/* Polished interactive trigger button */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={triggerLabel}
        disabled={disabled || !hasAnyServices}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[var(--bd-read-accent)]/60 bg-stone-500/5 px-2 text-left text-xs font-medium text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 hover:border-[var(--bd-read-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? 'bg-stone-500/15 border-[var(--bd-read-accent)]' : ''
        }`}
      >
        {isModelAvailable && selectedProfile && (
          <AiBrandIcon
            name={selectedModelName}
            model={selectedModelObj}
            provider={selectedProfile.provider}
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
          style={{ left: menuPos.left, bottom: menuPos.bottom, maxWidth: menuPos.maxWidth }}
        >
          {!hasAnyServices ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--bd-read-sub)]">{_('translation.noServices')}</p>
          ) : (
            usableProfiles.map((profile) => {
              const chatModels = getProfileChatModels(profile)
              const defaultModelObj = chatModels.find((m) => m.id === profile.model)
              const hasDefault = Boolean(profile.model && isModelChatCapable({ id: profile.model, name: profile.model }))
              const otherModels = hasDefault ? chatModels.filter((m) => m.id !== profile.model) : chatModels
              const isDefaultSelected = hasDefault && value.profileId === profile.id && (value.model === null || value.model === profile.model)

              return (
                <div key={profile.id} className="mb-1.5 last:mb-0">
                  <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--bd-read-sub)]">
                    {profile.name}
                  </div>

                  {/* Profile default model */}
                  {hasDefault && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isDefaultSelected}
                      onClick={() => {
                        onChange({ kind: 'ai', profileId: profile.id, model: null })
                        setOpen(false)
                      }}
                      className={`flex min-h-8 min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                        isDefaultSelected
                          ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-text)]'
                          : 'text-[var(--bd-read-text)] hover:bg-stone-500/10'
                      }`}
                    >
                      <AiBrandIcon
                        name={profile.model ?? profile.name}
                        model={defaultModelObj}
                        provider={profile.provider}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {defaultModelObj?.name || profile.model || _('translation.defaultModel')}
                        </p>
                        {defaultModelObj && defaultModelObj.name !== defaultModelObj.id && (
                          <p className="truncate text-[10px] text-[var(--bd-read-sub)]">{defaultModelObj.id}</p>
                        )}
                      </div>
                      {isDefaultSelected && (
                        <span className="ml-1 shrink-0 text-[var(--bd-read-primary)]">
                          <CheckIcon size={14} className="stroke-[2.2]" />
                        </span>
                      )}
                    </button>
                  )}

                  {/* Additional profile models */}
                  {otherModels.map((model) => {
                    const isSelected = value.profileId === profile.id && (value.model === model.id || (!hasDefault && chatModels[0]?.id === model.id && value.model === null))
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          onChange({ kind: 'ai', profileId: profile.id, model: model.id })
                          setOpen(false)
                        }}
                        className={`flex min-h-8 min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-text)]'
                            : 'text-[var(--bd-read-text)] hover:bg-stone-500/10'
                        }`}
                      >
                        <AiBrandIcon
                          name={model.name || model.id}
                          model={model}
                          provider={profile.provider}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{model.name || model.id}</p>
                          {model.name && model.name !== model.id && (
                            <p className="truncate text-[10px] text-[var(--bd-read-sub)]">{model.id}</p>
                          )}
                        </div>
                        {isSelected && (
                          <span className="ml-1 shrink-0 text-[var(--bd-read-primary)]">
                            <CheckIcon size={14} className="stroke-[2.2]" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
