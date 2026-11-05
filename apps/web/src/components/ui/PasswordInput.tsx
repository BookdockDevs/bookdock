import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  secret?: boolean
  matches?: string
  error?: string | null
  hint?: string
  action?: ReactNode
  validationValue?: string
}

export default function PasswordInput({
  secret = false,
  matches,
  error,
  hint,
  action,
  validationValue,
  id,
  value,
  required,
  minLength,
  maxLength,
  disabled,
  className,
  onBlur,
  onInvalid,
  'aria-describedby': describedBy,
  ...props
}: PasswordInputProps) {
  const _ = useTranslation()
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-feedback`
  const inputRef = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState(false)
  const [touched, setTouched] = useState(false)
  const text = validationValue ?? String(value ?? '')
  let validationError: string | null = null
  if (required && !text) {
    validationError = _(secret ? 'passwordInput.secretRequired' : 'auth.errors.passwordRequired')
  } else if (text && minLength !== undefined && text.length < minLength) {
    validationError = _(secret ? 'passwordInput.tooShort' : 'auth.passwordTooShort', { min: minLength })
  } else if (maxLength !== undefined && text.length > maxLength) {
    validationError = _(secret ? 'passwordInput.tooLong' : 'auth.errors.passwordTooLong', { max: maxLength })
  } else if (matches !== undefined && text !== matches) {
    validationError = _('auth.passwordMismatch')
  }
  const feedback = error || (touched ? validationError : null)
  const toggleLabel = _(secret
    ? visible ? 'passwordInput.hideSecret' : 'passwordInput.showSecret'
    : visible ? 'passwordInput.hidePassword' : 'passwordInput.showPassword')

  useLayoutEffect(() => {
    inputRef.current?.setCustomValidity(validationError ?? '')
  }, [validationError])

  return (
    <span className="flex min-w-0 w-full flex-col gap-1.5">
      <span className="relative block w-full">
        <input
          {...props}
          ref={inputRef}
          id={inputId}
          data-password-input
          type={visible ? 'text' : 'password'}
          value={value}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          disabled={disabled}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={Boolean(feedback) || props['aria-invalid'] || false}
          aria-describedby={[describedBy, feedback || hint ? messageId : undefined].filter(Boolean).join(' ') || undefined}
          onBlur={(event) => { setTouched(true); onBlur?.(event) }}
          onInvalid={(event) => {
            event.preventDefault()
            setTouched(true)
            // Reading validity avoids redispatching invalid events in selector engines.
            const fields = event.currentTarget.form?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')
            const firstInvalid = fields && Array.from(fields).find((field) => field.willValidate && !field.validity.valid)
            if (firstInvalid === event.currentTarget) event.currentTarget.focus()
            onInvalid?.(event)
          }}
          className={cn(className, 'w-full', action ? 'pr-20' : 'pr-11', 'aria-invalid:border-red-400 dark:aria-invalid:border-red-500')}
        />
        <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button
            type="button"
            disabled={disabled}
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-controls={inputId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setVisible((current) => !current)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 outline-none transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:ring-2 focus-visible:ring-stone-400/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {visible ? <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><path d="m2 2 20 20" /></> : <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>}
            </svg>
          </button>
          {action}
        </span>
      </span>
      {feedback ? <span id={messageId} role="alert" className="text-xs text-red-600 dark:text-red-400">{feedback}</span> : hint ? <span id={messageId} className="text-xs text-stone-500 dark:text-stone-400">{hint}</span> : null}
    </span>
  )
}
