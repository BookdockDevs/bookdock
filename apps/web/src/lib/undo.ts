import type { UndoReceipt } from '@bookdock/shared'

import i18n from '@/i18n/i18n'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'
import type { AddToastOptions } from '@/stores/toast.store'

export const DEFAULT_UNDO_QUERY_KEYS = [['books'], ['book'], ['batch-selection'], ['shelves'], ['tags'], ['libraries']] as const

let token: string | null = null
let toastId: string | null = null
let running = false
let lifecycleSubscribed = false
let expiresAt = 0
let generation = 0
let queryKeys: readonly (readonly unknown[])[] = []
let boundToken: string | null = null
const generationByUser = new Map<string, number>()
const expirationByUser = new Map<string, number>()

function undoAction() {
  return { label: i18n.t('undo.action'), icon: 'undo' as const, keepOpen: true, onClick: () => { void runUndo() }, onExpire: () => clearUndo() }
}

export function attachUndoToNotification(options: AddToastOptions = {}, receipt?: UndoReceipt): AddToastOptions {
  if (!token || !receipt || receipt.token !== token || expiresAt <= Date.now() || boundToken === token) return options
  const action = undoAction()
  const duration = Math.max(1, Math.min(10_000, expiresAt - Date.now()))
  const hasExistingAction = Boolean(options.action || options.secondaryAction)
  const slot = options.action ? 'secondaryAction' : 'action'
  return {
    ...options,
    ...(options.action ? { secondaryAction: action } : { action }),
    duration,
    priority: 'high',
    hardExpiresAt: expiresAt,
    undoActionSlot: slot,
    ...(hasExistingAction ? { undoFallbackDuration: options.duration ?? 12_000 } : {}),
  }
}

export function bindUndoToast(id: string, receipt?: UndoReceipt): void {
  if (receipt?.token === token && token && expiresAt > Date.now() && boundToken !== token) {
    toastId = id
    boundToken = token
  }
}

function ensureLifecycleSubscriptions(): void {
  if (lifecycleSubscribed) return
  lifecycleSubscribed = true
  useAuthStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) {
      clearUndo(true)
      generation = state.user ? generationByUser.get(state.user.id) ?? 0 : 0
    }
  })
  useToastStore.subscribe((state) => {
    if (!toastId) return
    const exists = [...state.toasts, ...state.queuedToasts].some((toast) => toast.id === toastId)
    if (!exists) clearUndo()
  })
}

export function hasUndoOpportunity(): boolean {
  return token !== null && toastId !== null && !running
}

export function publishUndoOpportunity(receipt: { token: string; expiresAt?: number; generation?: number; messageKey?: string; params?: Record<string, string | number>; queryKeys?: readonly (readonly unknown[])[] }): void {
  ensureLifecycleSubscriptions()
  const userId = useAuthStore.getState().user?.id ?? ''
  const lastGeneration = generationByUser.get(userId) ?? 0
  const lastExpiration = expirationByUser.get(userId) ?? 0
  if (receipt.generation !== undefined && receipt.generation < lastGeneration
    && (receipt.expiresAt ?? 0) <= lastExpiration) return
  if (receipt.expiresAt !== undefined && receipt.expiresAt <= Date.now()) return
  if (toastId) {
    const oldToast = [...useToastStore.getState().toasts, ...useToastStore.getState().queuedToasts].find((toast) => toast.id === toastId)
    if (oldToast?.undoActionSlot === 'secondaryAction' && oldToast.action) {
      useToastStore.getState().updateToast(toastId, {
        secondaryAction: undefined, duration: oldToast.undoFallbackDuration ?? oldToast.duration,
        undoActionSlot: undefined, undoFallbackDuration: undefined,
        priority: undefined, hardExpiresAt: undefined,
      })
    } else useToastStore.getState().removeToast(toastId)
  }
  toastId = null
  boundToken = null
  token = receipt.token
  running = false
  generation = receipt.generation ?? generation + 1
  generationByUser.set(userId, generation)
  expiresAt = receipt.expiresAt ?? Date.now() + 120_000
  queryKeys = receipt.queryKeys ?? DEFAULT_UNDO_QUERY_KEYS
  expirationByUser.set(userId, expiresAt)
}

