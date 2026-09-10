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
}

export interface AddToastOptions {
  title?: string
  action?: ToastAction
  duration?: number | 'persistent'
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: Toast['message'], type?: Toast['type'], options?: AddToastOptions) => string
  removeToast: (id: string) => void
  clearToasts: () => void
  pauseToast: (id: string) => void
  resumeToast: (id: string) => void
}

let nextId = 0
const MAX_VISIBLE_TOASTS = 3

function defaultDuration(type: Toast['type']): Toast['duration'] {
  if (type === 'error') return 8_000
  if (type === 'warning') return 6_000
  return 4_000
}

interface ToastTimer {
  timeout: ReturnType<typeof setTimeout> | null
  expiresAt: number
  remaining: number
}

export const useToastStore = create<ToastState>((set, get) => {
  const timers = new Map<string, ToastTimer>()

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
    timer.timeout = setTimeout(() => {
      timers.delete(id)
      get().removeToast(id)
    }, duration)
    timers.set(id, timer)
  }

  return {
    toasts: [],
    addToast: (message, type = 'info', options) => {
      const id = `toast-${Date.now()}-${++nextId}`
      const toast: Toast = {
        id,
        message,
        type,
        duration: options?.duration ?? defaultDuration(type),
        ...(options?.title ? { title: options.title } : {}),
        ...(options?.action ? { action: options.action } : {}),
      }
      const oldest = get().toasts[0]
      if (oldest) {
        if (get().toasts.length >= MAX_VISIBLE_TOASTS) get().removeToast(oldest.id)
      }
      set((state) => ({ toasts: [...state.toasts, toast] }))
      if (toast.duration !== 'persistent') schedule(id, toast.duration)
      return id
    },
    removeToast: (id) => {
      clearTimer(id)
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    },
    clearToasts: () => {
      for (const id of timers.keys()) clearTimer(id)
      set({ toasts: [] })
    },
    pauseToast: (id) => {
      const timer = timers.get(id)
      if (!timer || timer.timeout === null) return
      clearTimeout(timer.timeout)
      timer.timeout = null
      timer.remaining = Math.max(0, timer.expiresAt - Date.now())
    },
    resumeToast: (id) => {
      const timer = timers.get(id)
      if (!timer || timer.timeout !== null) return
      schedule(id, timer.remaining)
    },
  }
})
