import { useEffect, useState } from 'react'

import type { Library, LibraryVisibility, MembershipRole } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import {
  useAddLibraryMember,
  useDeleteLibrary,
  useLibraryMembers,
  useRemoveLibraryMember,
  useSetLibraryMemberRole,
  useTransferLibrary,
  useUpdateLibrary,
} from '../hooks'

interface LibraryManageDialogProps {
  library: Library
  /** True for owners and admins, who may edit settings and the roster. */
  canManage: boolean
  isOwner: boolean
  onClose: () => void
  onDeleted: () => void
}

type Danger = 'delete' | 'transfer' | null

/**
 * 0.4.0: library management. Settings and membership for owners and admins,
 * plus the two irreversible actions behind an explicit confirmation that names
 * the consequence - deleting a library leaves members' collected copies in place
 * but unreadable, and that must never happen by surprise.
 */
export default function LibraryManageDialog({ library, canManage, isOwner, onClose, onDeleted }: LibraryManageDialogProps) {
  const _ = useTranslation()
  const [name, setName] = useState(library.name)
  const [description, setDescription] = useState(library.description)
  const [visibility, setVisibility] = useState<LibraryVisibility>(library.visibility ?? 'private')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [newRole, setNewRole] = useState<MembershipRole>('member')
  const [danger, setDanger] = useState<Danger>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState('')

  const membersQuery = useLibraryMembers(canManage ? library.id : null)
  const updateLibrary = useUpdateLibrary()
  const addMember = useAddLibraryMember()
  const setMemberRole = useSetLibraryMemberRole()
  const removeMember = useRemoveLibraryMember()
  const transferLibrary = useTransferLibrary()
  const deleteLibrary = useDeleteLibrary()

  // Settings are edited from the library we were handed; keep them in sync when
  // another surface (another tab) changed it.
  useEffect(() => {
    setName(library.name)
    setDescription(library.description)
    setVisibility(library.visibility ?? 'private')
  }, [library])

  const owner = membersQuery.data?.data.owner
  const members = membersQuery.data?.data.members ?? []
  const settingsChanged = name !== library.name
    || description !== library.description
    || visibility !== (library.visibility ?? 'private')

  function reportError(err: unknown, fallback: string) {
    notify.error(getUserErrorNotification(err, fallback))
  }

  return (
    <>
      <Modal
        title={_('library.manageLibrary')}
        onClose={onClose}
        closeLabel={_('library.close')}
        size="wide"
        actions={
          canManage ? (
            <Button
              disabled={!settingsChanged || name.trim().length === 0 || updateLibrary.isPending}
              onClick={() => updateLibrary.mutate({
                libraryId: library.id,
                patch: {
                  name: name.trim(),
                  description,
                  visibility,
                  ...(visibility === 'password' ? { accessPassword: password.length >= 4 ? password : null } : {}),
                },
              }, {
                onSuccess: () => {
                  setPassword('')
                  notify.success(_('library.librarySettingsSaved'))
                },
                onError: (err) => reportError(err, 'library.librarySettingsSaveFailed'),
              })}
            >
              {_('library.save')}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-6">
          {canManage && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">{_('library.librarySettings')}</h3>
              <label className="flex flex-col gap-1.5 text-sm text-stone-600 dark:text-stone-300">
                <span>{_('library.libraryName')}</span>
                <input
                  aria-label={_('library.libraryName')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-stone-600 dark:text-stone-300">
                <span>{_('library.libraryDescription')}</span>
                <textarea
                  aria-label={_('library.libraryDescription')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
                />
              </label>
              <div className="flex flex-col gap-1.5 text-sm text-stone-600 dark:text-stone-300">
                <span>{_('library.libraryVisibility')}</span>
                <div className="flex flex-col gap-1.5">
                  {(['private', 'password', 'public'] as const).map((value) => (
                    <label key={value} className="flex items-start gap-2 text-xs">
                      <input
                        type="radio"
                        name="manage-library-visibility"
                        value={value}
                        checked={visibility === value}
                        onChange={() => setVisibility(value)}
                        className="mt-0.5"
                      />
                      <span>{_(`library.visibility${value[0]!.toUpperCase()}${value.slice(1)}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
              {visibility === 'password' && (
                <label className="flex flex-col gap-1.5 text-sm text-stone-600 dark:text-stone-300">
                  <span>{_('library.libraryAccessPassword')}</span>
                  <input
                    type="password"
                    aria-label={_('library.libraryAccessPassword')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={_('library.libraryAccessPasswordKeep')}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
                  />
                  <span className="text-xs text-stone-500 dark:text-stone-400">{_('library.libraryAccessPasswordHint')}</span>
                </label>
              )}
            </section>
          )}

          {canManage && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">{_('library.libraryMembers')}</h3>
              {owner && (
                <div className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700">
                  <span className="truncate text-stone-700 dark:text-stone-200">{owner.username}</span>
                  <span className="shrink-0 text-xs text-stone-400">{_('library.relationOwner')}</span>
                </div>
              )}
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700">
                  <span className="min-w-0 truncate text-stone-700 dark:text-stone-200">{member.username}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <select
                      aria-label={_('library.memberRole')}
                      value={member.role}
                      onChange={(e) => setMemberRole.mutate({
                        libraryId: library.id, userId: member.userId, role: e.target.value as MembershipRole,
                      }, { onError: (err) => reportError(err, 'library.memberRoleChangeFailed') })}
                      // Only the owner moves seats around; admins manage members.
                      disabled={!isOwner || setMemberRole.isPending}
                      className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-xs dark:border-stone-600 dark:bg-stone-900"
                    >
                      <option value="member">{_('library.relationMember')}</option>
                      <option value="admin">{_('library.relationAdmin')}</option>
                    </select>
                    <button
                      type="button"
                      aria-label={_('library.removeMember')}
                      onClick={() => setRemoveTarget(member.userId)}
                      // Only the owner removes admins; admins manage members.
                      disabled={!isOwner && member.role === 'admin'}
                      className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:text-red-300"
                    >
                      {_('library.removeMember')}
                    </button>
                  </span>
                </div>
              ))}
              {members.length === 0 && (
                <p className="text-xs text-stone-500 dark:text-slate-400">{_('library.noMembersYet')}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={_('library.memberUsernamePlaceholder')}
                  aria-label={_('library.memberUsernamePlaceholder')}
                  className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-stone-400 dark:border-stone-600 dark:bg-stone-900"
                />
                <select
                  aria-label={_('library.addMemberRole')}
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as MembershipRole)}
                  // Only the owner hands out admin seats; admins add members.
                  disabled={!isOwner}
                  className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs dark:border-stone-600 dark:bg-stone-900"
                >
                  <option value="member">{_('library.relationMember')}</option>
                  {isOwner && <option value="admin">{_('library.relationAdmin')}</option>}
                </select>
                <Button
                  size="sm"
                  disabled={username.trim().length === 0 || addMember.isPending}
                  onClick={() => addMember.mutate({
                    libraryId: library.id, username: username.trim(), role: newRole,
                  }, {
                    onSuccess: () => {
                      setUsername('')
                      notify.success(_('library.memberAdded'))
                    },
                    onError: (err) => reportError(err, 'library.memberAddFailed'),
                  })}
                >
                  {_('library.addMember')}
                </Button>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">{_('library.dangerZone')}</h3>
            {isOwner ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={_('library.transferOwner')}
                    value={transferTarget}
                    onChange={(e) => setTransferTarget(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs dark:border-stone-600 dark:bg-stone-900"
                  >
                    <option value="">{_('library.transferOwnerPick')}</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.userId}>{member.username}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!transferTarget || transferLibrary.isPending}
                    onClick={() => setDanger('transfer')}
                  >
                    {_('library.transferOwner')}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deleteLibrary.isPending}
                  onClick={() => setDanger('delete')}
                >
                  {_('library.deleteLibrary')}
                </Button>
              </>
            ) : (
              <p className="text-xs text-stone-500 dark:text-slate-400">{_('library.ownerOnlyActions')}</p>
            )}
          </section>
        </div>
      </Modal>

      {danger === 'delete' && (
        <ConfirmDialog
          title={_('library.deleteLibrary')}
          message={_('library.deleteLibraryConfirm', { name: library.name })}
          confirmLabel={_('library.deleteLibrary')}
          onClose={() => setDanger(null)}
          onConfirm={() => {
            setDanger(null)
            deleteLibrary.mutate({ libraryId: library.id }, {
              onSuccess: () => {
                notify.success(_('library.deleteLibrarySuccess'))
                onDeleted()
              },
              onError: (err) => reportError(err, 'library.deleteLibraryFailed'),
            })
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          title={_('library.removeMember')}
          message={_('library.removeMemberConfirm')}
          confirmLabel={_('library.removeMember')}
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => {
            const userId = removeTarget
            setRemoveTarget(null)
            removeMember.mutate({ libraryId: library.id, userId }, {
              onSuccess: () => notify.success(_('library.memberRemoved')),
              onError: (err) => reportError(err, 'library.removeMemberFailed'),
            })
          }}
        />
      )}

      {danger === 'transfer' && (
        <ConfirmDialog
          title={_('library.transferOwner')}
          message={_('library.transferOwnerConfirm')}
          confirmLabel={_('library.transferOwner')}
          onClose={() => setDanger(null)}
          onConfirm={() => {
            setDanger(null)
            if (!transferTarget) return
            transferLibrary.mutate({ libraryId: library.id, userId: transferTarget }, {
              onSuccess: () => {
                notify.success(_('library.transferOwnerSuccess'))
                setTransferTarget('')
              },
              onError: (err) => reportError(err, 'library.transferOwnerFailed'),
            })
          }}
        />
      )}
    </>
  )
}
