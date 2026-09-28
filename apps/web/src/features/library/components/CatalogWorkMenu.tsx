import { useState, type RefObject } from 'react'

import type { CatalogBook } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import type { SmartPosition } from '@/lib/position'

import { downloadDefault } from '../download'
import { useCollectBook, useUpdateCatalogVersion } from '../hooks'

import { MenuDangerItem, MenuDivider, MenuHeader, MenuItem } from './RowMenuChrome'
import DeleteVersionsDialog from './DeleteVersionsDialog'

/**
 * A work's menu, in the same language as a private book's: what it is, get it,
 * pin it, remove it. Version picking lives in the detail dialog, not here, and
 * everything the server would refuse stays off the menu - no read status
 * without a private card, no management without a manager's seat.
 */
interface CatalogWorkMenuProps {
  innerRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLElement | null>
  position: SmartPosition | null
  width: number
  onClose: () => void
  work: CatalogBook
  canManage: boolean
  canCollect: boolean
  /** Logged-in readers of a published version may download it, collected or not. */
  canDownload: boolean
  onShowDetails: () => void
}

export default function CatalogWorkMenu({ innerRef, triggerRef, position, width, onClose, work, canManage, canCollect, canDownload, onShowDetails }: CatalogWorkMenuProps) {
  const _ = useTranslation()
  const collectBook = useCollectBook()
  const updateVersion = useUpdateCatalogVersion()
  const [deleteOpen, setDeleteOpen] = useState(false)
  // The menu predates versions in the UI: one work, one version, the first one.
  const first = work.versions[0]

  function mutateVersion(patch: { pinned?: boolean }) {
    if (!first) return
    updateVersion.mutate({
      libraryId: work.libraryId,
      libraryBookId: work.id,
      versionLinkId: first.id,
      patch,
    })
  }

  return (
    <>
      <SmartMenu triggerRef={triggerRef} innerRef={innerRef} position={position} onClose={onClose} width={width}>
      <MenuHeader
        title={work.title}
        subtitle={[work.author, first?.format].filter(Boolean).join(' · ')}
      />
      <MenuItem
        label={_('library.details')}
        icon={<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>}
        onClick={onShowDetails}
      />
      {canCollect && first && first.status === 'published' && (
        <MenuItem
          label={_('library.collect')}
          icon={<><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /><line x1="12" y1="7" x2="12" y2="13" /><line x1="9" y1="10" x2="15" y2="10" /></>}
          onClick={() => {
            onClose()
            collectBook.mutate(
              { libraryId: work.libraryId, versionLinkId: first.id },
              {
                onSuccess: (res) => {
                  notify[res.data.alreadyExists ? 'info' : 'success'](
                    res.data.alreadyExists ? _('library.collectAlready') : _('library.collectSuccess'),
                  )
                },
                onError: (err) => notify.error(getUserErrorNotification(err, 'library.collectFailed')),
              },
            )
          }}
        />
      )}
      {canDownload && first && (
        <MenuItem
          label={_('library.download')}
          icon={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>}
          onClick={() => {
            onClose()
            void downloadDefault({ id: first.bookVersionId, title: first.effective.title, format: first.format }).catch((err) => {
              notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
            })
          }}
        />
      )}
      {canManage && first && (
        <MenuItem
          label={first.pinnedAt ? _('library.unpin') : _('library.pin')}
          icon={<><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>}
          onClick={() => {
            onClose()
            mutateVersion({ pinned: !first.pinnedAt })
          }}
        />
      )}
      {canManage && first && (
        <>
          <MenuDivider />
          <MenuDangerItem
            label={_('library.delete')}
            icon={<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2V6h14z" /></>}
            onClick={() => setDeleteOpen(true)}
          />
        </>
      )}
      </SmartMenu>
      {deleteOpen && (
        <DeleteVersionsDialog
          work={work}
          libraryId={work.libraryId}
          preselectedIds={work.versions.map((v) => v.id)}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false)
            onClose()
          }}
        />
      )}
    </>
  )
}
