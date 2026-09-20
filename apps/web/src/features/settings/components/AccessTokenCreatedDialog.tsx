import { useState } from 'react'

import type { AccessTokenCreateRes } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

interface AccessTokenCreatedDialogProps {
  result: AccessTokenCreateRes
  onClose: () => void
}

/** The only place the plaintext is ever shown. Once this closes it is gone. */
export default function AccessTokenCreatedDialog({ result, onClose }: AccessTokenCreatedDialogProps) {
  const _ = useTranslation()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(result.plaintext)
      setCopied(true)
      notify.success({ key: 'settings.tokensCopied' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify.error({ key: 'settings.tokensCopyFailed' })
    }
  }

  return (
    <Modal title={_('settings.tokensCreatedTitle')} onClose={onClose} size="default">
      <div className="flex flex-col gap-4">
        {/* Warning Alert Banner with Icon */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{_('settings.tokensCreatedWarning')}</span>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
            {_('settings.tokensName')}: <span className="font-semibold text-stone-800 dark:text-stone-200">{result.token.name || _('settings.tokensUnnamed')}</span>
          </span>
          <div className="relative flex items-center">
            <input
              type="text"
              readOnly
              value={result.plaintext}
              aria-label={_('settings.tokensSecret')}
              onFocus={(event) => event.target.select()}
              className="h-10 w-full rounded-xl border border-stone-200 bg-stone-50/70 pl-3 pr-24 font-mono text-xs text-stone-800 select-all outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-200"
            />
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="absolute right-1.5 flex h-7 items-center gap-1.5 rounded-lg bg-stone-200/80 px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-300 active:scale-95 dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600"
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
              <span>{copied ? _('settings.tokensCopied') : _('settings.tokensCopy')}</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button type="button" size="sm" onClick={onClose} className="w-full sm:w-auto">
            {_('settings.tokensCreatedDone')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AlertTriangleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CheckIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
