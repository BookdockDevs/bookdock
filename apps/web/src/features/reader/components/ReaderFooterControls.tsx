import { cn } from '@/lib/utils'

import TimerPill from './TimerPill'
import TtsPill from './TtsPill'
import MediaOverlayPill from './MediaOverlayPill'
import type { ReaderPlaybackCoordinator } from '../lib/playback-coordinator'

interface ReaderFooterControlsProps {
  bookId: string
  footerVisible: boolean
  isTouch: boolean
  mobileDockVisible: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
  readingTimerMode: string
  coordinator?: ReaderPlaybackCoordinator
}

export default function ReaderFooterControls({
  bookId,
  footerVisible,
  isTouch,
  mobileDockVisible,
  onPointerEnter,
  onPointerLeave,
  readingTimerMode,
  coordinator,
}: ReaderFooterControlsProps) {
  return (
    <div
      data-reader-corner-control=""
      className={cn(
        'absolute right-0 z-[60] flex h-24 w-max max-w-[calc(100vw-1rem)] items-end justify-end transition-[bottom,translate] duration-300 pointer-events-none',
        mobileDockVisible
          ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
          : 'bottom-[env(safe-area-inset-bottom)]',
        footerVisible ? '-translate-y-12' : 'translate-y-full',
      )}
    >
      <div
        data-toast-obstacle={footerVisible ? 'contents' : undefined}
        className="pointer-events-auto mb-3 mr-3 flex items-center gap-2 sm:mr-4"
        onPointerEnter={isTouch ? undefined : onPointerEnter}
        onPointerLeave={isTouch ? undefined : onPointerLeave}
      >
        {(readingTimerMode === 'manual' || readingTimerMode === 'both') && <TimerPill bookId={bookId} inline />}
        <TtsPill inline />
        {coordinator && <MediaOverlayPill coordinator={coordinator} inline />}
      </div>
    </div>
  )
}
