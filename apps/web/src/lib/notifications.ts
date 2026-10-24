import type { UndoReceipt } from '@bookdock/shared'

import {
  useToastStore,
  type AddToastOptions,
  type Toast,
  type ToastMessage,
} from '@/stores/toast.store'
import { attachUndoToNotification, bindUndoToast } from '@/lib/undo'

type NotificationInput = string | ToastMessage
type NotificationOptions = AddToastOptions & { undo?: UndoReceipt }

function show(message: NotificationInput, type: Toast['type'], options?: NotificationOptions): string {
  const { undo, ...toastOptions } = options ?? {}
  const actionOptions = type === 'success' || type === 'warning'
    ? attachUndoToNotification(toastOptions, undo)
    : toastOptions
  const identity = typeof message === 'string'
    ? message
    : [message.key, Object.entries(message.params ?? {}).sort(([a], [b]) => a.localeCompare(b))]
  const dedupeKey = actionOptions?.dedupeKey ?? (!actionOptions?.action && !actionOptions?.secondaryAction && actionOptions?.duration !== 'persistent'
    ? `notification:${JSON.stringify([type, identity, actionOptions?.title ?? null])}`
    : undefined)
  const id = useToastStore.getState().addToast(message, type, { ...actionOptions, dedupeKey })
  if (actionOptions?.undoActionSlot) bindUndoToast(id, undo)
  return id
}

export const notify = {
  show,
  success: (message: NotificationInput, options?: NotificationOptions) => show(message, 'success', options),
  error: (message: NotificationInput, options?: AddToastOptions) => show(message, 'error', options),
  info: (message: NotificationInput, options?: AddToastOptions) => show(message, 'info', options),
  warning: (message: NotificationInput, options?: NotificationOptions) => show(message, 'warning', options),
}
