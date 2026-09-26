import { createContext, useContext, type CSSProperties } from 'react'

export const DialogLayoutContext = createContext(0)

export function useDialogLayout() {
  const inset = useContext(DialogLayoutContext)
  return {
    className: 'left-[var(--reader-dialog-inset)]',
    style: { '--reader-dialog-inset': `${inset}px` } as CSSProperties,
  }
}
