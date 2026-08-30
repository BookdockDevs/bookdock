import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { TocRuleRes } from '@bookdock/shared'

import TocRulesSettingsSection from '../features/settings/components/TocRulesSettingsSection'

const rules: TocRuleRes[] = [
  { id: 'rule-1', name: '规则一', enabled: true, sortOrder: 0, patterns: [{ level: 1, regex: '^一', replacement: null, enabled: true }], createdAt: 1, updatedAt: 1 },
  { id: 'rule-2', name: '规则二', enabled: false, sortOrder: 1, patterns: [{ level: 2, regex: '^二', replacement: null, enabled: true }], createdAt: 2, updatedAt: 2 },
]

vi.mock('@/api/hooks/useTocRules', () => ({
  useTocRules: () => ({ data: { data: rules } }),
  useDeleteTocRule: () => ({ mutate: vi.fn() }),
  useReorderTocRules: () => ({ mutate: vi.fn() }),
  useSeedTocRules: () => ({ mutate: vi.fn() }),
}))

describe('TocRulesSettingsSection', () => {
  it('renders a dedicated drag handle instead of move arrows', () => {
    render(<TocRulesSettingsSection />)

    expect(screen.getAllByRole('button', { name: 'settings.tocRulesReorder' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'settings.moveUp' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'settings.moveDown' })).toBeNull()
  })
})
