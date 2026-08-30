import { cn } from '@/lib/utils'

import TimerPill from './TimerPill'
import TtsPill from './TtsPill'

interface ReaderFooterControlsProps {
  bookId: string
  footerVisible: boolean
  isTouch: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
  readingTimerMode: string
}

export default function ReaderFooterControls({
  bookId,
  footerVisible,
  isTouch,
  onPointerEnter,
  onPointerLeave,
  readingTimerMode,
}: ReaderFooterControlsProps) {
  return (
    <div
      className={cn(
        'absolute bottom-0 right-0 flex h-24 w-max max-w-[calc(100vw-1rem)] items-end justify-end gap-2 pointer-events-auto pb-3 pr-3 transition-transform duration-300',
        footerVisible && '-translate-y-10',
      )}
      onPointerEnter={isTouch ? undefined : onPointerEnter}
      onPointerLeave={isTouch ? undefined : onPointerLeave}
    >
      {readingTimerMode === 'manual' && <TimerPill bookId={bookId} inline />}
      <TtsPill inline />
    </div>
  )
}
