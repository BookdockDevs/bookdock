import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'

import { useUiStore } from '@/stores/ui.store'
import { notify } from '@/lib/notifications'

import { AutoReadingController, type AutoReadingPreferences } from '../lib/auto-reading'
import type { ReaderPlaybackCoordinator } from '../lib/playback-coordinator'
import type { BookReader } from '../types'
import { AutoReadingSessionContext, IDLE_AUTO_READING_STATE } from './auto-reading-session-context'

interface AutoReadingSessionProviderProps {
  renderer: BookReader | null
  coordinator: ReaderPlaybackCoordinator
  children: ReactNode
}

export function AutoReadingSessionProvider({ renderer, coordinator, children }: AutoReadingSessionProviderProps) {
  const readingMode = useUiStore((state) => state.readingMode)
  const mode = useUiStore((state) => state.autoReadingMode)
  const speed = useUiStore((state) => state.autoReadingSpeed)
  const preferences = useMemo<AutoReadingPreferences>(() => ({ mode, speed, readingMode }), [mode, readingMode, speed])
  const controllerRef = useRef<{ renderer: BookReader; controller: AutoReadingController } | null>(null)
  if (!renderer) {
    controllerRef.current = null
  } else if (controllerRef.current?.renderer !== renderer) {
    controllerRef.current = {
      renderer,
      controller: new AutoReadingController(renderer, preferences, { claim: () => coordinator.claim('auto') }),
    }
  }
  const controller = controllerRef.current?.controller ?? null

  useEffect(() => {
    if (!controller) return
    controller.setPreferences(preferences)
  }, [controller, preferences])

  useEffect(() => {
    if (!controller) return
    return coordinator.register('auto', () => controller.stop())
  }, [controller, coordinator])

  useEffect(() => () => {
    controller?.dispose()
  }, [controller])

  const state = useSyncExternalStore(
    controller?.subscribe ?? (() => () => undefined),
    controller?.getSnapshot ?? (() => IDLE_AUTO_READING_STATE),
    () => IDLE_AUTO_READING_STATE,
  )
  useEffect(() => {
    if (state.error) notify.error({ key: state.error })
  }, [state.error])
  return <AutoReadingSessionContext.Provider value={{ controller, state }}>{children}</AutoReadingSessionContext.Provider>
}
