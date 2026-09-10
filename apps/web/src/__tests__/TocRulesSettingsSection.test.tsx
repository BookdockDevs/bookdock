import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { TocRuleRes } from '@bookdock/shared'

import TocRulesSettingsSection from '../features/settings/components/TocRulesSettingsSection'

const rules: TocRuleRes[] = [
  { id: 'rule-1', name: '规则一', enabled: true, sortOrder: 0, patterns: [{ level: 1, regex: '^一', replacement: null, enabled: true }], builtIn: true, createdAt: 1, updatedAt: 1 },
  { id: 'rule-2', name: '规则二', enabled: false, sortOrder: 1, patterns: [{ level: 2, regex: '^二', replacement: null, enabled: true }], builtIn: false, createdAt: 2, updatedAt: 2 },
]

vi.mock('@/api/hooks/useTocRules', () => ({
  useTocRules: () => ({ data: { data: rules } }),
  useCreateTocRule: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTocRule: () => ({ mutate: vi.fn() }),
  useReorderTocRules: () => ({ mutate: vi.fn() }),
  useSeedTocRules: () => ({ mutate: vi.fn() }),
  useUpdateTocRule: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('TocRulesSettingsSection', () => {
  it('shows drag handles only while sorting instead of move arrows', () => {
    render(<TocRulesSettingsSection />)

    expect(screen.getByText('· 2')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'settings.tocRulesReorder' })).toHaveLength(0)
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'settings.tocRulesRestore' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.moveUp' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'settings.moveDown' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    expect(screen.getAllByRole('button', { name: 'settings.tocRulesReorder' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'settings.tocRulesEditShort' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeExit' }))
    expect(screen.queryAllByRole('button', { name: 'settings.tocRulesReorder' })).toHaveLength(0)
  })

  it('keeps the rule toggle in the list instead of the editor', () => {
    render(<TocRulesSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.tocRulesEditShort' })[0]!)

    expect(screen.getAllByRole('switch')).toHaveLength(2)
  })

  it('shows the rule source badge', () => {
    render(<TocRulesSettingsSection />)

    expect(screen.getByText('settings.tocRulesBuiltIn')).toBeInTheDocument()
    expect(screen.getByText('settings.tocRulesCustom')).toBeInTheDocument()
  })

  it('uses the styled confirmation dialog for deletion', () => {
    render(<TocRulesSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.editModeEnter' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.tocRulesDelete' })[0]!)

    expect(screen.getByText('settings.confirmDeleteTitle')).toBeInTheDocument()
    expect(screen.getByText('settings.tocRulesDeleteConfirm')).toBeInTheDocument()
  })
})
