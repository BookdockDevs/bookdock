import type { RefObject } from 'react'

import type { CatalogBook } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'

import type { SmartPosition } from '@/lib/position'

import { MenuDivider, MenuHeader, MenuItem } from './RowMenuChrome'

/**
 * A work's menu. The same menu a book card opens, with the items a work can
 * actually answer for: what it is, and - for those who curate the library -
 * where to read its versions. Everything a private book's menu offers that needs
 * ownership (pin it, mark it read, delete it) is absent here because a work has
 * none of those, and offering an action the server would refuse is worse than
 * not offering it.
 */
interface CatalogWorkMenuProps {
  innerRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLElement | null>
  position: SmartPosition | null
  width: number
  onClose: () => void
  work: CatalogBook
  canManage: boolean
  onShowDetails: () => void
  onOpenVersions: () => void
}

export default function CatalogWorkMenu({ innerRef, triggerRef, position, width, onClose, work, canManage, onShowDetails, onOpenVersions }: CatalogWorkMenuProps) {
  const _ = useTranslation()
  return (
    <SmartMenu triggerRef={triggerRef} innerRef={innerRef} position={position} onClose={onClose} width={width}>
      <MenuHeader
        title={work.title}
        subtitle={[work.author, `${work.versions.length} ${_('library.catalogVersionUnit')}`].filter(Boolean).join(' · ')}
      />
      <MenuItem
        label={_('library.details')}
        icon={<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>}
        onClick={onShowDetails}
      />
      {canManage && (
        <>
          <MenuDivider />
          <MenuItem
            label={_('library.catalogVersions')}
            icon={<><path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 3-3h7z" /></>}
            onClick={onOpenVersions}
          />
        </>
      )}
    </SmartMenu>
  )
}
