import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PasswordInput from '@/components/ui/PasswordInput'
import { validatePasswordInputs } from '@/components/ui/password-input-validation'

import i18n from '../i18n/i18n'

function PasswordForm({ submit = () => {} }: { submit?: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  return <form noValidate onSubmit={(event) => {
    event.preventDefault()
    if (validatePasswordInputs(event)) submit()
  }}>
    <PasswordInput aria-label="Password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} />
    <PasswordInput aria-label="Confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} required matches={password} maxLength={128} />
    <button type="submit">Submit</button>
  </form>
}

describe('PasswordInput', () => {
  beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

  it('hides the visibility toggle when empty and reveals fields independently once entered', () => {
    const submit = vi.fn()
    render(<PasswordForm submit={submit} />)
    const password = screen.getByLabelText('Password')
    const confirm = screen.getByLabelText('Confirm')
    expect(screen.queryByRole('button', { name: '显示密码' })).toBeNull()
    fireEvent.change(password, { target: { value: ' secret12 ' } })
    expect(password).toHaveAttribute('type', 'password')
    const toggle = screen.getByRole('button', { name: '显示密码' })
    expect(toggle.tabIndex).toBe(0)
    fireEvent.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue(' secret12 ')
    expect(confirm).toHaveAttribute('type', 'password')
    expect(submit).not.toHaveBeenCalled()
    fireEvent.change(password, { target: { value: '' } })
    expect(screen.getByRole('button', { name: '隐藏密码' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))
    expect(password).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('button', { name: '显示密码' })).toBeNull()
  })

  it('stays quiet when blurring an untouched empty field, but validates on edit+blur or submit', () => {
    const submit = vi.fn()
    render(<PasswordForm submit={submit} />)
    const password = screen.getByLabelText('Password')
    fireEvent.focus(password)
    fireEvent.blur(password)
    expect(password).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.change(password, { target: { value: 'a' } })
    fireEvent.change(password, { target: { value: '' } })
    fireEvent.blur(password)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('请输入密码')

    fireEvent.change(password, { target: { value: 'short' } })
    fireEvent.blur(password)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('密码长度至少为 8 位')
    fireEvent.click(screen.getByText('Submit'))
    expect(password).toHaveFocus()
    expect(submit).not.toHaveBeenCalled()
    fireEvent.change(password, { target: { value: 'password12' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByText('Submit'))
    expect(screen.getByLabelText('Confirm')).toHaveFocus()
  })

  it('revalidates confirmation when either password changes', () => {
    render(<PasswordForm />)
    const password = screen.getByLabelText('Password')
    const confirm = screen.getByLabelText('Confirm')
    fireEvent.change(password, { target: { value: 'password12' } })
    fireEvent.change(confirm, { target: { value: 'different' } })
    fireEvent.blur(confirm)
    expect(confirm).toHaveAccessibleDescription('两次输入的密码不一致')
    fireEvent.change(password, { target: { value: 'different' } })
    expect(confirm).toHaveAttribute('aria-invalid', 'false')
    fireEvent.change(password, { target: { value: 'password12' } })
    expect(confirm).toHaveAttribute('aria-invalid', 'true')
  })

  it('preserves a configured secret placeholder and keeps its action independent', () => {
    const clear = vi.fn()
    const { rerender } = render(<PasswordInput secret aria-label="API Key" value="" placeholder="已配置，留空保留" action={<button type="button" onClick={clear}>Clear</button>} disabled />)
    expect(screen.getByLabelText('API Key')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '显示密钥' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('已配置，留空保留')).toHaveAttribute('type', 'password')

    rerender(<PasswordInput secret aria-label="API Key" value="sk-test" placeholder="已配置，留空保留" action={<button type="button" onClick={clear}>Clear</button>} disabled />)
    expect(screen.getByRole('button', { name: '显示密钥' })).toBeDisabled()
  })
})
