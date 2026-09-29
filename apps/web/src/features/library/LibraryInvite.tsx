import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'

import type { LibraryInvitePreview, MeRes } from '@bookdock/shared'

import { apiGet, apiPost } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { ME_QUERY_KEY } from '@/features/auth/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'

import { isLibraryInviteToken, PENDING_INVITE_KEY } from './invite-link'
import LibraryCounts from './components/LibraryCounts'

export default function LibraryInvite() {
  const _ = useTranslation()
  usePageTitle(_('library.invitePageTitle'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { token: routeToken } = useParams({ from: '/library/$token' })
  // The path carries a leading "+" marker; the API only ever sees the code.
  // Recomputed when the route param changes (not frozen in state) so an
  // in-place hop from one invite to another picks up the new code.
  const token = useMemo(() => {
    const fromPath = routeToken.startsWith('+') ? routeToken.slice(1) : routeToken
    return fromPath || sessionStorage.getItem(PENDING_INVITE_KEY)
  }, [routeToken])
  const valid = Boolean(token && isLibraryInviteToken(token))

  useEffect(() => {
    // The code stays in the path — that is the address the owner shared — and
    // sessionStorage is what carries it across the sign-in round-trip.
    if (token && isLibraryInviteToken(token)) {
      sessionStorage.setItem(PENDING_INVITE_KEY, token)
    } else {
      sessionStorage.removeItem(PENDING_INVITE_KEY)
    }
  }, [token])

  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiGet<{ data: MeRes }>('/auth/me'),
    retry: false,
  })
  const signedIn = Boolean(me.data && !me.data.data.guest)
  const preview = useQuery({
    queryKey: ['libraries', 'invite-preview', token],
    queryFn: () => apiPost<{ data: LibraryInvitePreview }>('/libraries/invites/preview', { token }),
    enabled: signedIn && valid,
    retry: false,
  })
  const join = useMutation({
    mutationFn: () => apiPost<{ data: { libraryId: string } }>('/libraries/invites/join', { token }),
    onSuccess: (result) => {
      sessionStorage.removeItem(PENDING_INVITE_KEY)
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      void navigate({ to: '/', search: { libraryId: result.data.libraryId }, replace: true })
    },
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4 dark:bg-stone-950 sm:p-0">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="10" width="18" height="11" rx="2" /><path d="M7 10V7a5 5 0 0 1 10 0v3" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">{_('library.invitePageTitle')}</h1>
        {!valid ? (
          <p role="alert" className="mt-3 text-sm text-stone-500 dark:text-stone-400">{_('library.inviteInvalid')}</p>
        ) : me.isPending ? (
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{_('library.inviteLoading')}</p>
        ) : !signedIn ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-stone-500 dark:text-stone-400">{_('library.inviteLoginHint')}</p>
            <Button className="mt-6 w-full" onClick={() => void navigate({ to: '/login' })}>{_('auth.signIn')}</Button>
          </>
        ) : preview.isPending ? (
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{_('library.inviteLoading')}</p>
        ) : preview.isError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">{_('library.inviteInvalid')}</p>
        ) : preview.data ? (
          <>
            <p className="mt-4 text-lg font-semibold text-stone-900 dark:text-stone-100">{preview.data.data.name}</p>
            {preview.data.data.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-500 dark:text-stone-400">{preview.data.data.description}</p>}
            <LibraryCounts
              workCount={preview.data.data.workCount}
              memberCount={preview.data.data.memberCount}
              className="mt-4 justify-center"
            />
            {join.isError && <p role="alert" className="mt-3 text-sm text-red-600">{_('library.inviteInvalid')}</p>}
            <Button
              className="mt-6 w-full"
              disabled={join.isPending}
              onClick={() => {
                if (preview.data.data.relation === 'non-member') join.mutate()
                else {
                  sessionStorage.removeItem(PENDING_INVITE_KEY)
                  void navigate({ to: '/', search: { libraryId: preview.data.data.libraryId }, replace: true })
                }
              }}
            >
              {preview.data.data.relation === 'non-member' ? _('library.inviteConfirm') : _('library.inviteEnter')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
