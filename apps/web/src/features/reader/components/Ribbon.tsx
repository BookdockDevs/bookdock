import { cn } from '@/lib/utils'

interface RibbonProps {
  visible: boolean
}

export function Ribbon({ visible }: RibbonProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute right-3 top-0 z-30 transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <svg
        width="22"
        height="36"
        viewBox="0 0 24 40"
        className="drop-shadow-md"
        style={{ fill: 'var(--bd-read-primary)' }}
      >
        <polygon points="0,0 24,0 24,40 12,32 0,40" />
      </svg>
    </div>
  )
}
