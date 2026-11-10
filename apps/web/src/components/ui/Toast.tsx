import { useEffect } from 'react'

import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

import { ToastStack } from './ToastStack'

export function Toast() {
  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) useToastStore.getState().clearToasts()
  }), [])
  return <ToastStack />
}
