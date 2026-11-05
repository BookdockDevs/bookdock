import type { FormEvent } from 'react'

export function validatePasswordInputs(event: FormEvent<HTMLFormElement>) {
  const inputs = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[data-password-input]'))
  for (const input of inputs) {
    if (!input.checkValidity()) {
      event.preventDefault()
      input.focus()
      return false
    }
  }
  return true
}

