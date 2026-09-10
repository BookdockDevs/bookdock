import {
  useToastStore,
  type AddToastOptions,
  type Toast,
  type ToastMessage,
} from '@/stores/toast.store'

type NotificationInput = string | ToastMessage

function show(message: NotificationInput, type: Toast['type'], options?: AddToastOptions): string {
  return useToastStore.getState().addToast(message, type, options)
}

export const notify = {
  show,
  success: (message: NotificationInput, options?: AddToastOptions) => show(message, 'success', options),
  error: (message: NotificationInput, options?: AddToastOptions) => show(message, 'error', options),
  info: (message: NotificationInput, options?: AddToastOptions) => show(message, 'info', options),
  warning: (message: NotificationInput, options?: AddToastOptions) => show(message, 'warning', options),
}
