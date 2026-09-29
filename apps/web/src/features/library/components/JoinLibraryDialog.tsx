import { useState } from 'react'

import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useJoinLibrary } from '../hooks'

interface JoinLibraryDialogProps {
  open: boolean
  libraryId: string
  /** Password-protected libraries ask for it; a public one joins on confirm. */
  needsPassword: boolean
  onClose: () => void
}

/**
 * Joining is the one thing about a library that cannot live on its row: a
 * password-protected library needs somewhere to type it. Everything else about a
 * library - who owns it, who can see it, how to leave it - is in that row's own
 * menu, exactly like a private library's settings. The library is not named
 * again here: the reader just picked it out of a list that says the name.
 */
export default function JoinLibraryDialog({ open, libraryId, needsPassword, onClose }: JoinLibraryDialogProps) {
  const _ = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const join = useJoinLibrary()

  if (!open) return null

  // A wrong password is the expected failure here, not an exception: say which
  // one it was, next to the field, and let the reader try again.
  function submit() {
    setError(null)
    join.mutate(needsPassword && password.trim() ? { libraryId, accessPassword: password.trim() } : { libraryId }, {
      onSuccess: () => {
        setPassword('')
        notify.success(_('library.joinLibrarySuccess'))
        onClose()
      },
      onError: (err) => {
        setError(getUserErrorMessage(err, _, 'library.joinFailed'))
        notify.error(getUserErrorNotification(err, 'library.joinFailed'))
      },
    })
  }

  return (
    <Modal title={_('library.joinLibrary')} onClose={onClose} size="sm">
      <div className="mt-1 flex flex-col gap-3">
        {needsPassword && (
          <>
            <input
              type="password"
              aria-label={_('library.joinPasswordPlaceholder')}
              aria-invalid={Boolean(error)}
              placeholder={_('library.joinPasswordPlaceholder')}
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password.trim() && !join.isPending) submit()
              }}
              className="h-11 min-w-0 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none placeholder:text-stone-400 aria-invalid:border-red-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            />
            {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-xl bg-stone-100 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
        >
          {_('library.cancel')}
        </button>
        <button
          type="button"
          disabled={join.isPending || (needsPassword && !password.trim())}
          onClick={submit}
          className="h-11 flex-1 rounded-xl bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {join.isPending ? _('library.joining') : _('library.joinLibrary')}
        </button>
      </div>
    </Modal>
  )
}
