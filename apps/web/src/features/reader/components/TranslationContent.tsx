import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { TRANSLATION_LANGUAGES, TRANSLATION_MAX_CHARS, type AiConfigRes, type TranslationPreferences } from '@bookdock/shared'

import { ApiError, streamTranslation } from '@/api/client'
import { useSaveTranslationConfig } from '@/api/hooks/useTranslationConfig'
import TranslationChannelSelect from '@/components/TranslationChannelSelect'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { getUserErrorNotification } from '@/lib/error-message'

import { CheckIcon, CloseIcon, TranslateIcon } from './annotation-icons'

interface TranslationContentProps {
  bookId: string
  text: string
  preferences: TranslationPreferences
  config: AiConfigRes
  onClose: () => void
}

function RetryIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.8-3.9L3 9" />
      <path d="M3 4.5V9h4.5M4 13a8 8 0 0 0 14.8 3.9L21 15M21 19.5V15h-4.5" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

export default function TranslationContent({ bookId, text, preferences, config, onClose }: TranslationContentProps) {
  const _ = useTranslation()
  const id = useId()
  const client = useQueryClient()
  const save = useSaveTranslationConfig()
  const [draft, setDraft] = useState<TranslationPreferences>(() => ({
    ...preferences,
    channel: preferences.channel.profileId ? preferences.channel : { kind: 'ai', profileId: config.profiles[0]?.id ?? null, model: null },
  }))
  const [request, setRequest] = useState(draft)
  const [attempt, setAttempt] = useState(0)
  const [stopped, setStopped] = useState(false)
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [langPos, setLangPos] = useState<{ right: number; top: number } | null>(null)

  const outputRef = useRef<HTMLDivElement>(null)
  const langButtonRef = useRef<HTMLButtonElement>(null)
  const langMenuRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  const isTruncated = text.trim().length > TRANSLATION_MAX_CHARS
  const effectiveText = isTruncated ? text.trim().slice(0, TRANSLATION_MAX_CHARS) : text

  useEffect(() => {
    if (isTruncated) {
      notify.info({ key: 'translation.tooLongTruncated', params: { max: TRANSLATION_MAX_CHARS } })
    }
  }, [isTruncated])

  const profile = request.channel.profileId ? config.profiles.find((item) => item.id === request.channel.profileId) : null
  const available = Boolean(profile && (request.channel.model ?? profile.model))
  const key = ['translation', 'result', id, attempt, bookId, request] as const

  const result = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      await Promise.resolve()
      signal.throwIfAborted()
      if (preferences.channel.profileId === null && request.channel.profileId) {
        save.mutate(request, { onError: (error) => notify.error(getUserErrorNotification(error)) })
      }
      setOutput('')
      follow.current = true
      await streamTranslation({ bookId, text: effectiveText, ...request }, signal, (chunk) => {
        if (signal.aborted) return
        setOutput((previous) => previous + chunk)
        if (follow.current) {
          requestAnimationFrame(() => {
            if (!signal.aborted && follow.current && outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight
            }
          })
        }
      })
      return true
    },
    enabled: available && !stopped,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const busy = result.isFetching
  const failure = result.error instanceof ApiError ? result.error.code : null
  const status = config.profiles.length === 0
    ? _('translation.notConfigured')
    : !available
      ? _('translation.notConfigured')
      : stopped
        ? _('translation.stopped')
        : result.isError
          ? _(`translation.${failure === 'AI_BUSY' ? 'busy' : failure === 'AI_RATE_LIMITED' ? 'rateLimited' : failure === 'AI_NOT_CONFIGURED' ? 'notConfigured' : failure === 'AI_NOT_ALLOWED' ? 'notAllowed' : failure === 'AI_TIMEOUT' ? 'timeout' : 'failed'}`)
          : busy
            ? _('translation.translating')
            : ''

  async function changeTargetLang(targetLang: typeof draft.targetLang) {
    await client.cancelQueries({ queryKey: key })
    const updated: TranslationPreferences = { ...draft, targetLang }
    setDraft(updated)
    save.mutate(updated, { onError: (error) => notify.error(getUserErrorNotification(error)) })
    setStopped(false)
    setRequest(updated)
    setAttempt((prev) => prev + 1)
  }

  async function changeChannel(channel: typeof draft.channel) {
    await client.cancelQueries({ queryKey: key })
    const updated: TranslationPreferences = { ...draft, channel }
    setDraft(updated)
    save.mutate(updated, { onError: (error) => notify.error(getUserErrorNotification(error)) })
    setStopped(false)
    setRequest(updated)
    setAttempt((prev) => prev + 1)
  }

  useEffect(() => {
    if (!langOpen) {
      setLangPos(null)
      return
    }

    const updatePosition = () => {
      const button = langButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setLangPos({ right: window.innerWidth - rect.right, top: rect.bottom + 6 })
    }

    updatePosition()

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (langButtonRef.current?.contains(target) || langMenuRef.current?.contains(target)) return
      setLangOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLangOpen(false)
    }

    window.addEventListener('click', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('click', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [langOpen])

  const selectedLangObj = TRANSLATION_LANGUAGES.find((lang) => lang.id === draft.targetLang)
  const selectedLangLabel = selectedLangObj?.label ?? draft.targetLang
  const actionLabel = _(busy ? 'translation.stop' : 'translation.retry')

  return (
    <>
      {/* Header bar */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--bd-read-accent)]/40 px-3.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <TranslateIcon size={16} className="text-[var(--bd-read-primary)]" />
          <span>{_('translation.title')}</span>
        </span>

        <div className="flex items-center gap-1.5">
          {/* Target language selector */}
          <div className="relative">
            {/* Native select for accessibility and testing */}
            <select
              aria-label={_('translation.target')}
              value={draft.targetLang}
              disabled={save.isPending}
              onChange={(event) => changeTargetLang(event.target.value as typeof draft.targetLang)}
              tabIndex={-1}
              className="sr-only"
            >
              {TRANSLATION_LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>

            <button
              ref={langButtonRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              title={selectedLangLabel}
              disabled={save.isPending}
              onClick={() => setLangOpen((prev) => !prev)}
              className={`flex h-7 items-center gap-1 rounded-lg border border-[var(--bd-read-accent)]/60 bg-stone-500/5 px-2 text-xs font-medium text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 hover:border-[var(--bd-read-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:opacity-40 ${
                langOpen ? 'bg-stone-500/15 border-[var(--bd-read-accent)]' : ''
              }`}
            >
              <span>{selectedLangLabel}</span>
              <svg
                className={`h-3 w-3 text-[var(--bd-read-sub)] transition-transform ${langOpen ? 'rotate-180' : ''}`}
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

            {langOpen && langPos && createPortal(
              <div
                ref={langMenuRef}
                role="listbox"
                data-reader-translation-popover
                aria-label={_('translation.target')}
                className="reader-scrollbar fixed z-[80] max-h-56 min-w-[108px] w-auto max-w-[128px] overflow-y-auto overscroll-contain rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1 shadow-xl"
                style={{ right: langPos.right, top: langPos.top }}
              >
                {TRANSLATION_LANGUAGES.map((language) => {
                  const isSelected = language.id === draft.targetLang
                  return (
                    <button
                      key={language.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        changeTargetLang(language.id)
                        setLangOpen(false)
                      }}
                      className={`flex min-h-7.5 w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-text)]'
                          : 'text-[var(--bd-read-text)] hover:bg-stone-500/10'
                      }`}
                    >
                      <span className="truncate">{language.label}</span>
                      {isSelected && (
                        <span className="shrink-0 text-[var(--bd-read-primary)]">
                          <CheckIcon size={13} className="stroke-[2.2]" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>,
              document.body,
            )}
          </div>

          <button
            type="button"
            aria-label={_('translation.close')}
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Main content body */}
      <div
        ref={outputRef}
        onScroll={() => {
          const element = outputRef.current
          if (element) {
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
          }
        }}
        className="reader-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {output ? (
          <div aria-live="off" className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
            {output}
            {busy && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 align-middle rounded-xs bg-[var(--bd-read-primary)] animate-pulse" />
            )}
          </div>
        ) : busy ? (
          <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2.5 text-xs text-[var(--bd-read-sub)]">
            <svg className="h-5 w-5 animate-spin text-[var(--bd-read-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span className="font-medium">{_('translation.translating')}</span>
          </div>
        ) : null}

        {status && !busy && (!output || stopped || failure) && (
          <p role="status" className="mt-2 text-xs text-[var(--bd-read-sub)]">
            {status}
          </p>
        )}

        {(!available || failure === 'AI_NOT_CONFIGURED' || failure === 'AI_NOT_ALLOWED') && (
          <a
            href="/settings?section=reading"
            onClick={onClose}
            className="mt-3 inline-block text-xs font-medium text-[var(--bd-read-primary)] underline underline-offset-2 hover:opacity-80"
          >
            {_('translation.configure')}
          </a>
        )}
      </div>

      {/* Footer bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--bd-read-accent)]/25 px-3.5 py-2">
        <div className="min-w-0 flex-1">
          <TranslationChannelSelect
            config={config}
            value={draft.channel}
            disabled={save.isPending}
            onChange={changeChannel}
          />
        </div>

        {/* Action icons only (no text) */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={actionLabel}
            title={actionLabel}
            disabled={config.profiles.length === 0}
            onClick={() => {
              if (busy) {
                setStopped(true)
                void client.cancelQueries({ queryKey: key })
              } else {
                setStopped(false)
                setRequest(draft)
                setAttempt((value) => value + 1)
              }
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? <StopIcon /> : <RetryIcon />}
          </button>

          <button
            type="button"
            aria-label={_('translation.copy')}
            title={copied ? _('reader.aiCopied') : _('translation.copy')}
            disabled={!output}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(output)
                notify.success({ key: 'reader.copied' })
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                notify.error({ key: 'reader.copyFailed' })
              }
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${
              copied
                ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)]'
                : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current'
            }`}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon />}
          </button>
        </div>
      </div>
    </>
  )
}
