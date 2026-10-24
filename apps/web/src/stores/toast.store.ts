import { create } from 'zustand'

export interface ToastMessage {
  key: string
  params?: Record<string, string | number>
}

export interface ToastAction {
  label: string
  onClick: () => void
  onExpire?: () => void
  icon?: 'undo' | 'retry' | 'loading'
  keepOpen?: boolean
  disabled?: boolean
}

export interface Toast {
  id: string
  message: string | ToastMessage
  type: 'success' | 'error' | 'info' | 'warning'
  title?: string
  action?: ToastAction
  secondaryAction?: ToastAction
  duration: number | 'persistent'
  dedupeKey?: string
  priority?: 'high'
  hardExpiresAt?: number
  undoActionSlot?: 'action' | 'secondaryAction'
  undoFallbackDuration?: number | 'persistent'
}

export interface AddToastOptions {
  title?: string
  action?: ToastAction
  secondaryAction?: ToastAction
  duration?: number | 'persistent'
  dedupeKey?: string
  priority?: 'high'
  hardExpiresAt?: number
  undoActionSlot?: 'action' | 'secondaryAction'
  undoFallbackDuration?: number | 'persistent'
}

type ToastUpdate = Partial<Omit<Toast, 'id'>> & { restartHardLifetime?: boolean }
type PauseReason = 'pointer' | 'focus'

interface ToastState {
  toasts: Toast[]
  queuedToasts: Toast[]
  addToast: (message: Toast['message'], type?: Toast['type'], options?: AddToastOptions) => string
  updateToast: (id: string, update: ToastUpdate) => void
  removeToast: (id: string) => void
  clearToasts: () => void
  pauseToast: (id: string, reason?: PauseReason) => void
  resumeToast: (id: string, reason?: PauseReason) => void
}

let nextId = 0
const MAX_VISIBLE_TOASTS = 3
const MAX_ACTION_TOAST_LIFETIME_MS = 90_000

function defaultDuration(type: Toast['type']): Toast['duration'] {
  if (type === 'error') return 9_000
  if (type === 'warning') return 7_000
  return type === 'info' ? 5_000 : 4_000
}

interface ToastTimer {
  timeout: ReturnType<typeof setTimeout> | null
  expiresAt: number
  remaining: number
}

