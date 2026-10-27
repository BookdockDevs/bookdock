import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'

const fake = vi.hoisted(() => ({ records: new Map<string, any>() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  useParams: () => ({ id: 'book' }), useSearch: () => ({}),
}))
vi.mock('./hooks/useEditorAccess', () => ({ useEditorAccess: () => 'allowed' }))
vi.mock('./hooks/useDraftNavigationGuard', () => ({ useDraftNavigationGuard: () => ({ back: vi.fn(), blocked: false }) }))
vi.mock('@/api/hooks/useTocRules', () => ({ useTocRules: () => ({ data: { data: [] } }) }))
vi.mock('./hooks/useEditorContent', () => ({
  useEditorBook: () => ({ data: { data: { id: 'book', title: 'Book', format: 'txt', revisionId: 'rev', updatedAt: 1 } } }),
  useEditorChapters: () => ({ data: { data: [{ id: 'chapter', title: 'Chapter', level: 1, startOffset: 0, contentStartOffset: 0, endOffset: 3 }] } }),
  useEditorTxtSource: () => ({ data: 'old' }), useSaveEditorTxt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEditorEpubSource: () => ({ data: { data: { revisionId: 'rev', documents: [{ href: 'one.xhtml', content: '<html><body><p>One</p></body></html>' }], tocEntries: [{ href: 'one.xhtml', title: 'One', level: 1 }], spineOrder: ['one.xhtml'] } }, isPending: false, isError: false }),
  useEditorManifest: () => ({ data: undefined }), useEditorSpineText: () => ({ data: undefined }),
  useSaveEditorEpub: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('./lib/local-draft-store', () => ({
  DRAFT_MAX_AGE: 90 * 86400000,
  draftKey: (account: string, book: string, format: string, target: unknown) => JSON.stringify([account, format, book, target ?? null]),
  readLocalDraft: async (key: string) => fake.records.get(key),
  replaceLocalDraft: async (key: string, expected: string | null, value: any, valid: () => boolean) => {
    if (!valid() || (fake.records.get(key)?.token ?? null) !== expected) return false
    if (value) fake.records.set(key, value); else fake.records.delete(key)
    return true
  },
}))

import ContentEditorPage from './ContentEditorPage'
import EpubContentEditor from './components/EpubContentEditor'

describe('local recovery in the workbench', () => {
  beforeEach(async () => {
    fake.records.clear()
    useAuthStore.setState({ user: { id: 'user', username: 'user', role: 'owner' } })
    await i18n.changeLanguage('zh-CN')
  })

  it('restores a TXT edit after reopening with fresh undo history', async () => {
    const first = render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' })
    fireEvent.change(body, { target: { value: 'recovered text' } })
    await waitFor(() => expect(fake.records.size).toBe(1), { timeout: 3000 })
    first.unmount()
    render(<ContentEditorPage />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveValue('recovered text'))
    expect(screen.queryByText('恢复本地草稿？')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })

  it('restores one EPUB draft after editing and switching views', async () => {
    const book = { id: 'book', title: 'Book', format: 'epub', revisionId: 'rev' } as never
    const first = render(<EpubContentEditor book={book} />)
    const frame = await screen.findByTitle('EPUB 正文编辑区')
    const body = frame.contentDocument!.body
    body.innerHTML = '<p>One</p>'; fireEvent.load(frame)
    body.innerHTML = '<p>Changed</p>'; fireEvent.input(body)
    fireEvent.click(screen.getByRole('button', { name: '按文件' }))
    await waitFor(() => expect(fake.records.size).toBe(1), { timeout: 3000 })
    const stored = [...fake.records.values()][0]
    expect(stored.payload.documents[0].content).toContain('Changed')
    expect(stored.payload.view).toBe('files')
    first.unmount()
    render(<EpubContentEditor book={book} />)
    await waitFor(() => expect(screen.getByTitle('EPUB 正文编辑区').getAttribute('srcdoc')).toContain('Changed'))
    expect(screen.queryByText('恢复本地草稿？')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
  })
})
