import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import type { TocRuleRes } from '@bookdock/shared'

import TocRulesSettingsSection from '../features/settings/components/TocRulesSettingsSection'
import { useToastStore } from '../stores/toast.store'

const mocks = vi.hoisted(() => ({
  query: { data: { data: [] as TocRuleRes[] } },
  deleteRules: vi.fn(),
  reorder: vi.fn(),
  restore: vi.fn(),
  drag: null as ((event: unknown) => void) | null,
}))

const initialRules: TocRuleRes[] = [
  { id: 'rule-1', name: '规则一', enabled: true, sortOrder: 0, patterns: [{ level: 1, regex: '^一', replacement: null, enabled: true }], builtIn: true, createdAt: 1, updatedAt: 1 },
  { id: 'rule-2', name: '规则二', enabled: false, sortOrder: 1, patterns: [{ level: 1, regex: '^二', replacement: null, enabled: true }], builtIn: false, createdAt: 2, updatedAt: 2 },
]

vi.mock('@/api/hooks/useTocRules', () => ({
  useTocRules: () => mocks.query,
  useCreateTocRule: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTocRules: () => ({ mutate: mocks.deleteRules, isPending: false }),
  useReorderTocRules: () => ({ mutate: mocks.reorder, isPending: false }),
  useSeedTocRules: () => ({ mutate: mocks.restore, isPending: false }),
  useUpdateTocRule: () => ({ mutate: vi.fn(), isPending: false }),
  useImportTocRules: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return { ...actual, DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
    mocks.drag = props.onDragEnd as (event: unknown) => void
    return createElement(actual.DndContext, props)
  } }
})

function selectRule(index: number) {
  fireEvent.click(within(screen.getAllByRole('listitem')[index]!).getByRole('checkbox'))
}

async function readExport(blob: Blob) {
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
  return JSON.parse(text)
}

beforeEach(() => {
  useToastStore.getState().clearToasts()
  mocks.query = { data: { data: [...initialRules] } }
  mocks.deleteRules.mockReset()
  mocks.reorder.mockReset()
  mocks.restore.mockReset()
})

describe('TocRulesSettingsSection', () => {
  it.each([false, true])('distinguishes restored presets from no change (%s)', (added) => {
    render(<TocRulesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.tocRulesRestore' }))
    const restored = added ? [...initialRules, { ...initialRules[0]!, id: 'new-preset' }] : initialRules
    act(() => mocks.restore.mock.calls[0]![1].onSuccess({ data: restored }))
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: added ? 'success' : 'info', message: added
        ? { key: 'toast.tocRulesRestored', params: { count: 1 } }
        : { key: 'toast.tocRulesAlreadyPresent' } }),
    ])
  })

  it('keeps normal rows quiet and exposes selection and restoration only in edit mode', () => {
    render(<TocRulesSettingsSection />)
    expect(screen.getByText('· 2')).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'settings.tocRulesRestore' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'settings.tocExportOne' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('settings.tocRulesBuiltIn')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'settings.tocRulesReorder' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'settings.tocRulesEditShort' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'settings.tocRulesRestore' })).toBeEnabled()
    const actions = screen.getByRole('button', { name: 'settings.editModeExit' }).parentElement!
    expect(within(actions).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'settings.ruleExportSelected', 'settings.ruleDeleteSelected', 'settings.tocRulesRestore', 'settings.editModeExit',
    ])
    expect(screen.getByRole('button', { name: 'settings.ruleExportSelected' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings.ruleDeleteSelected' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'settings.tocImport' })).toBeNull()
  })

  it('supports partial selection, select-all, and clearing selection on completion', () => {
    render(<TocRulesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    selectRule(0)
    const all = screen.getByRole('checkbox', { name: 'settings.ruleSelectAll' })
    expect(all).toBePartiallyChecked()
    expect(screen.getByRole('button', { name: 'settings.ruleExportSelected' })).toBeEnabled()
    fireEvent.click(all)
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getAllByRole('checkbox').every((node) => (node as HTMLInputElement).checked)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeExit' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    expect(screen.getByRole('button', { name: 'settings.ruleDeleteSelected' })).toBeDisabled()
  })

  it('exports only selected rules in displayed order and keeps the transferable fields', async () => {
    const createUrl = vi.fn((_blob: Blob) => 'blob:export')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<TocRulesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    act(() => mocks.drag!({ active: { id: 'rule-2' }, over: { id: 'rule-1' } }))
    selectRule(1)
    selectRule(0)
    fireEvent.click(screen.getByRole('button', { name: 'settings.ruleExportSelected' }))
    const exported = await readExport(createUrl.mock.calls[0]![0] as Blob)
    expect(exported.kind).toBe('bookdock.toc-rules')
    expect(exported.formatVersion).toBe(1)
    expect(exported.rules.map((rule: { name: string }) => rule.name)).toEqual(['规则二', '规则一'])
    expect(exported.rules[0]).not.toHaveProperty('id')
    expect(exported.rules[0]).not.toHaveProperty('builtIn')
  })

  it('keeps selection and the confirmation open on failure and submits one batch', () => {
    render(<TocRulesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    selectRule(0)
    fireEvent.click(screen.getByRole('button', { name: 'settings.ruleDeleteSelected' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('规则一')
    expect(mocks.deleteRules).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'settings.confirmDeleteAction' }))
    const [body, callbacks] = mocks.deleteRules.mock.calls[0]!
    expect(body).toEqual({ ruleIds: ['rule-1'] })
    act(() => callbacks.onError(new Error('failed')))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'settings.confirmDeleteAction' }))
    expect(mocks.deleteRules).toHaveBeenCalledTimes(2)
  })

  it('reconciles deletion, edits, and restoration with a reordered draft before completion', () => {
    const { rerender } = render(<TocRulesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    act(() => mocks.drag!({ active: { id: 'rule-2' }, over: { id: 'rule-1' } }))
    selectRule(1)
    fireEvent.click(screen.getByRole('button', { name: 'settings.ruleDeleteSelected' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.confirmDeleteAction' }))
    act(() => {
      mocks.query = { data: { data: [{ ...initialRules[1]!, name: 'edited' }] } }
      mocks.deleteRules.mock.calls[0]![1].onSuccess()
    })
    rerender(<TocRulesSettingsSection />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('edited')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.ruleDeleteSelected' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'settings.tocRulesRestore' }))
    expect(mocks.restore).toHaveBeenCalled()
    mocks.query = { data: { data: [{ ...initialRules[1]!, name: 'edited' }, initialRules[0]!] } }
    rerender(<TocRulesSettingsSection />)
    expect(screen.getAllByRole('listitem').map((node) => node.textContent)).toEqual(['editedL1', '规则一L1'])
    act(() => mocks.drag!({ active: { id: 'rule-1' }, over: { id: 'rule-2' } }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeExit' }))
    expect(mocks.reorder).toHaveBeenCalledWith(['rule-1', 'rule-2'], expect.objectContaining({ onError: expect.any(Function) }))
  })

  it('allows restoring an empty list from edit mode', () => {
    mocks.query = { data: { data: [] } }
    render(<TocRulesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.tocRulesRestore' }))
    expect(mocks.restore).toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'settings.ruleSelectAll' })).toBeDisabled()
  })
})
