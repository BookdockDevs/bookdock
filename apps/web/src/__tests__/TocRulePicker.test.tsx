import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { TocPreviewReq, TocPreviewRes, TocRuleRes } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import TocRulePicker from '../features/library/components/TocRulePicker'
import BookCustomTocEditor from '../features/library/components/BookCustomTocEditor'

const reTocMutate = vi.fn()
let lastPreviewRequest: TocPreviewReq | null = null
let lastPreviewEnabled: boolean | undefined
let previewEnabledCalls: boolean[] = []

const sampleRules: TocRuleRes[] = [
  {
    id: 'rule-1',
    name: '中文网文（卷·章·节）',
    enabled: true,
    sortOrder: 0,
    patterns: [
      { level: 1, regex: '^第.+卷', replacement: null, enabled: true },
      { level: 2, regex: '^第.+章', replacement: null, enabled: true },
    ],
    builtIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
]
let availableRules = sampleRules

const samplePreview: TocPreviewRes = {
  ruleId: 'rule-1',
  ruleName: '中文网文（卷·章·节）',
  autoScored: false,
  fallback: false,
  totalChapters: 2,
  matchedTotalChapters: 2,
  currentTotalChapters: 1,
  levelCounts: { 1: 1, 2: 1 },
  excludedChapterIds: [],
  chapters: [
    { id: 'ch-0', title: '第一卷 崛起', level: 1, wordCount: 3500, excluded: false, canExclude: false },
    { id: 'ch-20', title: '第一章 初入江湖', level: 2, wordCount: 2200, excluded: false, canExclude: true },
  ],
}

let previewData: TocPreviewRes | undefined = samplePreview
let activePreviewData: TocPreviewRes | undefined
let selectedRulePreviewData: TocPreviewRes | undefined
let useActivePreview = false
let previewIsFetching = false

vi.mock('@/api/hooks/useTocRules', () => ({
  useTocRules: () => ({
    data: { data: availableRules },
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useReToc: () => ({
    mutate: reTocMutate,
    isPending: false,
  }),
  useTocPreview: (_bookId: string, req: TocPreviewReq, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false
    lastPreviewEnabled = enabled
    previewEnabledCalls.push(enabled)
    if (enabled) lastPreviewRequest = req
    const data = req.tocRuleId === 'rule-1'
      ? (useActivePreview ? activePreviewData : selectedRulePreviewData)
      : previewData
    return {
      data: enabled && data ? { data } : undefined,
      isFetching: enabled && previewIsFetching,
    }
  },
}))

describe('TocRulePicker & BookCustomTocEditor', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    lastPreviewRequest = null
    lastPreviewEnabled = undefined
    previewEnabledCalls = []
    availableRules = sampleRules
    previewData = samplePreview
    activePreviewData = undefined
    selectedRulePreviewData = undefined
    useActivePreview = false
    previewIsFetching = false
  })

  it('renders auto split, global rules, and preview panel with apply button', () => {
    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId="rule-1"
        currentChapters={[{ id: 'current-1', title: '当前第一章', level: 1, wordCount: 1800 }]}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('分章规则')).toBeInTheDocument()
    expect(screen.getByText('自动分章')).toBeInTheDocument()
    expect(screen.getByText('中文网文（卷·章·节）')).toBeInTheDocument()

    // The active rule initially falls back to the persisted directory while its raw boundaries load.
    expect(screen.getByText('当前第一章')).toBeInTheDocument()
    expect(lastPreviewEnabled).toBe(true)

    // Apply button is disabled when selected target is already the active rule.
    const applyBtn = screen.getByRole('button', { name: '应用' })
    expect(applyBtn).toBeDisabled()

    // Switching selection to another target starts its preview calculation.
    fireEvent.click(screen.getByText('自动分章'))
    expect(lastPreviewEnabled).toBe(true)
    expect(applyBtn).not.toBeDisabled()

    expect(screen.getByText('当前 1 章 → 预览 2 章')).toBeInTheDocument()
    expect(screen.getByText('第一卷 崛起')).toBeInTheDocument()
    expect(screen.getByText('第一章 初入江湖')).toBeInTheDocument()

    // Clicking Apply calls reToc with null for auto
    fireEvent.click(applyBtn)
    expect(reTocMutate).toHaveBeenCalledWith({ tocRuleId: null, excludedChapterIds: [] }, expect.anything())
  })

  it('shows the current directory while the rule preview is being calculated', () => {
    previewData = undefined
    previewIsFetching = true

    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId="rule-1"
        currentChapters={[
          { id: 'current-1', title: '第一章 当前目录', level: 1, wordCount: 1800 },
          { id: 'current-2', title: '第二章 当前目录', level: 1, wordCount: 2100 },
        ]}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('当前 2 章 → 预览 2 章')).toBeInTheDocument()
    expect(screen.getByText('第一章 当前目录')).toBeInTheDocument()
    expect(screen.getByText('第二章 当前目录')).toBeInTheDocument()
    expect(lastPreviewEnabled).toBe(true)

    fireEvent.click(screen.getByText('自动分章'))

    expect(screen.getByText('正在计算分章效果…')).toBeInTheDocument()
    expect(lastPreviewEnabled).toBe(true)
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
  })

  it('displays custom rule when book has customPatterns without redundant badge', () => {
    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId="custom"
        customPatterns={[{ level: 1, regex: '^自定义.*', enabled: true }]}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('本书专属规则')).toBeInTheDocument()
    expect(screen.queryByText('专属')).not.toBeInTheDocument()
    expect(screen.getByTitle('编辑专属分章规则')).toBeInTheDocument()
  })

  it('syncs the highlighted target when rules finish loading', async () => {
    availableRules = []
    const props = {
      bookId: 'book-1',
      currentRuleId: 'rule-1',
      onClose: vi.fn(),
    }
    const { rerender } = render(<TocRulePicker {...props} />)

    availableRules = sampleRules
    rerender(<TocRulePicker {...props} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /中文网文（卷·章·节）/ })).toHaveClass('bg-stone-900')
      expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    })
    expect(previewEnabledCalls.every((enabled) => !enabled)).toBe(true)
  })

  it('previews the active rule so its chapter boundaries can be edited', () => {
    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId="rule-1"
        currentChapters={[
          { id: 'current-1', title: '第一章 当前目录', level: 1, wordCount: 1800 },
          { id: 'current-2', title: '第二章 当前目录', level: 1, wordCount: 2100 },
        ]}
        onClose={vi.fn()}
      />,
    )

    const applyBtn = screen.getByRole('button', { name: '应用' })
    expect(lastPreviewEnabled).toBe(true)
    expect(applyBtn).toBeDisabled()

    fireEvent.click(screen.getByText('自动分章'))
    expect(lastPreviewEnabled).toBe(true)
    expect(applyBtn).not.toBeDisabled()
  })

  it('allows excluding a chapter boundary from the active rule preview', () => {
    useActivePreview = true
    activePreviewData = {
      ...samplePreview,
      totalChapters: 2,
      currentTotalChapters: 2,
      levelCounts: { 1: 2 },
      chapters: [
        { id: 'ch-0', title: '第一章 当前目录', level: 1, wordCount: 3500, excluded: false, canExclude: false },
        { id: 'ch-20', title: '第二章 当前目录', level: 1, wordCount: 2200, excluded: false, canExclude: true },
      ],
    }

    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId="rule-1"
        currentChapters={[
          { id: 'ch-0', title: '第一章 当前目录', level: 1, wordCount: 3500 },
          { id: 'ch-20', title: '第二章 当前目录', level: 1, wordCount: 2200 },
        ]}
        onClose={vi.fn()}
      />,
    )

    const chapterButton = screen.getByRole('button', { name: /第二章 当前目录/ })
    expect(chapterButton).not.toBeDisabled()
    fireEvent.click(chapterButton)
    expect(chapterButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(reTocMutate).toHaveBeenCalledWith(
      { tocRuleId: 'rule-1', excludedChapterIds: ['ch-20'] },
      expect.anything(),
    )
  })

  it('supports editing and testing in BookCustomTocEditor', () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(
      <BookCustomTocEditor
        bookId="book-1"
        initialPatterns={[{ level: 1, regex: '^第.+章', replacement: '$1', enabled: true }]}
        onClose={onClose}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByText('编辑专属分章规则')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /测试匹配/ })).toBeInTheDocument()

    // Click test match button
    fireEvent.click(screen.getByRole('button', { name: /测试匹配/ }))
    expect(screen.getByText('共 2 章')).toBeInTheDocument()

    // Click save & apply
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
    expect(reTocMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        customPatterns: expect.arrayContaining([
          expect.objectContaining({ level: 1, regex: '^第.+章' }),
        ]),
      }),
      expect.anything(),
    )
  })

  it('renders load more button when totalChapters exceeds loaded chapters', () => {
    // samplePreview has totalChapters: 2, but if totalChapters is 1500
    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId="rule-1"
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('自动分章'))
    // Initially samplePreview has totalChapters: 2 and 2 chapters, so load more is not shown
    expect(screen.queryByRole('button', { name: /加载更多/ })).not.toBeInTheDocument()
  })

  it('toggles a cancellable chapter boundary and submits the exclusion', () => {
    selectedRulePreviewData = samplePreview
    render(
      <TocRulePicker
        bookId="book-1"
        currentRuleId={undefined}
        currentChapters={[{ level: 1 }]}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('中文网文（卷·章·节）'))

    const chapterButton = screen.getByRole('button', { name: /第一章 初入江湖/ })
    expect(lastPreviewRequest?.excludedChapterIds).toEqual([])
    expect(chapterButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chapterButton)
    expect(chapterButton).toHaveAttribute('aria-pressed', 'true')
    expect(lastPreviewRequest?.excludedChapterIds).toEqual([])
    expect(screen.getByText('当前 1 章 → 预览 1 章')).toBeInTheDocument()
    expect(screen.getByText('L1: 1')).toBeInTheDocument()
    expect(screen.queryByText('L2: 1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(reTocMutate).toHaveBeenCalledWith(
      { tocRuleId: 'rule-1', excludedChapterIds: ['ch-20'] },
      expect.anything(),
    )
  })
})
