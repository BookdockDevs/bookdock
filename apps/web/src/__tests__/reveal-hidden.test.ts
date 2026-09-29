import { describe, expect, it } from 'vitest'

import { withReveal } from '@/lib/reveal-hidden'
import { useUiStore } from '@/stores/ui.store'

describe('withReveal', () => {
  it('leaves paths untouched while reveal mode is off', () => {
    useUiStore.setState({ revealHidden: false })
    expect(withReveal('/shelves')).toBe('/shelves')
    expect(withReveal('/books/abc/file?reader=1&v=1')).toBe('/books/abc/file?reader=1&v=1')
  })

  it('appends the vault flag while reveal mode is on', () => {
    useUiStore.setState({ revealHidden: true })
    expect(withReveal('/shelves')).toBe('/shelves?showHidden=1')
    expect(withReveal('/books/abc/file?reader=1&v=1')).toBe('/books/abc/file?reader=1&v=1&showHidden=1')
    useUiStore.setState({ revealHidden: false })
  })
})
