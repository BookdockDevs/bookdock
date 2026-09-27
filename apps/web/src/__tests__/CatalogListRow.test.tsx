import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'

import i18n from '../i18n/i18n'
import CatalogListRow from '../features/library/components/CatalogListRow'
import type { CatalogBook } from '@bookdock/shared'

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
    effective: { title: 'City Book', author: 'Someone', description: '', coverKey: null },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

function work(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: null, title: 'City Book', author: 'Someone',
    description: '', coverKey: null, tags: [], versions: [version()], createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function renderRow(target: CatalogBook, opts: { selectionActive?: boolean; selected?: boolean; selection?: Set<string> } = {}) {
  const onToggleSelect = vi.fn()
  const onShowDetails = vi.fn()
  render(
    <DndContext>
      <CatalogListRow
        work={target}
        canManage
        selected={opts.selected ?? false}
        selectionActive={opts.selectionActive ?? false}
        selection={opts.selection ?? new Set()}
        dragJustEndedRef={{ current: false }}
        onToggleSelect={onToggleSelect}
        onShowDetails={onShowDetails}
      />
    </DndContext>,
  )
  return { onToggleSelect, onShowDetails }
}

/**
 * A shared library's list view draws rows, not cards: the same work data and
 * the same selection/drag rules as the grid card, only the row chrome of a
 * private list row.
 */
describe('CatalogListRow', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  it('shows the work with its version count and opens details on click', () => {
    const { onShowDetails, onToggleSelect } = renderRow(work())
    expect(screen.getByText('City Book')).toBeInTheDocument()
    expect(screen.getByText('Someone')).toBeInTheDocument()
    expect(screen.getByText('1 个版本')).toBeInTheDocument()
    fireEvent.click(screen.getByText('City Book'))
    expect(onShowDetails).toHaveBeenCalledTimes(1)
    expect(onToggleSelect).not.toHaveBeenCalled()
  })

  it('counts several versions', () => {
    renderRow(work({ versions: [version(), version({ id: 'lbv2', bookVersionId: 'v2' })] }))
    expect(screen.getByText('2 个版本')).toBeInTheDocument()
  })

  it('toggles selection instead of opening details in selection mode', () => {
    const { onShowDetails, onToggleSelect } = renderRow(work(), { selectionActive: true })
    fireEvent.click(screen.getByText('City Book'))
    expect(onToggleSelect).toHaveBeenCalledWith('lb1', false)
    expect(onShowDetails).not.toHaveBeenCalled()
  })
})
