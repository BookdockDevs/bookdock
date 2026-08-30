import { useEffect, type RefObject } from 'react'

export function useDismissiblePopup(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return

    const isInside = (event: Event) => {
      const target = event.target
      return target instanceof Node && ref.current?.contains(target)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event)) onClose()
    }
    const onClick = (event: MouseEvent) => {
      if (!isInside(event)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onContentClick = () => onClose()

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('content-click', onContentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('content-click', onContentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open, ref])
}
