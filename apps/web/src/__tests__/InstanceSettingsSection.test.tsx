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
  it('groups member permissions with enabled defaults and keeps guest access separate', () => {
    mockSection({ allowRegistration: false, allowGuestAccess: false })

    render(<InstanceSettingsSection />)

    expect(screen.getByRole('heading', { name: '访问控制' })).toBeInTheDocument()
    const permissions = screen.getByRole('group', { name: '成员权限' })
    expect(permissions).toContainElement(screen.getByRole('checkbox', { name: '创建书库', checked: true }))
    expect(permissions).toContainElement(screen.getByRole('checkbox', { name: '上传书籍', checked: true }))
    expect(screen.getByRole('switch', { name: '游客访问' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })

  it('updates each member permission independently through the instance endpoint', () => {
    const mutate = mockSection({ allowRegistration: false, allowGuestAccess: false, allowUserCreateLibrary: true, allowUserUpload: true })

    render(<InstanceSettingsSection />)
    fireEvent.click(screen.getByRole('checkbox', { name: '创建书库' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '上传书籍' }))

    expect(mutate).toHaveBeenCalledWith({ allowUserCreateLibrary: false }, expect.anything())
    expect(mutate).toHaveBeenCalledWith({ allowUserUpload: false }, expect.anything())
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('enables an unselected permission without changing guest access', () => {
    const mutate = mockSection({ allowGuestAccess: true, allowUserCreateLibrary: false, allowUserUpload: true })

    render(<InstanceSettingsSection />)
    fireEvent.click(screen.getByRole('checkbox', { name: '创建书库', checked: false }))

    expect(mutate).toHaveBeenCalledExactlyOnceWith({ allowUserCreateLibrary: true }, expect.anything())
    expect(screen.getByRole('switch', { name: '游客访问' })).toHaveAttribute('aria-checked', 'true')
  })

  it('updates guest access independently', () => {
    const mutate = mockSection({ allowGuestAccess: false })

    render(<InstanceSettingsSection />)
    fireEvent.click(screen.getByRole('switch', { name: '游客访问' }))

    expect(mutate).toHaveBeenCalledExactlyOnceWith({ allowGuestAccess: true }, expect.anything())
  })

  it('disables access and permission controls while saving', () => {
    const mutate = mockSection({ registrationMode: 'closed', allowGuestAccess: false })
    vi.mocked(authHooks.useUpdateInstance).mockReturnValue({ mutate, isPending: true } as unknown as ReturnType<typeof authHooks.useUpdateInstance>)

    render(<InstanceSettingsSection />)
    const upload = screen.getByRole('checkbox', { name: '上传书籍' })
    const createLibrary = screen.getByRole('checkbox', { name: '创建书库' })
    expect(upload).toBeDisabled()
    expect(createLibrary).toBeDisabled()
    expect(screen.getByRole('switch', { name: '游客访问' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '仅邀请码' })).toBeDisabled()
    fireEvent.click(upload)
    fireEvent.click(createLibrary)
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each([
    [{ allowUserUpload: false }, '上传书籍'],
    [{ allowUserCreateLibrary: false }, '创建书库'],
    [{ allowGuestAccess: true }, '游客访问'],
  ])('keeps registration styling stable while saving %o', (variables, savingLabel) => {
    const mutate = mockSection({ registrationMode: 'invite', allowGuestAccess: false })
    const { rerender } = render(<InstanceSettingsSection />)
    const registration = screen.getByRole('radio', { name: '仅邀请码' })
    const controls = [registration, screen.getByRole('checkbox', { name: '上传书籍' }), screen.getByRole('checkbox', { name: '创建书库' }), screen.getByRole('switch', { name: '游客访问' })]
    const classes = controls.map((control) => control.className)

    vi.mocked(authHooks.useUpdateInstance).mockReturnValue({ mutate, isPending: true, variables } as unknown as ReturnType<typeof authHooks.useUpdateInstance>)
    rerender(<InstanceSettingsSection />)

    expect(controls.map((control) => control.className)).toEqual(classes)
    for (const control of controls) {
      expect(control).not.toHaveClass('disabled:opacity-50')
      expect(control).not.toHaveClass('opacity-50')
      expect(control).not.toHaveClass('opacity-60')
    }
    expect(registration).toHaveAttribute('aria-checked', 'true')
    expect(registration).toBeDisabled()
    expect(screen.getByRole(savingLabel === '游客访问' ? 'switch' : 'checkbox', { name: savingLabel })).toBeDisabled()
  })

  it('updates registrationMode via the 3-state selector', () => {
    const mutate = mockSection({ registrationMode: 'closed', allowRegistration: false, allowGuestAccess: false })

    render(<InstanceSettingsSection />)
    fireEvent.click(screen.getByRole('radio', { name: '仅邀请码' }))
    expect(mutate).toHaveBeenCalledWith({ registrationMode: 'invite' }, expect.anything())
  })
})
