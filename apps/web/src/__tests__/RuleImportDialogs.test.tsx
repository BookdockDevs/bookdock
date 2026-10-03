import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import ReplacementImportDialog from '@/features/settings/components/ReplacementImportDialog'
import TocRuleImportDialog from '@/features/settings/components/TocRuleImportDialog'
import i18n from '@/i18n/i18n'

const { mutate, notifySuccess } = vi.hoisted(() => ({ mutate: vi.fn(), notifySuccess: vi.fn() }))
vi.mock('@/api/hooks/useTocRules', () => ({ useImportTocRules: () => ({ mutate, isPending: false }) }))
vi.mock('@/api/hooks/useReplacements', () => ({ useImportReplacements: () => ({ mutate, isPending: false }) }))
vi.mock('@/lib/notifications', () => ({ notify: { success: notifySuccess } }))

describe('rule import dialogs', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  const fixtures = {
    toc: { kind: 'bookdock.toc-rules', formatVersion: 1, rules: [{ name: 'taken', enabled: false, patterns: [
      { level: 1, regex: '^chapter', replacement: '$1', enabled: true },
      { level: 2, regex: '^section', replacement: null, enabled: false },
    ] }] },
    replacement: { kind: 'bookdock.text-replacements', formatVersion: 1, rules: [{ name: 'taken', group: 'group', pattern: '广告', replacement: '   ', isRegex: false, applyTo: 'both', enabled: false }] },
  }

  function mount(kind: keyof typeof fixtures, existingNames: string[] = ['taken']) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const onClose = vi.fn()
    const Component = kind === 'toc' ? TocRuleImportDialog : ReplacementImportDialog
    const view = render(<QueryClientProvider client={client}><Component existingNames={existingNames} onClose={onClose} /></QueryClientProvider>)
    return { ...view, container: view.baseElement, invalidate, onClose }
  }

  function selectFile(container: HTMLElement, data: unknown, text?: Promise<string>) {
    const file = new File(['unused'], 'rules.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => text ?? Promise.resolve(JSON.stringify(data)) })
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
  }

  for (const kind of ['toc', 'replacement'] as const) {
    it(`${kind}: previews before saving, suggests a name, and keeps config`, async () => {
      const { container, onClose } = mount(kind)
      selectFile(container, fixtures[kind])
      await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('taken（导入）'))
      expect(mutate).not.toHaveBeenCalled()
      expect(screen.queryByText('启用')).not.toBeInTheDocument()
      expect(screen.getByText(/已有同名规则/)).toBeInTheDocument()
      if (kind === 'toc') {
        expect(screen.getByText('2 个目录层级')).toBeInTheDocument()
        const summary = screen.getByText('查看识别配置')
        expect(summary.closest('details')).not.toHaveAttribute('open')
        expect(screen.getByText('^section')).not.toBeVisible()
        fireEvent.click(summary)
        await waitFor(() => expect(summary.closest('details')).toHaveAttribute('open'))
        expect(screen.getByText('^section')).toBeVisible()
        expect(screen.getByText('$1')).toBeVisible()
        expect(screen.getByText(/第 2 层 · 不参与识别/)).toBeVisible()
        expect(screen.getByText(/使用匹配内容/)).toBeVisible()
        expect(screen.queryByText(/null/)).not.toBeInTheDocument()
      } else {
        expect(screen.queryByText('清空匹配内容')).not.toBeInTheDocument()
        expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '广告 → "   "')).toBeInTheDocument()
        expect(screen.queryByText('停用')).not.toBeInTheDocument()
      }
      fireEvent.click(screen.getByRole('button', { name: '确认导入（1）' }))
      expect(mutate.mock.calls[0][0].rules[0]).toMatchObject({ name: 'taken（导入）', enabled: false })
      act(() => mutate.mock.calls[0][1].onSuccess({ data: [{}] }))
      expect(notifySuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledOnce()
    })

    it(`${kind}: blocks invalid files and conflicting final names`, async () => {
      const { container } = mount(kind)
      selectFile(container, { ...fixtures[kind], formatVersion: 2 })
      await waitFor(() => expect(screen.getByRole('button', { name: '确认导入（0）' })).toBeDisabled())
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      selectFile(container, fixtures[kind])
      await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'taken' } })
      expect(screen.getByRole('button', { name: '确认导入（1）' })).toBeDisabled()
      expect(mutate).not.toHaveBeenCalled()
    })

    it(`${kind}: retains a failed draft, then locks an uncertain save and refreshes`, async () => {
      const { container, invalidate } = mount(kind)
      selectFile(container, fixtures[kind])
      await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
      const confirm = screen.getByRole('button', { name: '确认导入（1）' })
      fireEvent.click(confirm)
      act(() => mutate.mock.calls[0][1].onError(new ApiError('VALIDATION_ERROR', 'Conflict', {
        issues: [{ ruleIndex: 0, field: 'name', message: 'Conflict after preview' }],
      })))
      expect(screen.getByRole('textbox')).toHaveValue('taken（导入）')
      expect(screen.getByText(/Conflict after preview/)).toBeInTheDocument()
      fireEvent.click(confirm)
      act(() => mutate.mock.calls[1][1].onError(new TypeError('Network lost')))
      expect(confirm).toBeDisabled()
      expect(screen.getByRole('button', { name: '选择文件' })).toBeDisabled()
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [kind === 'toc' ? 'toc-rules' : 'replacements'] })
      fireEvent.click(confirm)
      expect(mutate).toHaveBeenCalledTimes(2)
    })

    it(`${kind}: ignores a stale file read after another selection`, async () => {
      const { container } = mount(kind)
      let finish!: (text: string) => void
      const delayed = new Promise<string>((resolve) => { finish = resolve })
      selectFile(container, fixtures[kind], delayed)
      const latest = structuredClone(fixtures[kind])
      latest.rules[0].name = 'latest'
      selectFile(container, latest)
      await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('latest'))
      await act(async () => { finish(JSON.stringify(fixtures[kind])); await delayed })
      expect(screen.getByRole('textbox')).toHaveValue('latest')
      expect(screen.queryByText(/原名称/)).not.toBeInTheDocument()
    })
  }
})
