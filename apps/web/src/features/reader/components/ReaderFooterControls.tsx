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
      className={cn(
        'absolute right-0 z-[60] flex h-24 w-max max-w-[calc(100vw-1rem)] items-end justify-end gap-2 pb-3 pr-3 transition-[bottom,translate] duration-300',
        mobileDockVisible
          ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
          : 'bottom-[env(safe-area-inset-bottom)]',
        isTouch
          ? footerVisible ? '-translate-y-10 pointer-events-auto' : 'translate-y-full pointer-events-none'
          : footerVisible ? '-translate-y-10 pointer-events-auto' : 'pointer-events-auto',
      )}
      onPointerEnter={isTouch ? undefined : onPointerEnter}
      onPointerLeave={isTouch ? undefined : onPointerLeave}
    >
      {readingTimerMode === 'manual' && <TimerPill bookId={bookId} inline />}
      <TtsPill inline />
      {coordinator && <MediaOverlayPill coordinator={coordinator} inline />}
    </div>
  )
}
