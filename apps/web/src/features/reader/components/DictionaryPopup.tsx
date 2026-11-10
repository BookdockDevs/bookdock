import { useRef, useState } from 'react'

import { useDictionaries, useDictionaryLookup } from '@/api/hooks/useDictionaries'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'
import { isAccessRevocationError } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth.store'

import { useReaderState } from '../state/reader-state'
import type { SelectionInfo } from '../types'
import { CheckIcon, CloseIcon, DictionaryIcon } from './annotation-icons'
import DictionaryDefinition from './DictionaryDefinition'
import SelectionUtilityPopup from './SelectionUtilityPopup'

interface DictionaryPopupProps {
  target: SelectionInfo
}

export default function DictionaryPopup({ target }: DictionaryPopupProps) {
  const _ = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const [requestAccountId] = useState(accountId)
  const available = Boolean(accountId && accountId === requestAccountId)
  const list = useDictionaries({ enabled: available })
  const revoked = isAccessRevocationError(list.error)
  const enabled = available && !revoked ? list.data?.data.items.filter((item) => item.enabled) ?? [] : []
  const [selected, setSelected] = useState<string | null>(null)
  const id =
    selected && enabled.some((item) => item.id === selected)
      ? selected
      : enabled.find((item) => item.id === list.data?.data.lastUsedId)?.id ?? enabled[0]?.id ?? null
  const [history, setHistory] = useState(() => [target.text.trim().replace(/\s+/g, ' ')])
  const word = history[history.length - 1]!
  const lookup = useDictionaryLookup(id, word)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<SmartPosition | null>(null)
  const close = () => useReaderState.getState().setDictionaryTarget(null)
  const current = enabled.find((item) => item.id === id)
  const result = available && !revoked && !isAccessRevocationError(lookup.error) ? lookup.data?.data : undefined
  const showManage = available && !list.isPending && !list.isError && !enabled.length

  return (
    <SelectionUtilityPopup
      title={_('dictionary.title')}
      kind="dictionary"
      target={target}
      height={390}
      onClose={close}
    >
      {/* Consolidated Single-Bar Header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--bd-read-accent)]/40 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {history.length > 1 && (
            <button
              type="button"
              aria-label={_('dictionary.back')}
              onClick={() => setHistory((items) => items.slice(0, -1))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-[var(--bd-read-text)]"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="shrink-0 text-[var(--bd-read-primary)]">
              <DictionaryIcon />
            </span>
            <span>{_('dictionary.title')}</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            ref={trigger}
            type="button"
            disabled={list.isPending || !enabled.length}
            onClick={() =>
              setPosition(
                position
                  ? null
                  : computeDropdownPosition(
                      trigger.current!.getBoundingClientRect(),
                      168,
                      Math.min(240, enabled.length * 36 + 40),
                      'end',
                    ),
              )
            }
            aria-haspopup="listbox"
            aria-expanded={Boolean(position)}
            title={current?.name ?? (list.isPending ? _('dictionary.loading') : _('dictionary.empty'))}
            className={`flex h-7 max-w-[130px] items-center gap-1 rounded-lg border border-[var(--bd-read-accent)]/60 bg-stone-500/5 px-2 text-xs font-medium text-[var(--bd-read-text)] transition-colors hover:border-[var(--bd-read-accent)] hover:bg-stone-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)] disabled:opacity-40 sm:max-w-[170px] ${
              position ? 'border-[var(--bd-read-accent)] bg-stone-500/15' : ''
            }`}
          >
            <span className="truncate">{current?.name ?? (list.isPending ? _('dictionary.loading') : _('dictionary.empty'))}</span>
            <svg
              className={`h-3 w-3 shrink-0 text-[var(--bd-read-sub)] transition-transform ${position ? 'rotate-180' : ''}`}
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

          <SmartMenu
            innerRef={menu}
            triggerRef={trigger}
            position={position}
            width={168}
            variant="reader"
            className="z-[80]"
            onClose={() => setPosition(null)}
          >
            <div
              role="listbox"
              aria-label={_('dictionary.title')}
              data-reader-dictionary-popover
              className="p-1"
            >
              {enabled.map((item) => {
                const isSelected = item.id === id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setSelected(item.id)
                      setPosition(null)
                    }}
                    className={`flex min-h-7.5 w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-text)]'
                        : 'text-[var(--bd-read-text)] hover:bg-stone-500/10'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {isSelected && (
                      <span className="shrink-0 text-[var(--bd-read-primary)]">
                        <CheckIcon size={13} className="stroke-[2.2]" />
                      </span>
                    )}
                  </button>
                )
              })}
              <a
                href="/settings?section=reading&focus=dictionary"
                onClick={close}
                className="mt-1 flex items-center gap-1.5 border-t border-[var(--bd-read-accent)]/30 px-2 pt-1.5 pb-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:text-[var(--bd-read-text)]"
              >
                <span>{_('dictionary.manage')}</span>
              </a>
            </div>
          </SmartMenu>

          <button
            type="button"
            aria-label={_('translation.close')}
            onClick={close}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-[var(--bd-read-text)]"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {result?.headword && (
        <DictionaryDefinition
          key={`${accountId}:${id}:${word}`}
          accountId={accountId!}
          id={id!}
          html={result.html}
          onNavigate={(next) => {
            if (next.trim() && next.length <= 100) setHistory((items) => [...items.slice(-19), next])
          }}
        />
      )}

      {!result?.headword && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-[var(--bd-read-sub)]">
          {available && (list.isPending || lookup.isFetching) ? (
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin text-[var(--bd-read-primary)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span role="status">{_('dictionary.loading')}</span>
            </div>
          ) : (
            <>
              {showManage && (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-500/10 text-[var(--bd-read-sub)]">
                  <DictionaryIcon />
                </div>
              )}
              <p role="status" className="max-w-[220px] leading-relaxed">
                {_(
                  !available
                    ? 'dictionary.accountRequired'
                    : revoked || isAccessRevocationError(lookup.error)
                    ? 'dictionary.accessRequired'
                    : word.length > 100
                    ? 'dictionary.tooLong'
                    : list.isError || lookup.isError
                      ? 'dictionary.failed'
                      : showManage
                        ? 'dictionary.empty'
                        : 'dictionary.notFound',
                )}
              </p>
              {available && (list.isError || lookup.isError) && (
                <button
                  type="button"
                  onClick={() => {
                    if (list.isError) void list.refetch()
                    else void lookup.refetch()
                  }}
                  className="rounded-lg border border-[var(--bd-read-accent)] px-3 py-1 text-xs text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10"
                >
                  {_('dictionary.retry')}
                </button>
              )}
              {showManage && (
                <a
                  href="/settings?section=reading&focus=dictionary"
                  onClick={close}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bd-read-accent)]/80 bg-stone-500/5 px-3.5 py-1.5 text-xs font-medium text-[var(--bd-read-text)] transition-colors hover:border-[var(--bd-read-accent)] hover:bg-stone-500/10 active:scale-95"
                >
                  <span>{_(list.data?.data.items.length ? 'dictionary.manage' : 'dictionary.import')}</span>
                  <svg className="h-3 w-3 text-[var(--bd-read-sub)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </a>
              )}
            </>
          )}
        </div>
      )}
    </SelectionUtilityPopup>
  )
}

