import { useRef, useState } from 'react'

import MenuFlyout from '@/components/ui/MenuFlyout'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeFromAnchor, type SmartPosition } from '@/lib/position'

import { ActionIcon } from './ui'

/**
 * The download control with its edited/original export split. A TXT book opens
 * the split; anything else downloads straight through, so the caller only has to
 * say which file it means.
 */
interface DownloadMenuProps {
  format: string
  /** Whether effective replacement rules exist, which is what makes "edited" worth offering. */
  canExportEdited: boolean
  onDownloadFile: () => void
  onExport: (format: 'epub' | 'txt', plain: boolean) => void
}

export default function DownloadMenu({ format, canExportEdited, onDownloadFile, onExport }: DownloadMenuProps) {
  const _ = useTranslation()
  const [menu, setMenu] = useState<SmartPosition | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function toggleMenu() {
    const el = anchorRef.current
    if (!el) return
    if (menu) {
      setMenu(null)
      return
    }
    const rect = el.getBoundingClientRect()
    setMenu(
      computeFromAnchor(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        176,
        96,
      ),
    )
  }

  return (
    <div ref={anchorRef} className="relative">
      <ActionIcon
        secondary
        label={_('library.download')}
        onClick={format === 'txt' ? toggleMenu : onDownloadFile}
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </ActionIcon>
      {menu && format === 'txt' && (
        <SmartMenu innerRef={menuRef} position={menu} onClose={() => setMenu(null)}>
          {canExportEdited && (
            <MenuFlyout
              panelWidth={96}
              row={({ open, flip, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10 ${open ? 'bg-stone-500/10' : ''}`}
                >
                  <span className="flex-1">{_('library.edited')}</span>
                  <FlyoutChevron flip={flip} />
                </button>
              )}
            >
              {(close) => (
                <ExportFormats
                  onPick={(picked) => {
                    close()
                    onExport(picked, false)
                  }}
                />
              )}
            </MenuFlyout>
          )}
          <MenuFlyout
            panelWidth={96}
            row={({ open, flip, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10 ${open ? 'bg-stone-500/10' : ''}`}
              >
                <span className="flex-1">{_('library.original')}</span>
                <FlyoutChevron flip={flip} />
              </button>
            )}
          >
            {(close) => (
              <ExportFormats
                onPick={(picked) => {
                  close()
                  onExport(picked, true)
                }}
              />
            )}
          </MenuFlyout>
        </SmartMenu>
      )}
    </div>
  )
}

function FlyoutChevron({ flip }: { flip: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-stone-400 transition-transform ${flip ? 'rotate-180' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

const exportItemClass =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10'

function ExportFormats({ onPick }: { onPick: (format: 'epub' | 'txt') => void }) {
  return (
    <>
      <button type="button" onClick={() => onPick('epub')} className={exportItemClass}>
        EPUB
      </button>
      <button type="button" onClick={() => onPick('txt')} className={exportItemClass}>
        TXT
      </button>
    </>
  )
}
