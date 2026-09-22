import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ACCESS_TOKEN_PERMISSIONS } from '@bookdock/shared'
import type { AccessToken, AccessTokenCreateRes, AccessTokenListRes } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { formatDate } from '@/lib/utils'

import AccessTokenCreateDialog from './AccessTokenCreateDialog'
import AccessTokenCreatedDialog from './AccessTokenCreatedDialog'
import AccessTokenEditDialog from './AccessTokenEditDialog'
import { ACCESS_TOKEN_PERMISSION_LABEL_KEYS } from './access-token-permissions'
import SettingsCard from './SettingsCard'

export default function AccessTokensSection() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<AccessTokenCreateRes | null>(null)
  const [editing, setEditing] = useState<AccessToken | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AccessToken | null>(null)

  const tokensQuery = useQuery({
    queryKey: ['access-tokens'],
    queryFn: () => apiGet<{ data: AccessTokenListRes }>('/tokens'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiPost(`/tokens/${id}/${disabled ? 'disable' : 'enable'}`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['access-tokens'] }),
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.tokensUpdateFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/tokens/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['access-tokens'] })
      notify.success({ key: 'settings.tokensDeleted' })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.tokensDeleteFailed')),
  })

  const tokens = tokensQuery.data?.data.tokens ?? []

  return (
    <>
      <SettingsCard
        icon={<AccessTokenIcon className="h-5 w-5" />}
        iconBgClass="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
        title={_('settings.tokens')}
        description={_('settings.tokensDesc')}
      action={
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 whitespace-nowrap gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {_('settings.tokensCreate')}
        </Button>
      }
      bodyClassName="pt-3"
    >
        {tokensQuery.isError ? (
          <QueryErrorState className="py-4" isRetrying={tokensQuery.isFetching} onRetry={tokensQuery.refetch} />
        ) : tokensQuery.isLoading ? (
          <div className="flex flex-col gap-3 pt-1" aria-busy="true" aria-label={_('settings.tokensLoading')}>
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex animate-pulse flex-col gap-2 rounded-xl border border-stone-200/50 bg-stone-50/30 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-stone-800/60 dark:bg-stone-850/20"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-28 rounded-md bg-stone-200/70 dark:bg-stone-800" />
                    <div className="h-3.5 w-14 rounded-md bg-stone-200/50 dark:bg-stone-800/60" />
                  </div>
                  <div className="h-3 w-40 rounded bg-stone-200/40 dark:bg-stone-800/40" />
                </div>
                <div className="flex shrink-0 items-center">
                  <div className="h-5 w-9 rounded-full bg-stone-200/60 dark:bg-stone-800" />
                </div>
              </div>
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <div className="my-2 flex flex-col items-center justify-center rounded-xl border border-stone-200/60 bg-stone-50/30 px-4 py-6 text-center dark:border-stone-800/60 dark:bg-stone-850/20">
            <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{_('settings.tokensEmpty')}</p>
            <p className="mt-1 max-w-sm text-xs text-stone-400 dark:text-stone-500">{_('settings.tokensEmptyDesc')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-1">
            {tokens.map((token) => {
              const isExpired = token.expiresAt !== null && token.expiresAt <= Date.now()
              const isExpiringSoon =
                token.expiresAt !== null && !isExpired && token.expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000
              const isFullAccess = token.permissions.length === ACCESS_TOKEN_PERMISSIONS.length

              return (
                <div
                  key={token.id}
                  className={`group flex flex-col gap-2 rounded-xl border border-stone-200/70 bg-stone-50/40 p-3 transition-all hover:border-stone-300 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-stone-800 dark:bg-stone-850/40 dark:hover:border-stone-700 ${
                    token.disabled ? 'opacity-70' : ''
                  }`}
                  title={`${_('settings.tokensCreatedAt')} ${formatDate(token.createdAt)}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {token.name ? (
                        <>
                          <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                            {token.name}
                          </span>
                          <span className="rounded-md bg-stone-200/60 px-1.5 py-0.5 font-mono text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                            bd_…{token.tokenLast4}
                          </span>
                        </>
                      ) : (
                        <span className="font-mono text-sm font-semibold text-stone-800 dark:text-stone-200">
                          bd_…{token.tokenLast4}
                        </span>
                      )}

                      {/* Expiry / Status Pill (No badge if permanent) */}
                      {isExpired ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                          title={_('settings.tokensExpiredOn', { date: formatDate(token.expiresAt!) })}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          {_('settings.tokensExpired')}
                        </span>
                      ) : isExpiringSoon ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {_('settings.tokensExpiresShort', { date: formatDate(token.expiresAt!) })}
                        </span>
                      ) : token.expiresAt !== null ? (
                        <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                          {_('settings.tokensExpiresShort', { date: formatDate(token.expiresAt) })}
                        </span>
                      ) : null}
                    </div>

                    {/* Permissions: Full access or clean dot-separated text flow */}
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {isFullAccess ? (
                        _('settings.tokensFullAccess')
                      ) : token.permissions.length === 0 ? (
                        <span className="text-stone-400 dark:text-stone-500">
                          {_('settings.tokensNoPermissions')}
                        </span>
                      ) : (
                        token.permissions.map((p) => _(ACCESS_TOKEN_PERMISSION_LABEL_KEYS[p])).join(' · ')
                      )}
                    </p>
                  </div>

                  {/* Actions: Edit & Delete (Hover Reveal) + Toggle on the Far Right */}
                  <div className="flex shrink-0 items-center gap-2 border-t border-stone-200/50 pt-2 sm:border-t-0 sm:pt-0">
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 has-[:focus-visible]:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          if (e.detail > 0) e.currentTarget.blur()
                          setEditing(token)
                        }}
                        aria-label={_('settings.tokensEdit')}
                        title={_('settings.tokensEdit')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          if (e.detail > 0) e.currentTarget.blur()
                          setPendingDelete(token)
                        }}
                        aria-label={_('settings.tokensDelete')}
                        title={_('settings.tokensDelete')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                      >
                        <TrashIcon />
                      </button>
                      <div className="mx-1 h-3.5 w-px bg-stone-200 dark:bg-stone-700" />
                    </div>

                    <Toggle
                      checked={!token.disabled}
                      disabled={toggleMutation.isPending}
                      ariaLabel={token.disabled ? _('settings.tokensEnable') : _('settings.tokensDisable')}
                      onChange={(checked) => toggleMutation.mutate({ id: token.id, disabled: !checked })}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingsCard>

      {createOpen && (
        <AccessTokenCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(result) => {
            setCreateOpen(false)
            setCreated(result)
            void queryClient.invalidateQueries({ queryKey: ['access-tokens'] })
          }}
        />
      )}

      {created && <AccessTokenCreatedDialog result={created} onClose={() => setCreated(null)} />}

      {editing && (
        <AccessTokenEditDialog
          token={editing}
          onClose={() => setEditing(null)}
          onUpdated={() => {
            setEditing(null)
            void queryClient.invalidateQueries({ queryKey: ['access-tokens'] })
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.tokensDeleteConfirmTitle')}
          message={_('settings.tokensDeleteConfirmMessage')}
          confirmLabel={_('settings.tokensDeleteConfirmAction')}
          confirmVariant="danger"
          confirmDisabled={deleteMutation.isPending}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete.id)
            setPendingDelete(null)
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}

function AccessTokenIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 8.8-8.8" />
      <path d="m16 7 3 3" />
    </svg>
  )
}

function PlusIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}
