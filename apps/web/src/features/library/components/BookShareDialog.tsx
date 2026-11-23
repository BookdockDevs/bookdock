import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation as useI18nTranslation } from 'react-i18next'

import { BOOK_SHARE_DURATIONS, DEFAULT_BOOK_SHARE_DURATION, type BookShareDuration, type BookShareLink } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import Badge from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Spinner from '@/components/ui/Spinner'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { getAuthSessionRevision } from '@/stores/auth.store'
import type { BookShareTarget } from '@/stores/book-share.store'

interface BookShareDialogProps {
  target: BookShareTarget
  userId: string
  onClose: () => void
}

export default function BookShareDialog({ target, userId, onClose }: BookShareDialogProps) {
  const _ = useTranslation()
  const { i18n } = useI18nTranslation()
  const sessionRevision = getAuthSessionRevision()
  const queryClient = useQueryClient()
  const durationLabelId = useId()
  const copyTimerRef = useRef<number | null>(null)
  const [draft, setDraft] = useState<BookShareDuration | null>(null)
  const [confirm, setConfirm] = useState<'regenerate' | 'revoke' | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const preferenceKey = `bd-book-share-duration:${userId}`
  const [lastDuration, setLastDuration] = useState(() => {
    try {
      const saved = localStorage.getItem(preferenceKey)
      return BOOK_SHARE_DURATIONS.find((value) => value === saved) ?? DEFAULT_BOOK_SHARE_DURATION
    } catch {
      return DEFAULT_BOOK_SHARE_DURATION
    }
  })

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const queryKey = ['book-share', userId, target.libraryId ?? null, target.versionId]
  const path = `/book-shares/books/${encodeURIComponent(target.versionId)}`
  const sourcePath = target.libraryId ? `${path}?libraryId=${encodeURIComponent(target.libraryId)}` : path
  const status = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiGet<{ data: BookShareLink | null }>(sourcePath, signal),
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.data?.expiresAt
      return expiresAt == null ? false : Math.min(2_147_483_647, Math.max(1_000, expiresAt - Date.now()))
    },
  })
  const link = status.data?.data
  const active = link && (link.expiresAt === null || link.expiresAt > Date.now()) ? link : null
  const url = active ? new URL(active.url, window.location.origin).href : null
  const duration = draft ?? active?.duration ?? lastDuration

  const generate = useMutation({
    mutationFn: (replace: boolean) => apiPost<{ data: BookShareLink }>(path, { libraryId: target.libraryId, duration, replace }),
    onSuccess: async (result, replace) => {
      await queryClient.cancelQueries({ queryKey })
      if (getAuthSessionRevision() !== sessionRevision) return
      queryClient.setQueryData(queryKey, result)
      setDraft(null)
      setCopiedUrl(null)
      setLastDuration(result.data.duration)
      try { localStorage.setItem(preferenceKey, result.data.duration) } catch { /* The current session still remembers the selection. */ }
      notify.success({ key: replace ? 'library.bookShare.regenerated' : 'library.bookShare.generated' })
    },
  })
  const revoke = useMutation({
    mutationFn: () => apiDelete<{ data: null }>(sourcePath),
    onSuccess: async (result) => {
      await queryClient.cancelQueries({ queryKey })
      if (getAuthSessionRevision() !== sessionRevision) return
      queryClient.setQueryData(queryKey, result)
      setDraft(null)
      setCopiedUrl(null)
      notify.success({ key: 'library.bookShare.revoked' })
    },
  })
  const mutating = generate.isPending || revoke.isPending
  const versionBadge = [target.versionLabel, target.format.toUpperCase()].filter(Boolean).join(' · ')
  const iconBtnClass =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-stone-600 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopiedUrl(null), 2000)
      notify.success(_('library.bookShare.copied'))
    } catch {
      notify.error(_('library.bookShare.copyFailed'))
    }
  }

  const footer = !status.isPending && !status.isError ? (
    active && url ? (
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-stone-400 dark:text-stone-500">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>
            {active.expiresAt === null ? _('library.bookShare.neverExpires') : _('library.bookShare.expiresAt', {
              date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(active.expiresAt),
            })}
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={mutating}
          onClick={() => setConfirm('revoke')}
          className="border-red-200/90 text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-400 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
            <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
            <line x1="8" y1="2" x2="8" y2="5" />
            <line x1="2" y1="8" x2="5" y2="8" />
            <line x1="16" y1="19" x2="16" y2="22" />
            <line x1="19" y1="16" x2="22" y2="16" />
          </svg>
          {_('library.bookShare.revoke')}
        </Button>
      </div>
    ) : (
      <div className="flex w-full justify-end">
        <Button
          type="button"
          size="sm"
          disabled={mutating}
          onClick={() => generate.mutate(false, {
            onError: (err) => notify.error(getUserErrorNotification(err, 'library.bookShare.saveFailed')),
          })}
        >
          {_('library.bookShare.generate')}
        </Button>
      </div>
    )
  ) : undefined

  return (
    <Modal
      title={_('library.bookShare.title', { title: target.title })}
      titleExtra={versionBadge ? <Badge>{versionBadge}</Badge> : undefined}
      footer={footer}
      onClose={onClose}
      size="default"
    >
      <div className="flex flex-col gap-4">
        {status.isPending ? (
          <div role="status" className="flex items-center gap-2 py-4 text-sm text-stone-500 dark:text-stone-400">
            <Spinner size="sm" />
            <span>{_('reader.loading')}</span>
          </div>
        ) : status.isError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{_('library.bookShare.loadFailed')}</p>
        ) : (
          <>
            <p className="text-sm text-stone-500 dark:text-stone-400">{_('library.bookShare.hint')}</p>

            <div className="flex flex-col gap-1.5">
              <span id={durationLabelId} className="text-xs font-medium text-stone-600 dark:text-stone-300">
                {_('library.bookShare.duration')}
              </span>
              <SegmentedControl
                ariaLabelledBy={durationLabelId}
                role="radiogroup"
                fullWidth
                wrap
                value={duration}
                onChange={setDraft}
                disabled={mutating}
                options={BOOK_SHARE_DURATIONS.map((value) => ({
                  value,
                  label: _(`library.bookShare.durations.${value}`),
                }))}
              />
            </div>

            {active && url && (
              <div className="flex items-center gap-2">
                <Input
                  aria-label={_('library.bookShare.link')}
                  value={url}
                  readOnly
                  size="md"
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-xl font-mono text-xs"
                />
                <button
                  type="button"
                  disabled={mutating}
                  onClick={() => setConfirm('regenerate')}
                  aria-label={_('library.bookShare.regenerate')}
                  title={_('library.bookShare.regenerate')}
                  className={iconBtnClass}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
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
                  disabled={mutating}
                  onClick={() => void copyLink()}
                  aria-label={copiedUrl === url ? _('library.bookShare.copied') : _('library.bookShare.copy')}
                  title={copiedUrl === url ? _('library.bookShare.copied') : _('library.bookShare.copy')}
                  className={iconBtnClass}
                >
                  {copiedUrl === url ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-emerald-600 dark:text-emerald-400">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={_(`library.bookShare.${confirm}`)}
          message={_(`library.bookShare.${confirm}Confirm`)}
          confirmLabel={_(`library.bookShare.${confirm}Action`)}
          confirmVariant="danger"
          confirmDisabled={mutating}
          errorFallback="library.bookShare.saveFailed"
          onConfirm={async () => {
            if (confirm === 'regenerate') await generate.mutateAsync(true)
            else await revoke.mutateAsync()
            setConfirm(null)
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  )
}
