import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BookClassificationEditor from '../features/library/components/book-detail/BookClassificationEditor'
import i18n from '../i18n/i18n'

vi.mock('../features/library/hooks', () => ({ useLibraryCategories: () => ({ data: { data: [] } }) }))

function renderEditor(onTagsChange = vi.fn(), onCategoryChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { onTagsChange, ...render(
    <QueryClientProvider client={queryClient}>
      <BookClassificationEditor libraryId={null} categoryPath={null} tags={new Set(['武侠'])} onCategoryChange={onCategoryChange} onTagsChange={onTagsChange} tagValues={[{ name: '武侠' }]} />
    </QueryClientProvider>,
  ) }
}

describe('book classification editor', () => {
  beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

  it('creates a category in the draft through the original picker', () => {
    const onCategoryChange = vi.fn()
    renderEditor(vi.fn(), onCategoryChange)
    fireEvent.click(screen.getByRole('button', { name: '分类' }))
    fireEvent.click(screen.getByRole('button', { name: '新建分类' }))
    fireEvent.change(screen.getByPlaceholderText('分类名称'), { target: { value: '科幻' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(onCategoryChange).toHaveBeenCalledWith(['科幻'])
  })

  it('adds a typed tag to the draft immediately without creating an entity', () => {
    const onTagsChange = vi.fn()
    renderEditor(onTagsChange)
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }))
    fireEvent.change(screen.getByPlaceholderText('搜索标签…'), { target: { value: '星空' } })
    fireEvent.click(screen.getByRole('button', { name: '创建 “星空”' }))
    expect(onTagsChange).toHaveBeenCalledWith(expect.any(Function))
    expect(screen.queryByText('保存后创建，取消不会留下标签')).toBeNull()
  })

  it('removes a selected tag directly from the draft', () => {
    const onTagsChange = vi.fn()
    renderEditor(onTagsChange)
    fireEvent.click(screen.getByRole('button', { name: '删除 武侠' }))
    expect(onTagsChange).toHaveBeenCalledWith(expect.any(Function))
  })
})
