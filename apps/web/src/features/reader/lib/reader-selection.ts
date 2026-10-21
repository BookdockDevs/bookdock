import { useReaderState } from '../state/reader-state'
import type { BookReader } from '../types'

export function clearReaderSelection(renderer: BookReader | null) {
  renderer?.clearSelection()
  useReaderState.setState({ selection: null, noteEditorRange: null })
}
