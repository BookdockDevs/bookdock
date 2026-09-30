import type { RefObject } from 'react'

import type { CatalogBook } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { formatAuthorList } from '@/lib/utils'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import type { SmartPosition } from '@/lib/position'

import { downloadDefault } from '../download'
import { useCollectBook, useUpdateCatalogBook } from '../hooks'

import { MenuDangerItem, MenuDivider, MenuHeader, MenuItem } from './RowMenuChrome'

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
  /** Parent closes the menu and opens the version-delete dialog (which must
   * live outside the menu subtree, or closing the menu unmounts it). */
  onDeleteRequest: () => void
}

export default function CatalogWorkMenu({ innerRef, triggerRef, position, width, onClose, work, canManage, canCollect, canDownload, onShowDetails, onDeleteRequest }: CatalogWorkMenuProps) {
  const _ = useTranslation()
  const collectBook = useCollectBook()
  const updateWork = useUpdateCatalogBook()
  // The menu predates versions in the UI: one work, one version, the first one.
  const first = work.versions[0]
  const hidden = work.hidden || (work.versions.length === 1 && first?.status === 'unlisted')

  return (
    <>
      <SmartMenu triggerRef={triggerRef} innerRef={innerRef} position={position} onClose={onClose} width={width}>
      <MenuHeader
        title={work.title}
        subtitle={[formatAuthorList(work.authors, work.author), first?.format].filter(Boolean).join(' · ')}
      />
      <MenuItem
        label={_('library.details')}
        icon={<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>}
        onClick={onShowDetails}
      />
      {canCollect && first && (first.status === 'published' || canManage) && (
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
      {canManage && (
        <MenuItem
          label={work.pinnedAt ? _('library.unpin') : _('library.pin')}
          icon={<><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>}
          onClick={() => {
            onClose()
            updateWork.mutate({ libraryId: work.libraryId, libraryBookId: work.id, patch: { pinned: !work.pinnedAt } })
          }}
        />
      )}
      {canManage && (
        <MenuItem
          label={hidden ? _('library.catalogShowWork') : _('library.catalogHideWork')}
          disabled={updateWork.isPending}
          icon={hidden ? (
            <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></>
          ) : (
            <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>
          )}
          onClick={() => {
            const showing = hidden
            onClose()
            updateWork.mutate({
              libraryId: work.libraryId,
              libraryBookId: work.id,
              patch: { hidden: !hidden },
            }, {
              onSuccess: () => notify.success(showing ? _('library.catalogShowWork') : _('library.catalogHideWork')),
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogHideWork')),
            })
          }}
        />
      )}
      {canManage && first && (
        <>
          <MenuDivider />
          <MenuDangerItem
            label={_('library.delete')}
            icon={<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2V6h14z" /></>}
            onClick={() => onDeleteRequest()}
          />
        </>
      )}
      </SmartMenu>
    </>
  )
}
