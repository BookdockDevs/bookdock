import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookListItem, FileMetadataSourceRes } from '@bookdock/shared'

import { ApiError } from '../api/client'
import MetadataFieldDialog from '../features/library/components/book-detail/MetadataFieldDialog'
import i18n from '../i18n/i18n'

const hooks = vi.hoisted(() => ({ useBookMetadataSource: vi.fn(), useUpdateBook: vi.fn(), useUpdateCatalogVersion: () => ({ isPending: false }), useCatalogVersionMetadataSource: () => ({ data: undefined }) }))
vi.mock('../features/library/hooks', () => hooks)

const source: FileMetadataSourceRes = {
  kind: 'file', format: 'epub', fileName: 'file.epub', normalizeTitleApplied: false,
  values: { title: 'File Title', authors: null, description: null, publisher: null, published: null, language: null, isbn: null, subjects: null, series: null, seriesIndex: null },
  provenance: { title: 'file', authors: 'missing', description: 'missing', publisher: 'missing', published: 'missing', language: 'missing', isbn: 'missing', subjects: 'missing', series: 'missing', seriesIndex: 'missing' },
}

describe('single-field source restore freshness', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    hooks.useUpdateBook.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
  })

  it('reuses the field icon preview and restores only the draft until save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn()
    hooks.useUpdateBook.mockReturnValue({ isPending: false, mutateAsync: save })
    hooks.useBookMetadataSource.mockReturnValue({ data: { data: source }, isFetching: false, isError: false })
    render(<MetadataFieldDialog book={{ id: 'v1', title: 'My Title', author: '' }} field="title" label="书名" onClose={close} />)

    const restore = screen.getByRole('button', { name: '恢复文件值' })
    expect(restore.querySelector('svg')).not.toBeNull()
    expect(restore).toHaveTextContent('')
    fireEvent.focus(restore)
    expect(screen.getByText('File Title')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('My Title')
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(restore)
    expect(screen.getByRole('textbox')).toHaveValue('File Title')
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ bookId: 'v1', title: 'File Title' }))
  })

  it('shows the restore icon only when the source has a different value', () => {
    hooks.useBookMetadataSource.mockReturnValue({ data: { data: source }, isFetching: false, isError: false })
    const props = { book: { id: 'v1', title: 'File Title', author: '' }, field: 'title' as const, label: '书名', onClose: vi.fn() }
    const { rerender } = render(<MetadataFieldDialog {...props} />)
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Draft' } })
    expect(screen.getByRole('button', { name: '恢复文件值' })).toBeInTheDocument()
    hooks.useBookMetadataSource.mockReturnValue({ data: { data: { ...source, values: { ...source.values, title: null } } }, isFetching: false, isError: false })
    rerender(<MetadataFieldDialog {...props} />)
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('My Draft')
  })

  it.each([true, false])('retains the draft and rejects cached source while fetching or denied (%s)', (fetching) => {
    hooks.useBookMetadataSource.mockReturnValue({ data: { data: source }, isFetching: false, isError: false })
    const props = { book: { id: 'v1', title: 'My Title', author: '' } as BookListItem, field: 'title' as const, label: '书名', onClose: vi.fn() }
    const { rerender } = render(<MetadataFieldDialog {...props} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Draft' } })
    hooks.useBookMetadataSource.mockReturnValue({ data: { data: source }, isFetching: fetching, isError: !fetching, error: new ApiError('BOOK_FILE_MISSING', 'missing'), refetch: vi.fn() })
    rerender(<MetadataFieldDialog {...props} />)
    expect(screen.getByRole('textbox')).toHaveValue('My Draft')
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    if (!fetching) expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('errors.bookFileMissing'))
  })
})
