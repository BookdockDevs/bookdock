import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useDeleteAvatar, useUploadAvatar } from '@/features/auth/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

const MAX_AVATAR_SIDE = 512

// Scale the longest side down to MAX_AVATAR_SIDE, keeping the original format.
// Canvas cannot re-encode GIF (animation would be lost), so GIFs upload as-is.
async function compressAvatar(file: File): Promise<File> {
  if (file.type === 'image/gif') return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_AVATAR_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type))
  return blob ? new File([blob], file.name, { type: file.type }) : file
}

interface ProfileAccountSectionProps {
  onOpenSettings?: () => void
}

export default function ProfileAccountSection({ onOpenSettings }: ProfileAccountSectionProps = {}) {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const uploadAvatar = useUploadAvatar()
  const deleteAvatar = useDeleteAvatar()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [removeAvatarOpen, setRemoveAvatarOpen] = useState(false)

  // Preview URLs are object URLs; revoke on unmount to avoid leaking them
  useEffect(() => {
    return () => {
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return null
      })
    }
  }, [])

  async function onFileSelected(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    // Reset so picking the same file again still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = ''
    try {
      const compressed = await compressAvatar(file)
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return { file: compressed, url: URL.createObjectURL(compressed) }
      })
    } catch {
      notify.error({ key: 'settings.avatarProcessFailed' })
    }
  }

  function onCancelPreview() {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  async function onUploadPreview() {
    if (!preview) return
    try {
      await uploadAvatar.mutateAsync(preview.file)
      URL.revokeObjectURL(preview.url)
      setPreview(null)
      notify.success({ key: 'settings.avatarUpdated' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'settings.profileUpdateFailed'))
    }
  }

  function onRemoveAvatar() {
    setRemoveAvatarOpen(true)
  }

  function confirmRemoveAvatar() {
    deleteAvatar.mutate(undefined, {
      onSuccess: () => notify.success({ key: 'settings.avatarRemoved' }),
      onError: (err) => notify.error(getUserErrorNotification(err, 'settings.profileDeleteFailed')),
    })
    setRemoveAvatarOpen(false)
  }


  const url = avatarUrl(user?.avatarKey)
  const memberDays = user?.createdAt
    ? Math.max(1, Math.floor((Date.now() - user.createdAt) / (24 * 3600 * 1000)))
    : null

  return (
    <section className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
      {/* Decorative Atmosphere Banner */}
      <div className="relative h-24 w-full overflow-hidden bg-gradient-to-r from-stone-200 via-amber-100/50 to-stone-300/70 sm:h-32 dark:from-stone-800 dark:via-stone-850 dark:to-stone-700/60">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.4),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.05),transparent_70%)]" />
        <div className="absolute -right-6 -top-6 h-36 w-36 rounded-full bg-white/20 blur-xl dark:bg-white/5" />
      </div>

      {/* Main Hero Card Body */}
      <div className="relative px-4 pb-5 pt-0 sm:px-6 sm:pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
            {/* Large Avatar with hover reveal controls */}
            <div className="group relative -mt-12 h-20 w-20 shrink-0 sm:-mt-14 sm:h-24 sm:w-24">
              <div className="h-full w-full overflow-hidden rounded-full ring-4 ring-white shadow-md transition-shadow group-hover:shadow-lg dark:ring-stone-900">
                {preview ? (
                  <img src={preview.url} alt={_('settings.avatar')} className="h-full w-full object-cover" />
                ) : url ? (
                  <img src={url} alt={_('settings.avatar')} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-200 to-stone-300 text-2xl font-bold uppercase text-stone-700 dark:from-stone-700 dark:to-stone-800 dark:text-stone-200">
                    {(user?.username ?? '').slice(0, 1)}
                  </span>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => void onFileSelected(e.target.files)}
              />

              {/* Hover overlay button to change avatar */}
              <button
                type="button"
                aria-label={_('settings.avatarChange')}
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-stone-950/60 text-white opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100 cursor-pointer"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="mt-1 text-[10px] font-medium leading-tight">{_('settings.avatarChange')}</span>
              </button>

              {/* Hover remove button if avatar is set */}
              {url && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveAvatar()
                  }}
                  title={_('settings.avatarRemove')}
                  aria-label={_('settings.avatarRemove')}
                  className="absolute -right-0.5 -top-0.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-stone-300 shadow-sm opacity-0 ring-2 ring-white transition-all hover:bg-red-600 hover:text-white group-hover:opacity-100 cursor-pointer dark:bg-stone-700 dark:ring-stone-900"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span className="sr-only">{_('settings.avatarRemove')}</span>
                </button>
              )}
            </div>

            {/* Profile Info & Name */}
            <div className="min-w-0 pb-1">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-100">
                    {user?.username}
                  </span>
                  <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                    {user?.role === 'owner' ? _('auth.roleOwner') : user?.role === 'guest' ? _('auth.guest') : _('auth.roleMember')}
                  </span>
                </div>

                  {memberDays !== null && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                        <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" x2="21" y1="10" y2="10" />
                      </svg>
                      <span>{_('profile.memberDays', { days: memberDays })}</span>
                    </p>
                  )}
                </div>
            </div>
          </div>

          {/* Action Buttons: Password & Avatar Preview confirmation */}
          <div className="flex shrink-0 items-center gap-2.5 pb-1">
            {preview ? (
              <>
                <Button size="sm" disabled={uploadAvatar.isPending} onClick={() => void onUploadPreview()}>
                  {_('settings.avatarUpload')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelPreview}>
                  {_('library.cancel')}
                </Button>
              </>
            ) : onOpenSettings ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={onOpenSettings}
                className="flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>{_('profile.settings')}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {removeAvatarOpen && (
        <ConfirmDialog
          title={_('settings.confirmRemoveTitle')}
          message={_('settings.avatarRemoveConfirm')}
          confirmLabel={_('settings.confirmRemoveAction')}
          onConfirm={confirmRemoveAvatar}
          onClose={() => setRemoveAvatarOpen(false)}
        />
      )}
    </section>
  )
}

