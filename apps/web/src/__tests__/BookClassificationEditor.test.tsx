import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BookClassificationEditor from '../features/library/components/book-detail/BookClassificationEditor'
import i18n from '../i18n/i18n'

function renderEditor(props: Partial<React.ComponentProps<typeof BookClassificationEditor>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BookClassificationEditor
        libraryId={null}
        categoryId={null}
        tagIds={new Set(['t1'])}
        onCategoryChange={vi.fn()}
        onTagChange={vi.fn()}
        tags={[{ id: 't1', name: '武侠' }]}
        onCreateTag={vi.fn(async () => 'new')}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('book classification editor', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('marks scraped tags as pending instead of selection', () => {
    renderEditor({ pendingTagNames: ['星空'] })
    const pending = screen.getByText('星空').closest('span[title]')
    expect(pending?.getAttribute('title')).toBe('保存后创建，取消不会留下标签')
  })

  it('drops a pending tag by name', () => {
    const onRemovePendingTag = vi.fn()
    renderEditor({ pendingTagNames: ['星空'], onRemovePendingTag })
    fireEvent.click(screen.getByRole('button', { name: '删除 星空' }))
    expect(onRemovePendingTag).toHaveBeenCalledWith('星空')
  })

  it('hides a pending name that already exists as a tag', () => {
    const { container } = renderEditor({ pendingTagNames: ['武侠'] })
    expect(container.querySelectorAll('span[title="保存后创建，取消不会留下标签"]')).toHaveLength(0)
  })

  it('renders nothing extra when every scraped tag already exists', () => {
    const { container } = renderEditor({ pendingTagNames: [] })
    expect(container.querySelectorAll('span[title="保存后创建，取消不会留下标签"]')).toHaveLength(0)
    expect(screen.getByText('武侠')).toBeTruthy()
  })
})
