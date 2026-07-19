import { createContext, useContext } from 'react'
import type { BookReader } from '../types'

export const RendererContext = createContext<{ renderer: BookReader | null }>({ renderer: null })

export function useReaderApi() {
  return useContext(RendererContext)
}
