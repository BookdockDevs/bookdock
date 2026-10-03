import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CatalogBook } from '@bookdock/shared'

import DeleteVersionsDialog from '@/features/library/components/DeleteVersionsDialog'
import i18n from '@/i18n/i18n'
import { notify } from '@/lib/notifications'

const hooks = vi.hoisted(() => ({ remove: vi.fn(), trashEnabled: true }))
vi.mock('@/features/library/hooks', () => ({
  useDeleteCatalogVersion: () => ({ mutateAsync: hooks.remove }),
  useLibraries: () => ({ data: { data: [{ id: 'lib', trashEnabled: hooks.trashEnabled }] } }),
}))
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const work: CatalogBook = {
  id: 'work', libraryId: 'lib', categoryId: null, title: 'Book', author: null,
  description: null, coverKey: null, tags: [], createdAt: 0, updatedAt: 0,
  versions: ['one', 'two', 'three'].map((id) => ({
    id, libraryBookId: 'work', bookVersionId: `book-${id}`, kind: 'personal', status: 'published',
    name: id, title: null, author: null, description: null, coverKey: null,
    effective: { title: 'Book', author: null, description: null, coverKey: null, bookmeta: {}, fileName: null },
    format: 'epub', size: 10, chapterCount: 1, wordCount: 10, guestReadable: false,
    pinnedAt: null, createdAt: 0, updatedAt: 0,
  })),
}

beforeEach(async () => {
  vi.clearAllMocks()
  hooks.remove.mockReset().mockResolvedValue({ data: null })
  hooks.trashEnabled = true
  await i18n.changeLanguage('zh-CN')
})

describe('version deletion feedback', () => {
  it.each([true, false])('reports the whole-work consequence with trash enabled=%s', async (enabled) => {
    hooks.trashEnabled = enabled
    const onDeleted = vi.fn()
    render(<DeleteVersionsDialog work={work} libraryId="lib" preselectedIds={work.versions.map((v) => v.id)} onClose={vi.fn()} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(true))
    expect(notify.success).toHaveBeenCalledWith({ key: enabled ? 'library.catalogWorkTrashed' : 'library.catalogWorkDeleted', params: { title: 'Book' } })
  })

  it('reports partial deletion, stops after rejection and retries only remaining versions', async () => {
    hooks.remove.mockResolvedValueOnce({ data: null }).mockRejectedValueOnce(new Error('Offline'))
    const onClose = vi.fn()
    const onDeleted = vi.fn()
    render(<DeleteVersionsDialog work={work} libraryId="lib" preselectedIds={['one', 'two', 'three']} onClose={onClose} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith({ key: 'library.catalogVersionsDeletePartial', params: { succeeded: 1, failed: 2 } }))
    expect(hooks.remove).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'one' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(hooks.remove).toHaveBeenCalledTimes(4))
    expect(hooks.remove.mock.calls.slice(2).map(([input]) => input.versionLinkId)).toEqual(['two', 'three'])
  })
})