export async function runUndo(): Promise<void> {
  if (!token || !toastId || running) return
  const currentToken = token
  const currentToastId = toastId
  const currentGeneration = generation
  const requestUserId = useAuthStore.getState().user?.id ?? null
  const requestSessionRevision = getAuthSessionRevision()
  const currentToast = [...useToastStore.getState().toasts, ...useToastStore.getState().queuedToasts].find((toast) => toast.id === currentToastId)
  const undoInSecondary = currentToast?.undoActionSlot === 'secondaryAction'
  if (expiresAt <= Date.now()) {
    token = null
    const partial = undoInSecondary && currentToast?.action
    useToastStore.getState().updateToast(currentToastId, {
      message: { key: 'undo.expired' },
      type: 'error',
      ...(undoInSecondary ? { secondaryAction: undefined } : { action: undefined }),
      ...(partial ? {
        action: currentToast.action,
        duration: currentToast.undoFallbackDuration ?? currentToast.duration,
        undoActionSlot: undefined,
        undoFallbackDuration: undefined,
        priority: undefined,
        hardExpiresAt: undefined,
      } : { duration: 9_000, undoActionSlot: undefined, undoFallbackDuration: undefined }),
    })
    return
  }
  running = true
  useToastStore.getState().updateToast(currentToastId, {
    ...(undoInSecondary
      ? { secondaryAction: { label: i18n.t('undo.running'), icon: 'loading', disabled: true, keepOpen: true, onClick: () => undefined, onExpire: () => clearUndo() } }
      : { action: { label: i18n.t('undo.running'), icon: 'loading', disabled: true, keepOpen: true, onClick: () => undefined, onExpire: () => clearUndo() } }),
    duration: 'persistent',
  })
  try {
    const response = await fetch(`/api/v1/books/undo/${encodeURIComponent(currentToken)}`, { method: 'POST' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: string } } | null
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429
      if (retryable) {
        if (currentGeneration !== generation || token !== currentToken) return
        running = false
        useToastStore.getState().updateToast(currentToastId, {
          message: { key: 'undo.retryableFailure' },
          type: 'error',
          ...(undoInSecondary
            ? { secondaryAction: { label: i18n.t('undo.retry'), icon: 'retry', keepOpen: true, onClick: () => { void runUndo() }, onExpire: () => clearUndo() } }
            : { action: { label: i18n.t('undo.retry'), icon: 'retry', keepOpen: true, onClick: () => { void runUndo() }, onExpire: () => clearUndo() } }),
          duration: Math.max(1, Math.min(10_000, expiresAt - Date.now())),
        })
        return
      }
      if (response.status === 401) {
        if (currentGeneration !== generation || token !== currentToken
          || requestUserId !== (useAuthStore.getState().user?.id ?? null)
          || requestSessionRevision !== getAuthSessionRevision()) return
        useAuthStore.getState().clearAuth()
        window.dispatchEvent(new CustomEvent('bd:unauthorized'))
        return
      }
      if (currentGeneration !== generation || token !== currentToken) return
      token = null
      running = false
      const partial = undoInSecondary && currentToast?.action
      useToastStore.getState().updateToast(currentToastId, {
        message: { key: body?.error?.code === 'UNDO_CONFLICT'
          ? 'undo.conflict'
          : body?.error?.code === 'FORBIDDEN' || body?.error?.code === 'ACCOUNT_DISABLED'
            ? 'undo.permissionChanged'
            : 'undo.expired' },
        type: 'error',
        ...(undoInSecondary ? { secondaryAction: undefined } : { action: undefined }),
        ...(partial ? {
          action: currentToast.action,
          duration: currentToast.undoFallbackDuration ?? currentToast.duration,
          undoActionSlot: undefined,
          undoFallbackDuration: undefined,
          priority: undefined,
          hardExpiresAt: undefined,
        } : { duration: 9_000, undoActionSlot: undefined, undoFallbackDuration: undefined }),
      })
      return
    }
    if (currentGeneration !== generation || token !== currentToken) return
    token = null
    running = false
    const partial = undoInSecondary && currentToast?.action
    const partialParams = typeof currentToast?.message === 'object' ? currentToast.message.params : undefined
    useToastStore.getState().updateToast(currentToastId, {
      message: partial
        ? { key: 'undo.partialSucceeded', params: { succeeded: partialParams?.succeeded ?? 0, failed: partialParams?.failed ?? 0 } }
        : { key: 'undo.succeeded' },
      type: 'success',
      action: partial ? currentToast.action : undefined,
      secondaryAction: undefined,
      duration: partial ? currentToast.undoFallbackDuration ?? currentToast.duration : 4_000,
      undoActionSlot: undefined,
      undoFallbackDuration: undefined,
      priority: undefined,
      hardExpiresAt: undefined,
    })
    window.dispatchEvent(new CustomEvent('bd:undo-complete', { detail: { queryKeys } }))
  } catch {
    if (currentGeneration !== generation || token !== currentToken) return
    running = false
    useToastStore.getState().updateToast(currentToastId, {
      message: { key: 'undo.retryableFailure' },
      type: 'error',
      ...(undoInSecondary
        ? { secondaryAction: { label: i18n.t('undo.retry'), icon: 'retry', keepOpen: true, onClick: () => { void runUndo() }, onExpire: () => clearUndo() } }
        : { action: { label: i18n.t('undo.retry'), icon: 'retry', keepOpen: true, onClick: () => { void runUndo() }, onExpire: () => clearUndo() } }),
      duration: Math.max(1, Math.min(10_000, expiresAt - Date.now())),
    })
  }
}

function clearUndo(removeToast = false): void {
  if (removeToast && toastId) useToastStore.getState().removeToast(toastId)
  token = null
  toastId = null
  running = false
  expiresAt = 0
  boundToken = null
  queryKeys = []
}
