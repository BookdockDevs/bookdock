import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { LibraryInviteStatus } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { buildLibraryInviteLink } from '../invite-link'

interface LibraryInvitePanelProps {
  libraryId: string
}

const ICON_BUTTON = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-stone-600 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-100'

export default function LibraryInvitePanel({ libraryId }: LibraryInvitePanelProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const status = useQuery({
    queryKey: ['libraries', libraryId, 'invite'],
    queryFn: () => apiGet<{ data: LibraryInviteStatus }>(`/libraries/${libraryId}/invite`),
    retry: false,
  })
  const generate = useMutation({
    mutationFn: () => apiPost<{ data: { token: string; createdAt: number } }>(`/libraries/${libraryId}/invite`),
    onSuccess: (result) => {
      queryClient.setQueryData(['libraries', libraryId, 'invite'], {
        data: { active: true, createdAt: result.data.createdAt, token: result.data.token },
      })
    },
    onError: (err) => notify.error(getUserErrorNotification(err, 'library.inviteFailed')),
  })
  const revoke = useMutation({
    mutationFn: () => apiDelete<{ data: LibraryInviteStatus }>(`/libraries/${libraryId}/invite`),
    onSuccess: (result) => {
      queryClient.setQueryData(['libraries', libraryId, 'invite'], result)
      notify.success(_('library.inviteRevoked'))
    },
    onError: (err) => notify.error(getUserErrorNotification(err, 'library.inviteFailed')),
  })
  const link = status.data?.data.token ? buildLibraryInviteLink(status.data.data.token) : null
  const active = Boolean(link)
  const busy = generate.isPending || revoke.isPending

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      notify.success(_('library.inviteCopied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify.error(_('library.inviteCopyFailed'))
    }
  }

  return (
    <section className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
      <h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">{_('library.inviteLink')}</h3>
      {status.isPending ? (
        <div className="mt-2.5 h-9 w-full animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800/60" />
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <input
            aria-label={_('library.inviteLink')}
            readOnly
            disabled={!active}
            value={link ?? ''}
            placeholder={_('library.inviteOff')}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-700 outline-none transition-colors placeholder:font-sans placeholder:text-stone-400 focus:border-stone-400 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500 dark:focus:border-stone-500"
          />
          <button
            type="button"
            className={ICON_BUTTON}
            disabled={busy}
            aria-label={active ? _('library.inviteReplace') : _('library.inviteReactivate')}
            title={active ? _('library.inviteReplace') : _('library.inviteReactivate')}
            onClick={() => generate.mutate()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={generate.isPending ? 'animate-spin' : ''}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            disabled={!active || busy}
            aria-label={_('library.inviteCopy')}
            title={_('library.inviteCopy')}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            )}
          </button>
          {active && (
            <button
              type="button"
              className={ICON_BUTTON}
              disabled={busy}
              aria-label={_('library.inviteRevoke')}
              title={_('library.inviteRevoke')}
              onClick={() => revoke.mutate()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 17H7A5 5 0 0 1 7 7" />
                <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
                <line x1="8" y1="12" x2="12" y2="12" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            </button>
          )}
        </div>
      )}
      {status.isError && <p role="alert" className="mt-2 text-xs text-red-600">{_('library.inviteFailed')}</p>}
    </section>
  )
}
