import { useEffect, useMemo, useRef, useState } from 'react'

import {
  INSTANCE_INVITE_CODE_ALPHABET,
  INSTANCE_INVITE_CODE_MAX_LENGTH,
  INSTANCE_INVITE_LABEL_MAX_LENGTH,
  INSTANCE_INVITE_RANDOM_LENGTH,
  isValidInstanceInviteCode,
  normalizeInstanceInviteCode,
  type InstanceInviteRes,
} from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import { useCreateInstanceInvite, useDeleteInstanceInvite, useInstanceInvites } from '@/features/auth/hooks'
import { useLibraries } from '@/features/library/hooks'
import { buildInstanceInviteLink } from '@/features/library/invite-link'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { formatDate } from '@/lib/format-date'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import SettingsCard from './SettingsCard'

type ExpiryUnit = 'days' | 'hours'

const MAX_USES_LIMIT = 1_000_000
const MAX_EXPIRY_VALUE: Record<ExpiryUnit, number> = {
  days: 3650,
  hours: 24 * 365,
}
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const fieldLabelClass = 'mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300'
const actionIconBtnClass = 'flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200'

function generateRandomInviteCode(): string {
  const bytes = new Uint32Array(INSTANCE_INVITE_RANDOM_LENGTH)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < INSTANCE_INVITE_RANDOM_LENGTH; i += 1) {
    out += INSTANCE_INVITE_CODE_ALPHABET[bytes[i]! % INSTANCE_INVITE_CODE_ALPHABET.length]!
  }
  return out
}

function stepNumberString(raw: string, delta: number, max: number): string {
  const parsed = Number.parseInt(raw.trim(), 10)
  const base = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
  return String(Math.min(max, Math.max(1, base + delta)))
}

function TicketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

function DiceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

interface NumberStepperProps {
  value: string
  fallback: string
  max: number
  ariaLabel: string
  decreaseLabel: string
  increaseLabel: string
  onChange: (next: string) => void
}

function clampPositiveInt(raw: string, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(max, parsed)
}

function NumberStepper({ value, fallback, max, ariaLabel, decreaseLabel, increaseLabel, onChange }: NumberStepperProps) {
  const parsed = Number.parseInt(value.trim(), 10)
  const canDecrease = Number.isFinite(parsed) ? parsed > 1 : false
  const canIncrease = Number.isFinite(parsed) ? parsed < max : true

  function handleInputChange(raw: string) {
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
    if (!digits) {
      onChange('')
      return
    }
    const n = Number.parseInt(digits, 10)
    onChange(String(Math.min(max, n)))
  }

  return (
    <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={!canDecrease}
        onClick={() => onChange(stepNumberString(value, -1, max))}
        className="flex h-full w-8 items-center justify-center text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onKeyDown={(e) => {
          if (e.key === '-' || e.key === '+' || e.key === '.' || e.key === ',' || e.key === 'e' || e.key === 'E') {
            e.preventDefault()
          }
        }}
        onChange={(e) => handleInputChange(e.target.value)}
        onBlur={() => {
          if (!value || Number.parseInt(value, 10) < 1) onChange(fallback)
        }}
        aria-label={ariaLabel}
        className="h-full w-14 border-x border-stone-200 bg-transparent px-1.5 text-center text-sm tabular-nums text-stone-800 outline-none dark:border-stone-700 dark:text-stone-100"
      />
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={!canIncrease}
        onClick={() => onChange(stepNumberString(value, 1, max))}
        className="flex h-full w-8 items-center justify-center text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
      >
        +
      </button>
    </div>
  )
}

