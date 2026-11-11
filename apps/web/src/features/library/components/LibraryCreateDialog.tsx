import { useState } from 'react'

import type { Library, LibraryVisibility } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import PasswordInput from '@/components/ui/PasswordInput'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useCreateLibrary } from '../hooks'
import LibraryVisibilityField from './LibraryVisibilityField'

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
  const canSubmit = name.trim().length > 0 && (visibility !== 'password' || password.trim().length >= 4)

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

  function handleSubmit() {
    createLibrary.mutate({
      body: {
        name: name.trim(),
        description,
        visibility,
        // The gate counts trimmed length, so send the trimmed value: join
        // trims before comparing and a padded password could never match.
        ...(visibility === 'password' ? { accessPassword: password.trim() } : {}),
      },
    }, {
      onSuccess: (res) => {
        notify.success(_('library.createLibrarySuccess', { name: name.trim() }))
        reset()
        onClose()
        onCreated((res as { data: Library }).data)
      },
      onError: (err) => notify.error(getUserErrorNotification(err, 'library.createLibraryFailed')),
    })
  }

  return (
    <>
      <Modal
        title={_('library.createLibrary')}
        onClose={handleClose}
        closeLabel={_('library.close')}
        footer={
          <div className="flex w-full items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={handleClose}>
              {_('library.cancel')}
            </Button>
            <Button
              disabled={!canSubmit || createLibrary.isPending}
              onClick={handleSubmit}
            >
              {_(createLibrary.isPending ? 'passwordInput.creating' : 'library.createLibrary')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className="font-medium">{_('library.libraryName')}</span>
            <input
              aria-label={_('library.libraryName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              autoFocus
              className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
            <span className="font-medium">{_('library.libraryDescription')}</span>
            <textarea
              aria-label={_('library.libraryDescription')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="写点关于这个书库的简要介绍..."
              maxLength={2000}
              rows={3}
              className="resize-y rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
            />
          </label>

          <LibraryVisibilityField value={visibility} onChange={setVisibility} />

          {visibility === 'password' && (
            <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
              <div className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs text-stone-600 dark:text-stone-300">{_('library.libraryAccessPassword')}</span>
                </div>
                <PasswordInput
                  required
                  minLength={4}
                  validationValue={password.trim()}
                  disabled={createLibrary.isPending}
                  hint={_('library.libraryAccessPasswordMinHint')}
                  aria-label={_('library.libraryAccessPassword')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={_('library.libraryAccessPasswordPlaceholder')}
                  autoComplete="off"
                  className="font-mono tracking-wider rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                />
              </div>
            </div>
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
