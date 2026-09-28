import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import VersionTabs from '../features/library/components/VersionTabs'
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

describe('VersionTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('hides the picker when the work holds a single version', () => {
    render(<VersionTabs versions={[version()]} selectedId="lbv1" onSelect={vi.fn()} />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('falls back to ordinal labels for unnamed versions and selects on click', () => {
    const onSelect = vi.fn()
    render(
      <VersionTabs
        versions={[version(), version({ id: 'lbv2', bookVersionId: 'v2', name: '修订版' })]}
        selectedId="lbv1"
        onSelect={onSelect}
      />,
    )
    expect(screen.getByRole('tab', { name: /第1版/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /修订版/ })).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(screen.getByRole('tab', { name: /修订版/ }))
    expect(onSelect).toHaveBeenCalledWith('lbv2')
  })

  it('flags unlisted versions without hiding them', () => {
    render(
      <VersionTabs
        versions={[version(), version({ id: 'lbv2', bookVersionId: 'v2', status: 'unlisted' })]}
        selectedId="lbv1"
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('已下架')).toBeInTheDocument()
  })
})
