import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import VersionSelect from '../features/library/components/VersionSelect'
import type { CatalogBook } from '@bookdock/shared'

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
    effective: { title: 'City Book', author: 'Someone', description: '', coverKey: null, bookmeta: {}, fileName: null },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, guestReadable: false, pinnedAt: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

const trigger = () => screen.getByRole('button', { name: '版本' })

describe('VersionSelect', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('hides the picker when the work holds a single version', () => {
    render(<VersionSelect versions={[version()]} selectedId="lbv1" onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '版本' })).not.toBeInTheDocument()
  })

  it('names the version on screen and opens the list on demand', () => {
    render(
      <VersionSelect
        versions={[version(), version({ id: 'lbv2', bookVersionId: 'v2', name: '修订版' })]}
        selectedId="lbv2"
        onSelect={vi.fn()}
      />,
    )
    expect(trigger()).toHaveTextContent('修订版')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()

    fireEvent.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitemradio', { name: /版本 1/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /修订版/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('falls back to ordinal labels and selects on click', () => {
    const onSelect = vi.fn()
    render(
      <VersionSelect
        versions={[version(), version({ id: 'lbv2', bookVersionId: 'v2' })]}
        selectedId="lbv1"
        onSelect={onSelect}
      />,
    )
    fireEvent.click(trigger())
    expect(screen.getByRole('menuitemradio', { name: /版本 1/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /版本 2/ }))
    expect(onSelect).toHaveBeenCalledWith('lbv2')
  })

  it('marks the default version and keeps unlisted versions selectable', () => {
    render(
      <VersionSelect
        versions={[version(), version({ id: 'lbv2', bookVersionId: 'v2', status: 'unlisted' })]}
        selectedId="lbv1"
        defaultVersionId="lbv2"
        onSelect={vi.fn()}
      />,
    )
    fireEvent.click(trigger())
    const unlisted = screen.getByRole('menuitemradio', { name: /版本 2/ })
    expect(unlisted).toHaveTextContent('默认')
    expect(screen.queryByText('已隐藏')).not.toBeInTheDocument()
  })

  it('shrinks the list to its content instead of a fixed column', () => {
    render(
      <VersionSelect
        versions={[version(), version({ id: 'lbv2', bookVersionId: 'v2', name: '修订版' })]}
        selectedId="lbv1"
        onSelect={vi.fn()}
      />,
    )
    fireEvent.click(trigger())
    const menu = document.querySelector<HTMLElement>('[data-smart-menu]')
    expect(menu).not.toBeNull()
    // 'auto' = shrink-wrap between the two bounds; a fixed width left a blank column.
    expect(menu!.className).toContain('w-max')
    expect(menu!.style.width).toBe('')
    expect(menu!.style.minWidth).toBe('148px')
    expect(menu!.style.maxWidth).toBe('280px')
  })

  it('lists names only, without format badges', () => {
    render(
      <VersionSelect
        versions={[version({ format: 'epub' }), version({ id: 'lbv2', bookVersionId: 'v2', format: 'txt' })]}
        selectedId="lbv1"
        onSelect={vi.fn()}
      />,
    )
    fireEvent.click(trigger())
    expect(screen.queryByText('EPUB')).not.toBeInTheDocument()
    expect(screen.queryByText('TXT')).not.toBeInTheDocument()
  })
})