export default function InstanceInvitesSection() {
  const _ = useTranslation()
  const invitesQuery = useInstanceInvites()
  const createInvite = useCreateInstanceInvite()
  const deleteInvite = useDeleteInstanceInvite()
  const librariesQuery = useLibraries()

  const [createOpen, setCreateOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<InstanceInviteRes | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const [codeInput, setCodeInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [usesUnlimited, setUsesUnlimited] = useState(true)
  const [usesValue, setUsesValue] = useState('5')
  const [expiresUnlimited, setExpiresUnlimited] = useState(true)
  const [expiresValue, setExpiresValue] = useState('7')
  const [expiryUnit, setExpiryUnit] = useState<ExpiryUnit>('days')
  const [autoJoinLibraryIds, setAutoJoinLibraryIds] = useState<string[]>([])

  const [codeError, setCodeError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const bindableLibraries = useMemo(
    () => (librariesQuery.data?.data ?? []).filter(
      (lib) => lib.type === 'shared' && (lib.relation === 'owner' || lib.relation === 'admin'),
    ),
    [librariesQuery.data],
  )

  const invites = invitesQuery.data?.data ?? []

  function resetForm() {
    setCodeInput('')
    setLabelInput('')
    setUsesUnlimited(true)
    setUsesValue('5')
    setExpiresUnlimited(true)
    setExpiresValue('7')
    setExpiryUnit('days')
    setAutoJoinLibraryIds([])
    setCodeError(null)
    setSubmitError(null)
  }

  function openCreateModal() {
    resetForm()
    setCreateOpen(true)
  }

  function toggleAutoJoinLibrary(libraryId: string) {
    setAutoJoinLibraryIds((prev) => (
      prev.includes(libraryId)
        ? prev.filter((id) => id !== libraryId)
        : [...prev, libraryId]
    ))
  }

  async function copyToClipboard(key: string, text: string, successKey: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 2000)
      notify.success(_(successKey))
    } catch {
      notify.error(_('common.copyFailed'))
    }
  }

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (createInvite.isPending) return
    setCodeError(null)
    setSubmitError(null)

    const trimmedCode = codeInput.trim()
    if (trimmedCode.length === 0) {
      setCodeError(_('auth.errors.inviteCodeRequired'))
      return
    }
    if (!isValidInstanceInviteCode(trimmedCode)) {
      setCodeError(_('admin.inviteCodeFormatInvalid'))
      return
    }

    const maxUses = usesUnlimited ? null : clampPositiveInt(usesValue, MAX_USES_LIMIT, 5)
    const expiresAt = expiresUnlimited
      ? null
      : Date.now() + clampPositiveInt(expiresValue, MAX_EXPIRY_VALUE[expiryUnit], 7) * (expiryUnit === 'days' ? DAY_MS : HOUR_MS)

    try {
      await createInvite.mutateAsync({
        code: normalizeInstanceInviteCode(trimmedCode),
        ...(labelInput.trim() ? { label: labelInput.trim() } : {}),
        autoJoinLibraryIds,
        maxUses,
        expiresAt,
      })
      setCreateOpen(false)
      resetForm()
      notify.success(_('admin.inviteCreated'))
    } catch (error) {
      const msg = getUserErrorMessage(error, _, 'admin.inviteCreateFailed')
      if (
        error instanceof ApiError
        && (error.code === 'INVITE_CODE_TAKEN' || error.code === 'INVITE_CODE_INVALID' || error.code === 'INVITE_CODE_REQUIRED')
      ) {
        setCodeError(msg)
      } else {
        setSubmitError(msg)
      }
    }
  }

  return (
    <>
      <SettingsCard
        icon={<TicketIcon className="h-5 w-5" />}
        iconBgClass="bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400"
        title={_('admin.instanceInvites')}
        action={
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 whitespace-nowrap gap-1.5"
            onClick={openCreateModal}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {_('admin.createInvite')}
          </Button>
        }
        bodyClassName="pt-3"
      >
        {invitesQuery.isError ? (
          <QueryErrorState className="py-4" isRetrying={invitesQuery.isFetching} onRetry={invitesQuery.refetch} />
        ) : invitesQuery.isLoading ? (
          <div className="flex flex-col gap-3 pt-1" aria-busy="true" aria-label={_('admin.inviteLoading')}>
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex animate-pulse flex-col gap-2 rounded-xl border border-stone-200/50 bg-stone-50/30 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-stone-800/60 dark:bg-stone-800/20"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-24 rounded-md bg-stone-200/70 dark:bg-stone-800" />
                    <div className="h-3.5 w-12 rounded-full bg-stone-200/50 dark:bg-stone-800/60" />
                  </div>
                  <div className="h-3 w-44 rounded bg-stone-200/40 dark:bg-stone-800/40" />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="h-7 w-16 rounded-lg bg-stone-200/60 dark:bg-stone-800" />
                  <div className="h-7 w-16 rounded-lg bg-stone-200/60 dark:bg-stone-800" />
                </div>
              </div>
            ))}
          </div>
        ) : invites.length === 0 ? (
          <SettingsEmptyState>{_('admin.inviteEmpty')}</SettingsEmptyState>
        ) : (
          <div className="flex flex-col gap-3 pt-1">
            {invites.map((invite) => {
              const isInactive = invite.status !== 'active'
              const usageText = invite.maxUses !== null
                ? _('admin.inviteUsage', { used: invite.usedCount, max: invite.maxUses })
                : _('admin.inviteUsageUnlimited', { used: invite.usedCount })
              const expiryText = invite.expiresAt === null ? _('admin.inviteNeverExpires') : null
              const autoJoinText = invite.autoJoinLibraries.length > 0
                ? _('admin.inviteAutoJoinInline', {
                    names: invite.autoJoinLibraries.map((lib) => lib.name).join(_('auth.inviteAutoJoinSeparator')),
                  })
                : null
              const metaParts = [usageText, expiryText, autoJoinText].filter(Boolean)
              const codeKey = `${invite.id}:code`
              const linkKey = `${invite.id}:link`

              return (
                <div
                  key={invite.id}
                  className={cn(
                    'group flex flex-col gap-2 rounded-xl border border-stone-200/70 bg-stone-50/40 p-3 transition-all hover:border-stone-300 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-stone-800 dark:bg-stone-800/40 dark:hover:border-stone-700',
                    isInactive && 'opacity-70',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {invite.label ? (
                        <>
                          <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                            {invite.label}
                          </span>
                          <code className="rounded-md bg-stone-200/60 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                            {invite.code}
                          </code>
                        </>
                      ) : (
                        <code className="font-mono text-sm font-semibold text-stone-800 dark:text-stone-200">
                          {invite.code}
                        </code>
                      )}

                      {invite.status === 'expired' ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                          title={invite.expiresAt !== null ? _('admin.inviteExpiresAt', { date: formatDate(invite.expiresAt) }) : undefined}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          {_('admin.inviteStatusExpired')}
                        </span>
                      ) : invite.status === 'exhausted' ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {_('admin.inviteStatusExhausted')}
                        </span>
                      ) : invite.expiresAt !== null ? (
                        <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                          {_('admin.inviteExpiresAt', { date: formatDate(invite.expiresAt) })}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {metaParts.join(' · ')}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5 border-t border-stone-200/50 pt-2 sm:border-t-0 sm:pt-0 dark:border-stone-800/60">
                    <button
                      type="button"
                      aria-label={_('admin.inviteCopyCode')}
                      title={_('admin.inviteCopyCode')}
                      onClick={() => void copyToClipboard(codeKey, invite.code, 'admin.inviteCodeCopied')}
                      className={actionIconBtnClass}
                    >
                      {copiedKey === codeKey ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    <button
                      type="button"
                      aria-label={_('admin.inviteCopyLink')}
                      title={_('admin.inviteCopyLink')}
                      onClick={() => void copyToClipboard(linkKey, buildInstanceInviteLink(invite.code), 'admin.inviteLinkCopied')}
                      className={actionIconBtnClass}
                    >
                      {copiedKey === linkKey ? <CheckIcon /> : <LinkIcon />}
                    </button>
                    <div className="mx-1 h-3.5 w-px bg-stone-200 dark:bg-stone-700" />
                    <button
                      type="button"
                      aria-label={_('admin.inviteDelete')}
                      title={_('admin.inviteDelete')}
                      disabled={deleteInvite.isPending}
                      onClick={() => setPendingDelete(invite)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingsCard>

      {createOpen && (
        <Modal
          title={_('admin.createInviteTitle')}
          onClose={() => setCreateOpen(false)}
          centered
        >
          <form onSubmit={handleCreateSubmit} noValidate className="flex flex-col gap-4">
            <div>
              <label htmlFor="invite-code-input" className={fieldLabelClass}>
                {_('admin.inviteCodeLabel')}
              </label>
              <div
                className={cn(
                  'flex h-9 items-center rounded-xl border bg-white transition-colors dark:bg-stone-900',
                  codeError
                    ? 'border-red-500/80 dark:border-red-500/70'
                    : 'border-stone-200 focus-within:border-stone-400 dark:border-stone-700 dark:focus-within:border-stone-500',
                )}
              >
                <input
                  id="invite-code-input"
                  type="text"
                  required
                  autoFocus
                  aria-invalid={codeError ? true : undefined}
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value)
                    setCodeError(null)
                    setSubmitError(null)
                  }}
                  maxLength={INSTANCE_INVITE_CODE_MAX_LENGTH}
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-stone-800 outline-none dark:text-stone-100"
                />
                <button
                  type="button"
                  aria-label={_('admin.inviteRandomize')}
                  title={_('admin.inviteRandomize')}
                  onClick={() => {
                    setCodeInput(generateRandomInviteCode())
                    setCodeError(null)
                    setSubmitError(null)
                  }}
                  className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <DiceIcon />
                </button>
              </div>
              {codeError && (
                <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">{codeError}</p>
              )}
            </div>

            <div>
              <label htmlFor="invite-label-input" className={fieldLabelClass}>
                {_('admin.inviteLabelField')}
              </label>
              <input
                id="invite-label-input"
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                maxLength={INSTANCE_INVITE_LABEL_MAX_LENGTH}
                placeholder={_('admin.inviteLabelPlaceholder')}
                className="h-9 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
              />
            </div>

            <div>
              <span className={fieldLabelClass}>
                {_('admin.inviteMaxUses')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-stone-100 p-1 dark:bg-stone-800" role="group">
                  <button
                    type="button"
                    aria-pressed={usesUnlimited}
                    onClick={() => setUsesUnlimited(true)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      usesUnlimited
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                    )}
                  >
                    {_('admin.inviteUsesUnlimited')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!usesUnlimited}
                    onClick={() => setUsesUnlimited(false)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      !usesUnlimited
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                    )}
                  >
                    {_('admin.inviteUsesLimited')}
                  </button>
                </div>

                {!usesUnlimited && (
                  <>
                    <NumberStepper
                      value={usesValue}
                      fallback="5"
                      max={MAX_USES_LIMIT}
                      ariaLabel={_('admin.inviteMaxUses')}
                      decreaseLabel={`${_('admin.inviteMaxUses')} -`}
                      increaseLabel={`${_('admin.inviteMaxUses')} +`}
                      onChange={setUsesValue}
                    />
                    <span className="text-xs text-stone-500 dark:text-stone-400">{_('admin.inviteUnitUses')}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <span className={fieldLabelClass}>
                {_('admin.inviteExpiresIn')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-stone-100 p-1 dark:bg-stone-800" role="group">
                  <button
                    type="button"
                    aria-pressed={expiresUnlimited}
                    onClick={() => setExpiresUnlimited(true)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      expiresUnlimited
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                    )}
                  >
                    {_('admin.inviteExpiresUnlimited')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!expiresUnlimited}
                    onClick={() => setExpiresUnlimited(false)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      !expiresUnlimited
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                    )}
                  >
                    {_('admin.inviteExpiresLimited')}
                  </button>
                </div>

                {!expiresUnlimited && (
                  <>
                    <NumberStepper
                      value={expiresValue}
                      fallback="7"
                      max={MAX_EXPIRY_VALUE[expiryUnit]}
                      ariaLabel={_('admin.inviteExpiresIn')}
                      decreaseLabel={`${_('admin.inviteExpiresIn')} -`}
                      increaseLabel={`${_('admin.inviteExpiresIn')} +`}
                      onChange={setExpiresValue}
                    />
                    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-stone-100 p-1 dark:bg-stone-800" role="group">
                      {([
                        ['days', 'admin.inviteUnitDays'],
                        ['hours', 'admin.inviteUnitHours'],
                      ] as const).map(([unit, key]) => (
                        <button
                          key={unit}
                          type="button"
                          aria-pressed={expiryUnit === unit}
                          onClick={() => {
                            setExpiryUnit(unit)
                            setExpiresValue((prev) => (prev ? String(clampPositiveInt(prev, MAX_EXPIRY_VALUE[unit], 7)) : prev))
                          }}
                          className={cn(
                            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            expiryUnit === unit
                              ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                              : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                          )}
                        >
                          {_(key)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {bindableLibraries.length > 0 && (
              <div>
                <span className={fieldLabelClass}>
                  {_('admin.inviteAutoJoinLibrary')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {bindableLibraries.map((lib) => {
                    const selected = autoJoinLibraryIds.includes(lib.id)
                    return (
                      <button
                        key={lib.id}
                        type="button"
                        onClick={() => toggleAutoJoinLibrary(lib.id)}
                        aria-pressed={selected}
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          selected
                            ? 'border-stone-900 bg-stone-900 text-white shadow-xs dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                            : 'border-stone-200 bg-white/60 text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-100',
                        )}
                      >
                        <span>{lib.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {submitError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">{submitError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreateOpen(false)}>
                {_('library.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={createInvite.isPending}>
                {_('admin.inviteCreateSubmit')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={_('admin.inviteDeleteTitle')}
          message={_('admin.inviteDeleteConfirm', { code: pendingDelete.code })}
          confirmLabel={_('admin.inviteDelete')}
          confirmVariant="danger"
          errorFallback="admin.inviteDeleteFailed"
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            await deleteInvite.mutateAsync(pendingDelete.id)
            setPendingDelete(null)
            notify.success(_('admin.inviteDeleted'))
          }}
        />
      )}
    </>
  )
}
