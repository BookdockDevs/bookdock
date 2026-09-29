import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import InstanceSettingsSection from '../features/settings/components/InstanceSettingsSection'
import * as authHooks from '../features/auth/hooks'

vi.mock('../features/auth/hooks', () => ({
  useInstanceInfo: vi.fn(),
  useUpdateInstance: vi.fn(),
}))

function mockSection(instance: Record<string, unknown>, mutate = vi.fn()) {
  ;(authHooks.useInstanceInfo as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: instance },
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  ;(authHooks.useUpdateInstance as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false })
  return mutate
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh-CN')
})

describe('InstanceSettingsSection', () => {
  it('renders the operator-run city switches with fail-open defaults', () => {
    mockSection({ allowRegistration: false, allowGuestAccess: false })

    render(<InstanceSettingsSection />)

    // Absent flags read as open, matching the server default.
    expect(screen.getByRole('switch', { name: '允许创建书库' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '允许上传文件' })).toHaveAttribute('aria-checked', 'true')
  })

  it('toggles each switch through the instance endpoint', () => {
    const mutate = mockSection({ allowRegistration: false, allowGuestAccess: false, allowUserCreateLibrary: true, allowUserUpload: true })

    render(<InstanceSettingsSection />)
    fireEvent.click(screen.getByRole('switch', { name: '允许创建书库' }))
    fireEvent.click(screen.getByRole('switch', { name: '允许上传文件' }))

    expect(mutate).toHaveBeenCalledWith({ allowUserCreateLibrary: false }, expect.anything())
    expect(mutate).toHaveBeenCalledWith({ allowUserUpload: false }, expect.anything())
  })
})
