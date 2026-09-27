import { useState } from 'react'

import type { Library, LibraryVisibility } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useCreateLibrary } from '../hooks'

interface LibraryCreateDialogProps {
  onClose: () => void
  onCreated: (library: Library) => void
}

/**
 * 0.4.0: creating a shared library. This is the entry point the whole feature
 * was missing - without it a shared library could only exist via the API.
 * Visibility is chosen up front because it decides who can even discover the
 * library afterwards. Mounted only while open, like the other modals.
 */
export default function LibraryCreateDialog({ onClose, onCreated }: LibraryCreateDialogProps) {
  const _ = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<LibraryVisibility>('private')
  const [password, setPassword] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const createLibrary = useCreateLibrary()

  const dirty = name.trim() !== '' || description !== '' || password !== ''
  const canSubmit = name.trim().length > 0 && (visibility !== 'password' || password.length >= 4)

  function reset() {
    setName('')
    setDescription('')
    setVisibility('private')
    setPassword('')
  }

  function handleClose() {
    // A half-typed library is worth one confirmation instead of a silent loss.
    if (dirty) {
      setConfirmClose(true)
      return
    }
    reset()
    onClose()
  }

  return (
    <>
      <Modal
        title={_('library.createLibrary')}
        onClose={handleClose}
        closeLabel={_('library.close')}
        actions={
          <>
            <Button variant="secondary" onClick={handleClose}>{_('library.cancel')}</Button>
            <Button
              disabled={!canSubmit || createLibrary.isPending}
              onClick={() => createLibrary.mutate({
                body: {
                  name: name.trim(),
                  description,
                  visibility,
                  ...(visibility === 'password' ? { accessPassword: password } : {}),
                },
              }, {
                onSuccess: (res) => {
                  notify.success(_('library.createLibrarySuccess', { name: name.trim() }))
                  reset()
                  onClose()
                  onCreated((res as { data: Library }).data)
                },
                onError: (err) => notify.error(getUserErrorNotification(err, 'library.createLibraryFailed')),
              })}
            >
              {_('library.createLibrary')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-stone-600 dark:text-stone-300">
            <span>{_('library.libraryName')}</span>
            <input
              aria-label={_('library.libraryName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              autoFocus
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
              rows={3}
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
                    name="library-visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{_(`library.visibility${value[0]!.toUpperCase()}${value.slice(1)}`)}</span>
                    <span className="block text-stone-500 dark:text-stone-400">{_(`library.visibilityHint${value[0]!.toUpperCase()}${value.slice(1)}`)}</span>
                  </span>
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
                className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
              />
              <span className="text-xs text-stone-500 dark:text-stone-400">{_('library.libraryAccessPasswordHint')}</span>
            </label>
          )}
        </div>
      </Modal>

      {confirmClose && (
        <ConfirmDialog
          title={_('library.discardChanges')}
          message={_('library.discardChangesConfirm')}
          confirmLabel={_('library.discard')}
          onClose={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false)
            reset()
            onClose()
          }}
        />
      )}
    </>
  )
}
