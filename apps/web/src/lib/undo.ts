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
// Local (vault) operations cannot undo through the server token endpoint; when
// present, runUndo executes this callback instead of POSTing /api/v1/undo/:token.
let execute: (() => Promise<void>) | null = null
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

export function publishUndoOpportunity(receipt: { token: string; expiresAt?: number; generation?: number; messageKey?: string; params?: Record<string, string | number>; queryKeys?: readonly (readonly unknown[])[]; execute?: () => Promise<void> }): void {
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
  execute = receipt.execute ?? null
  generation = receipt.generation ?? generation + 1
  generationByUser.set(userId, generation)
  expiresAt = receipt.expiresAt ?? Date.now() + 120_000
  queryKeys = receipt.queryKeys ?? DEFAULT_UNDO_QUERY_KEYS
  expirationByUser.set(userId, expiresAt)
}

function undoSlotPatch(label: string, undoInSecondary: boolean) {
  const action = { label, icon: 'loading' as const, disabled: true, keepOpen: true, onClick: () => undefined, onExpire: () => clearUndo() }
  return {
    ...(undoInSecondary ? { secondaryAction: action } : { action }),
  }
}

/**
 * Report an undo outcome where the user will actually see it.
 *
 * The undo affordance lives inside the toast that announced the save, so the
 * natural way to report the result is to rewrite that toast. It is not reliable
 * on its own: the toast can be evicted by a higher-priority one, expire, or be
 * dropped with its queue entry between the click and the response, and
 * `updateToast` is a silent no-op for an id that no longer exists — which is
 * how "撤销" could complete with no feedback at all. When the original toast is
 * gone, post a fresh one instead of losing the outcome.
 */
function finishToast(
  toastId: string,
  update: Parameters<ReturnType<typeof useToastStore.getState>['updateToast']>[1],
  fallback: { key: string; type: 'success' | 'error' | 'warning' | 'info' },
): void {
  const state = useToastStore.getState()
  const exists = [...state.toasts, ...state.queuedToasts].some((toast) => toast.id === toastId)
  if (exists) state.updateToast(toastId, update)
  else state.addToast({ key: fallback.key }, fallback.type)
}

function setRunningToast(toastId: string, undoInSecondary: boolean): void {
  useToastStore.getState().updateToast(toastId, {
    ...undoSlotPatch(i18n.t('undo.running'), undoInSecondary),
    duration: 'persistent' as const,
  })
}

function setFailedToast(toastId: string, undoInSecondary: boolean): void {
  clearUndo()
  finishToast(toastId, {
    message: { key: 'undo.retryableFailure' },
    type: 'error',
    ...(undoInSecondary ? { secondaryAction: undefined } : { action: undefined }),
    duration: 9_000,
    undoActionSlot: undefined,
    undoFallbackDuration: undefined,
    priority: undefined,
    hardExpiresAt: undefined,
  }, { key: 'undo.retryableFailure', type: 'error' })
}

function setConflictToast(toastId: string, undoInSecondary: boolean): void {
  finishToast(toastId, {
    message: { key: 'undo.conflict' },
    type: 'error',
    ...(undoInSecondary ? { secondaryAction: undefined } : { action: undefined }),
    duration: 9_000,
    undoActionSlot: undefined,
    undoFallbackDuration: undefined,
    priority: undefined,
    hardExpiresAt: undefined,
  }, { key: 'undo.conflict', type: 'error' })
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
  setRunningToast(currentToastId, undoInSecondary)
  if (execute) {
    try {
      await execute()
      if (currentGeneration !== generation || token !== currentToken) return
      token = null
      running = false
      execute = null
      finishToast(currentToastId, {
        message: { key: 'undo.succeeded' },
        type: 'success',
        action: undefined,
        secondaryAction: undefined,
        duration: 4_000,
        undoActionSlot: undefined,
        undoFallbackDuration: undefined,
        priority: undefined,
        hardExpiresAt: undefined,
      }, { key: 'undo.succeeded', type: 'success' })
      window.dispatchEvent(new CustomEvent('bd:undo-complete', { detail: { queryKeys } }))
    } catch (error) {
      if (currentGeneration !== generation || token !== currentToken) return
      running = false
      const category = (error as { category?: string } | null | undefined)?.category
      if (category === 'conflict' || category === 'unavailable-content' || category === 'invalid-input') {
        token = null
        execute = null
        setConflictToast(currentToastId, undoInSecondary)
      } else {
        setFailedToast(currentToastId, undoInSecondary)
      }
    }
    return
  }
  try {
    const response = await fetch(`/api/v1/undo/${encodeURIComponent(currentToken)}`, { method: 'POST' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: string } } | null
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429
      if (retryable) {
        if (currentGeneration !== generation || token !== currentToken) return
        running = false
        setFailedToast(currentToastId, undoInSecondary)
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
    finishToast(currentToastId, {
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
    }, { key: 'undo.succeeded', type: 'success' })
    window.dispatchEvent(new CustomEvent('bd:undo-complete', { detail: { queryKeys } }))
  } catch {
    if (currentGeneration !== generation || token !== currentToken) return
    running = false
    setFailedToast(currentToastId, undoInSecondary)
  }
}

function clearUndo(removeToast = false): void {
  if (removeToast && toastId) useToastStore.getState().removeToast(toastId)
  token = null
  toastId = null
  running = false
  expiresAt = 0
  boundToken = null
  execute = null
  queryKeys = []
}