export const useToastStore = create<ToastState>((set, get) => {
  const timers = new Map<string, ToastTimer>()
  const hardTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  const hardDeadlines = new Map<string, number>()
  const pauses = new Map<string, Set<PauseReason>>()

  const clearTimer = (id: string) => {
    const timer = timers.get(id)
    if (!timer) return
    if (timer.timeout !== null) clearTimeout(timer.timeout)
    timers.delete(id)
  }

  const expireUndoAction = (id: string) => {
    const toast = [...get().toasts, ...get().queuedToasts].find((item) => item.id === id)
    if (!toast?.undoActionSlot) return
    const action = toast.undoActionSlot === 'action' ? undefined : toast.action
    const secondaryAction = toast.undoActionSlot === 'secondaryAction' ? undefined : toast.secondaryAction
    const fallbackDuration = toast.undoFallbackDuration
    if (fallbackDuration === undefined) {
      toast[toast.undoActionSlot]?.onExpire?.()
      get().removeToast(id)
      return
    }
    toast[toast.undoActionSlot]?.onExpire?.()
    get().updateToast(id, {
      action,
      secondaryAction,
      duration: fallbackDuration,
      undoActionSlot: undefined,
      undoFallbackDuration: undefined,
      priority: undefined,
      hardExpiresAt: undefined,
    })
  }

  const scheduleHardExpiration = (toast: Toast, reset = false) => {
    const existing = hardTimeouts.get(toast.id)
    if (existing) clearTimeout(existing)
    if (toast.priority === 'high' && (toast.action || toast.secondaryAction) && toast.action?.icon !== 'loading') {
      const deadline = toast.hardExpiresAt ?? (reset || !hardDeadlines.has(toast.id)
        ? Date.now() + MAX_ACTION_TOAST_LIFETIME_MS
        : hardDeadlines.get(toast.id)!)
      hardDeadlines.set(toast.id, deadline)
      hardTimeouts.set(toast.id, setTimeout(() => {
        if (toast.undoActionSlot) expireUndoAction(toast.id)
        else get().removeToast(toast.id)
      }, Math.max(0, deadline - Date.now())))
    } else {
      hardTimeouts.delete(toast.id)
      hardDeadlines.delete(toast.id)
    }
  }

  const schedule = (id: string, duration: number) => {
    const timer: ToastTimer = {
      timeout: null,
      expiresAt: Date.now() + duration,
      remaining: duration,
    }
    if (!pauses.get(id)?.size) {
      timer.timeout = setTimeout(() => {
        const toast = [...get().toasts, ...get().queuedToasts].find((item) => item.id === id)
        if (toast?.undoActionSlot) expireUndoAction(id)
        else get().removeToast(id)
      }, duration)
    }
    timers.set(id, timer)
  }

  return {
    toasts: [],
    queuedToasts: [],
    addToast: (message, type = 'info', options) => {
      const existing = options?.dedupeKey
        ? [...get().toasts, ...get().queuedToasts].find((toast) => toast.dedupeKey === options.dedupeKey)
        : undefined
      if (existing) {
        get().updateToast(existing.id, {
          message,
          type,
          title: options?.title,
          action: options?.action,
          secondaryAction: options?.secondaryAction,
          duration: options?.duration ?? (options?.action ? 12_000 : defaultDuration(type)),
          hardExpiresAt: options?.hardExpiresAt,
          undoActionSlot: options?.undoActionSlot,
          undoFallbackDuration: options?.undoFallbackDuration,
          restartHardLifetime: options?.priority === 'high' && Boolean(options.action),
        })
        return existing.id
      }
      const id = `toast-${Date.now()}-${++nextId}`
      const toast: Toast = {
        id,
        message,
        type,
        duration: options?.duration ?? (options?.action ? 12_000 : defaultDuration(type)),
        ...(options?.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
        ...(options?.priority ? { priority: options.priority } : {}),
        ...(options?.title ? { title: options.title } : {}),
        ...(options?.action ? { action: options.action } : {}),
        ...(options?.secondaryAction ? { secondaryAction: options.secondaryAction } : {}),
        ...(options?.hardExpiresAt ? { hardExpiresAt: options.hardExpiresAt } : {}),
        ...(options?.undoActionSlot ? { undoActionSlot: options.undoActionSlot } : {}),
        ...(options?.undoFallbackDuration !== undefined ? { undoFallbackDuration: options.undoFallbackDuration } : {}),
      }
      if (get().toasts.length >= MAX_VISIBLE_TOASTS && options?.priority === 'high') {
        const replaceIndex = get().toasts.findIndex((item) => item.priority !== 'high')
        if (replaceIndex >= 0) {
          const displaced = get().toasts[replaceIndex]!
          clearTimer(displaced.id)
          set((state) => ({
            toasts: state.toasts.map((item, index) => index === replaceIndex ? toast : item),
            queuedToasts: [displaced, ...state.queuedToasts],
          }))
          if (toast.duration !== 'persistent') schedule(id, toast.duration)
          scheduleHardExpiration(toast, true)
        } else {
          set((state) => ({ queuedToasts: [...state.queuedToasts, toast] }))
          scheduleHardExpiration(toast, true)
        }
      } else if (get().toasts.length >= MAX_VISIBLE_TOASTS) {
        set((state) => ({ queuedToasts: [...state.queuedToasts, toast] }))
      } else {
        set((state) => ({ toasts: [...state.toasts, toast] }))
        if (toast.duration !== 'persistent') schedule(id, toast.duration)
        scheduleHardExpiration(toast, true)
      }
      return id
    },
    updateToast: (id, update) => {
      const current = [...get().toasts, ...get().queuedToasts].find((toast) => toast.id === id)
      if (!current) return
      const { restartHardLifetime = false, ...toastUpdate } = update
      const toast = {
        ...current,
        ...toastUpdate,
        duration: update.duration ?? (update.type ? defaultDuration(update.type) : current.duration),
      }
      if ((toast.action || toast.secondaryAction) && update.duration === undefined && toast.duration !== 'persistent') toast.duration = Math.max(12_000, toast.duration)
      clearTimer(id)
      set((state) => ({
        toasts: state.toasts.map((item) => item.id === id ? toast : item),
        queuedToasts: state.queuedToasts.map((item) => item.id === id ? toast : item),
      }))
      if (get().toasts.some((item) => item.id === id) && toast.duration !== 'persistent') schedule(id, toast.duration)
      scheduleHardExpiration(toast, restartHardLifetime)
    },
    removeToast: (id) => {
      clearTimer(id)
      const hardTimeout = hardTimeouts.get(id)
      if (hardTimeout) clearTimeout(hardTimeout)
      hardTimeouts.delete(id)
      hardDeadlines.delete(id)
      pauses.delete(id)
      const visible = get().toasts.filter((toast) => toast.id !== id)
      const queued = get().queuedToasts.filter((toast) => toast.id !== id)
      const promoted = queued.splice(0, MAX_VISIBLE_TOASTS - visible.length)
      set({ toasts: [...visible, ...promoted], queuedToasts: queued })
      for (const toast of promoted) {
        if (toast.duration !== 'persistent') schedule(toast.id, toast.duration)
        scheduleHardExpiration(toast)
      }
    },
    clearToasts: () => {
      for (const id of timers.keys()) clearTimer(id)
      for (const timeout of hardTimeouts.values()) clearTimeout(timeout)
      hardTimeouts.clear()
      hardDeadlines.clear()
      pauses.clear()
      set({ toasts: [], queuedToasts: [] })
    },
    pauseToast: (id, reason = 'pointer') => {
      if (!get().toasts.some((toast) => toast.id === id)) return
      const reasons = pauses.get(id) ?? new Set<PauseReason>()
      reasons.add(reason)
      pauses.set(id, reasons)
      const timer = timers.get(id)
      if (!timer || timer.timeout === null) return
      clearTimeout(timer.timeout)
      timer.timeout = null
      timer.remaining = Math.max(0, timer.expiresAt - Date.now())
    },
    resumeToast: (id, reason = 'pointer') => {
      const reasons = pauses.get(id)
      reasons?.delete(reason)
      if (reasons?.size) return
      pauses.delete(id)
      const timer = timers.get(id)
      if (!timer || timer.timeout !== null) return
      schedule(id, timer.remaining)
    },
  }
})
