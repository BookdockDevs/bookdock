import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import SmartMenu from '@/components/ui/SmartMenu'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import ChangePasswordDialog from './ChangePasswordDialog'
import { useInstanceInfo, useLogout } from './hooks'

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'

const iconClass = 'shrink-0 text-stone-400 dark:text-stone-500'

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

function SignInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  )
}

export default function AccountMenu() {
  const _ = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { data: instanceData } = useInstanceInfo()
  const logout = useLogout()
  const menu = useContextMenu()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)

  const instance = instanceData?.data
  // Guest = server injected the default passwordless user: the me payload is
  // flagged, or there is no local session while guest access is on.
  const isGuest = user?.role === 'guest' || user?.guest === true || (!user && Boolean(instance?.allowGuestAccess))

  if (!user && !isGuest) return null

  const username = user?.username ?? _('auth.guest')
  const menuHeight = isGuest ? 88 : 116

  return (
    <>
      <button
        ref={menu.btnRef}
        type="button"
        onClick={() => menu.openFromButton()}
        onContextMenu={(e) => {
          e.preventDefault()
          menu.openFromEvent(e)
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-stone-200/50 dark:hover:bg-stone-800/50"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-300/80 text-xs font-semibold uppercase text-stone-700 dark:bg-stone-700 dark:text-stone-200">
          {username.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-stone-700 dark:text-stone-200">
          {username}
        </span>
        {isGuest && (
          <span className="shrink-0 rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
            {_('auth.guest')}
          </span>
        )}
      </button>

      <SmartMenu innerRef={menu.menuRef} position={menu.position(176, menuHeight)} onClose={menu.close}>
        <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
          <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{username}</p>
          <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
            {isGuest ? _('auth.guest') : user?.role === 'owner' ? _('auth.roleOwner') : _('auth.roleMember')}
          </p>
        </div>
        {isGuest ? (
          !instance?.initialized ? (
            <button
              type="button"
              onClick={() => {
                menu.close()
                navigate({ to: '/setup' })
              }}
              className={menuItemClass}
            >
              <KeyIcon />
              {_('auth.setPassword')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                menu.close()
                navigate({ to: '/login' })
              }}
              className={menuItemClass}
            >
              <SignInIcon />
              {_('auth.signIn')}
            </button>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                menu.close()
                setChangePasswordOpen(true)
              }}
              className={menuItemClass}
            >
              <KeyIcon />
              {_('auth.changePassword')}
            </button>
            <button
              type="button"
              onClick={() => {
                menu.close()
                logout.mutate()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <SignOutIcon />
              {_('auth.signOut')}
            </button>
          </>
        )}
      </SmartMenu>

      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </>
  )
}
