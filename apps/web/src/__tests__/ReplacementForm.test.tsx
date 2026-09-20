import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { TextReplacementRes } from '@bookdock/shared'

import { useCreateReplacement, useUpdateReplacement } from '@/api/hooks/useReplacements'
import i18n from '../i18n/i18n'
import ReplacementForm from '../features/settings/components/ReplacementForm'
import type { SelectionInfo } from '../features/reader/types'

vi.mock('@/api/hooks/useReplacements', () => ({
  useReplacements: vi.fn(() => ({ data: { data: [] } })),
  useCreateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

const selection = (overrides: Partial<SelectionInfo> = {}): SelectionInfo => ({
  cfiRange: 'epubcfi(/6/2!/4/2)',
  text: '错字',
  rawText: '错字',
  rect: { left: 0, top: 0, width: 10, height: 10 },
  startOffset: 42,
  sectionHref: 'chapter-0001.xhtml',
  singleTextNode: true,
  ...overrides,
})

const rule = (overrides: Partial<TextReplacementRes> = {}): TextReplacementRes => ({
  id: 't1',
  bookId: null,
  scope: 'global',
  matchType: 'pattern',
  pattern: '广告词',
  replacement: null,
  isRegex: false,
  applyTo: 'content',
  enabled: true,
  name: null,
  group: null,
  spineHref: null,
  textOffset: null,
  originalText: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const mockCreate = () => {
  const mutation = { mutate: vi.fn(), isPending: false }
  vi.mocked(useCreateReplacement).mockReturnValue(mutation as unknown as ReturnType<typeof useCreateReplacement>)
  return mutation
}

const mockUpdate = () => {
  const mutation = { mutate: vi.fn(), isPending: false }
  vi.mocked(useUpdateReplacement).mockReturnValue(mutation as unknown as ReturnType<typeof useUpdateReplacement>)
  return mutation
}

describe('ReplacementForm', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockCreate()
    mockUpdate()
  })

  describe('create from selection', () => {
    it('defaults to a point patch for a single-node selection and sends the anchors', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm bookId="b1" selection={selection()} onDone={() => {}} />)

      fireEvent.change(screen.getByLabelText(/替换为/), { target: { value: '对字' } })
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({
        matchType: 'point',
        bookId: 'b1',
        spineHref: 'chapter-0001.xhtml',
        textOffset: 42,
        originalText: '错字',
        replacement: '对字',
      })
    })

    it('falls back to a book-scoped rule when the selection has no point anchors', () => {
      const createReplacement = mockCreate()
      render(
        <ReplacementForm
          bookId="b1"
          selection={selection({ singleTextNode: false, startOffset: undefined, sectionHref: undefined })}
          onDone={() => {}}
        />,
      )

      expect(screen.getByText(/无法建立定点锚点/)).toBeInTheDocument()
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ matchType: 'pattern', pattern: '错字', bookId: 'b1' })
      expect(body).not.toHaveProperty('spineHref')
    })

    it('creates a point patch when the selection spans multiple text nodes', () => {
      const createReplacement = mockCreate()
      render(
        <ReplacementForm
          bookId="b1"
          selection={selection({ singleTextNode: false, pointText: '错字' })}
          onDone={() => {}}
        />,
      )

      fireEvent.change(screen.getByLabelText(/替换为/), { target: { value: '对字' } })
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({
        matchType: 'point',
        originalText: '错字',
        replacement: '对字',
      })
    })

    it('omits the name field when scope is point', () => {
      render(<ReplacementForm bookId="b1" selection={selection()} onDone={() => {}} />)
      expect(screen.queryByLabelText(/名称/)).not.toBeInTheDocument()
    })

    it('creates a global pattern rule from "all matches" (no bookId)', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm bookId="b1" selection={selection()} onDone={() => {}} />)

      fireEvent.click(screen.getByText('所有匹配处'))
      fireEvent.click(screen.getByRole('switch', { name: '正则表达式' }))
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ matchType: 'pattern', pattern: '错字', isRegex: true })
      expect(body).not.toHaveProperty('bookId')
      expect(body).not.toHaveProperty('spineHref')
    })

    it('uses the edited match text instead of the raw selection', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm bookId="b1" selection={selection()} onDone={() => {}} />)

      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '错[字子]' } })
      fireEvent.click(screen.getByText('所有匹配处'))
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ matchType: 'pattern', pattern: '错[字子]' })
    })

    it('normalizes an empty replacement to null (delete)', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm bookId="b1" selection={selection()} onDone={() => {}} />)

      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ matchType: 'point', replacement: null })
    })

    it('blocks submit with an empty match field', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm bookId="b1" selection={selection()} onDone={() => {}} />)

      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '  ' } })
      fireEvent.click(screen.getByText('保存'))
      expect(screen.getByText(/匹配内容不能为空/)).toBeInTheDocument()
      expect(createReplacement.mutate).not.toHaveBeenCalled()
    })

    it('blocks a pattern rule with an invalid regex', () => {
      const createReplacement = mockCreate()
      render(
        <ReplacementForm
          bookId="b1"
          selection={selection({ text: '([', rawText: '([' })}
          onDone={() => {}}
        />,
      )

      fireEvent.click(screen.getByText('所有匹配处'))
      fireEvent.click(screen.getByRole('switch', { name: '正则表达式' }))
      fireEvent.click(screen.getByText('保存'))
      expect(screen.getByText(/正则表达式无效/)).toBeInTheDocument()
      expect(createReplacement.mutate).not.toHaveBeenCalled()
    })
  })

  describe('create from the rules list', () => {
    it('defaults to a book-scoped rule in the reader dialog and shows no anchor hint', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm bookId="b1" onDone={() => {}} />)

      expect(screen.getByRole('button', { name: '仅此一处' })).toBeDisabled()
      // The reader is the point-patch flow's home — the hint would be noise here
      expect(screen.queryByText(/定点补丁需要原文锚点/)).not.toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '新规则' } })
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ matchType: 'pattern', pattern: '新规则', bookId: 'b1' })
    })

    it('hides the scope segment entirely without a book context (settings manager)', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm onDone={() => {}} />)

      expect(screen.queryByRole('button', { name: '仅此一处' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '本书所有匹配处' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '所有匹配处' })).not.toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '新规则' } })
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ matchType: 'pattern', pattern: '新规则' })
      expect(body).not.toHaveProperty('bookId')
    })

    it('supports selecting an existing group from dropdown or typing custom group', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm groups={['排版', '广告']} onDone={() => {}} />)

      const groupInput = screen.getByRole('textbox', { name: '分组' })
      expect(groupInput).toBeInTheDocument()

      // Focus should open dropdown with options
      fireEvent.focus(groupInput)
      expect(screen.getByRole('option', { name: '排版' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: '广告' })).toBeInTheDocument()

      // Selecting an option fills the input
      fireEvent.click(screen.getByRole('option', { name: '广告' }))
      expect(groupInput).toHaveValue('广告')

      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '广告词' } })
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ group: '广告', pattern: '广告词' })
    })

    it('supports typing a new custom group directly without requiring create button', () => {
      const createReplacement = mockCreate()
      render(<ReplacementForm groups={['排版']} onDone={() => {}} />)

      const groupInput = screen.getByRole('textbox', { name: '分组' })
      fireEvent.change(groupInput, { target: { value: '错别字修正' } })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '错字' } })
      fireEvent.click(screen.getByText('保存'))
      const [body] = createReplacement.mutate.mock.calls[0]
      expect(body).toMatchObject({ group: '错别字修正', pattern: '错字' })
    })
  })

  describe('edit', () => {
    it('edits a pattern rule via the update mutation', () => {
      const updateReplacement = mockUpdate()
      render(<ReplacementForm initial={rule({ name: '去广告', replacement: '' })} onDone={() => {}} />)

      fireEvent.change(screen.getByLabelText(/替换为/), { target: { value: '**' } })
      fireEvent.click(screen.getByText('保存'))
      const [call] = updateReplacement.mutate.mock.calls[0]
      expect(call.body).toMatchObject({ pattern: '广告词', replacement: '**', name: '去广告' })
    })

    it('edits a point patch snapshot without touching its pattern fields', () => {
      const updateReplacement = mockUpdate()
      render(
        <ReplacementForm
          initial={rule({ id: 'p1', pattern: null, matchType: 'point', originalText: '错字', bookId: 'bX', scope: 'book' })}
          bookId="b1"
          onDone={() => {}}
        />,
      )

      fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '新快照' } })
      fireEvent.click(screen.getByText('保存'))
      const [call] = updateReplacement.mutate.mock.calls[0]
      expect(call.body).toMatchObject({ originalText: '新快照' })
      expect(call.body).not.toHaveProperty('pattern')
      expect(call.body).not.toHaveProperty('matchType')
    })

    it('omits the name field when editing a point patch', () => {
      render(
        <ReplacementForm
          initial={rule({ id: 'p1', pattern: null, matchType: 'point', originalText: '错字', name: '旧命名', bookId: 'bX', scope: 'book' })}
          bookId="b1"
          onDone={() => {}}
        />,
      )
      expect(screen.queryByLabelText(/名称/)).not.toBeInTheDocument()
    })

    it('converts a point patch into a global rule (snapshot becomes the pattern)', () => {
      const updateReplacement = mockUpdate()
      render(
        <ReplacementForm
          initial={rule({ id: 'p1', pattern: null, matchType: 'point', originalText: '错字', bookId: 'bX', scope: 'book' })}
          bookId="b1"
          onDone={() => {}}
        />,
      )

      fireEvent.click(screen.getByText('所有匹配处'))
      fireEvent.click(screen.getByText('保存'))
      const [call] = updateReplacement.mutate.mock.calls[0]
      expect(call.body).toMatchObject({ matchType: 'pattern', pattern: '错字', bookId: null })
    })

    it('disables point conversion for pattern rules', () => {
      render(<ReplacementForm initial={rule()} bookId="b1" onDone={() => {}} />)

      expect(screen.getByRole('button', { name: '仅此一处' })).toBeDisabled()
    })
  })
})
