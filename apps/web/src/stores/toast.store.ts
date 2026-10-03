import { create } from 'zustand'

export interface ToastMessage {
  key: string
  params?: Record<string, string | number>
}

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  message: string | ToastMessage
  type: 'success' | 'error' | 'info' | 'warning'
  title?: string
  action?: ToastAction
  duration: number | 'persistent'
  dedupeKey?: string
}

export interface AddToastOptions {
  title?: string
  action?: ToastAction
  duration?: number | 'persistent'
  dedupeKey?: string
}

type ToastUpdate = Partial<Omit<Toast, 'id'>>
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
  const pauses = new Map<string, Set<PauseReason>>()

  const clearTimer = (id: string) => {
    const timer = timers.get(id)
    if (!timer) return
    if (timer.timeout !== null) clearTimeout(timer.timeout)
    timers.delete(id)
  }

  const schedule = (id: string, duration: number) => {
    const timer: ToastTimer = {
      timeout: null,
      expiresAt: Date.now() + duration,
      remaining: duration,
    }
    if (!pauses.get(id)?.size) {
      timer.timeout = setTimeout(() => get().removeToast(id), duration)
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
          duration: options?.duration ?? (options?.action ? 12_000 : defaultDuration(type)),
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
        ...(options?.title ? { title: options.title } : {}),
        ...(options?.action ? { action: options.action } : {}),
      }
      if (get().toasts.length >= MAX_VISIBLE_TOASTS) {
        set((state) => ({ queuedToasts: [...state.queuedToasts, toast] }))
      } else {
        set((state) => ({ toasts: [...state.toasts, toast] }))
        if (toast.duration !== 'persistent') schedule(id, toast.duration)
      }
      return id
    },
    updateToast: (id, update) => {
      const current = [...get().toasts, ...get().queuedToasts].find((toast) => toast.id === id)
      if (!current) return
      const toast = {
        ...current,
        ...update,
        duration: update.duration ?? (update.type ? defaultDuration(update.type) : current.duration),
      }
      if (toast.action && update.duration === undefined && toast.duration !== 'persistent') {
        toast.duration = Math.max(12_000, toast.duration)
      }
      clearTimer(id)
      set((state) => ({
        toasts: state.toasts.map((item) => item.id === id ? toast : item),
        queuedToasts: state.queuedToasts.map((item) => item.id === id ? toast : item),
      }))
      if (get().toasts.some((item) => item.id === id) && toast.duration !== 'persistent') schedule(id, toast.duration)
    },
    removeToast: (id) => {
      clearTimer(id)
      pauses.delete(id)
      const visible = get().toasts.filter((toast) => toast.id !== id)
      const queued = get().queuedToasts.filter((toast) => toast.id !== id)
      const promoted = queued.splice(0, MAX_VISIBLE_TOASTS - visible.length)
      set({ toasts: [...visible, ...promoted], queuedToasts: queued })
      for (const toast of promoted) {
        if (toast.duration !== 'persistent') schedule(toast.id, toast.duration)
      }
    },
    clearToasts: () => {
      for (const id of timers.keys()) clearTimer(id)
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
