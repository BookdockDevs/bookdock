import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'

import { useTtsServiceVoices, useTtsServices } from '@/api/hooks/useTts'
import { notify } from '@/lib/notifications'
import { useUiStore } from '@/stores/ui.store'

import type { ReaderPlaybackCoordinator } from '../lib/playback-coordinator'
import type { BookReader } from '../types'
import { TtsController, type TtsPreferences } from '../lib/tts-controller'
import { IDLE_TTS_STATE, TtsSessionContext } from './tts-session-context'

export function TtsSessionProvider({ renderer, coordinator, guestReadOnly = false, children }: { renderer: BookReader | null; coordinator: ReaderPlaybackCoordinator; guestReadOnly?: boolean; children: ReactNode }) {
  const { data } = useTtsServices({ enabled: !guestReadOnly })
  const engine = useUiStore((state) => state.ttsEngine)
  const serviceId = useUiStore((state) => state.ttsServiceId)
  const voiceId = useUiStore((state) => state.ttsVoiceId)
  const rate = useUiStore((state) => state.ttsRate)
  const autoNext = useUiStore((state) => state.ttsAutoNext)
  const follow = useUiStore((state) => state.ttsFollow)
  const service = useMemo(() => engine === 'service' ? data?.data.find((item) => item.id === serviceId) : undefined, [data, engine, serviceId])
  const voicesQuery = useTtsServiceVoices(service?.id)
  const serviceVoices = useMemo(() => voicesQuery.data?.data.map((item) => ({ id: item.id, name: item.name, lang: item.lang, gender: item.gender, description: item.description })) ?? [], [voicesQuery.data])
  const preferences = useMemo<TtsPreferences>(() => ({ engine: service ? 'service' : engine === 'edge' ? 'edge' : 'system', service, voices: serviceVoices, voiceId, rate, autoNext, highlight: follow }), [autoNext, engine, follow, rate, service, serviceVoices, voiceId])
  const controllerRef = useRef<{ renderer: BookReader; controller: TtsController } | null>(null)
  if (!renderer) {
    controllerRef.current = null
  } else if (controllerRef.current?.renderer !== renderer) {
    controllerRef.current = { renderer, controller: new TtsController(renderer, preferences, undefined, () => coordinator.claim('tts')) }
  }
  const controller = controllerRef.current?.controller ?? null

  useEffect(() => {
    controller?.setPreferences(preferences)
  }, [controller, preferences])

  useEffect(() => {
    if (!controller) return
    return coordinator.register('tts', () => controller.stop())
  }, [controller, coordinator])

  useEffect(() => {
    if (!controller) return
    return coordinator.registerToggle('tts', {
      // 'starting' counts: the controller's own pause() stops a session that has
      // not produced audio yet, which is what the panel's pause button does, so
      // the key stays consistent with the button instead of inventing a third
      // outcome.
      available: () => {
        const status = controller.getSnapshot().status
        return status === 'playing' || status === 'starting' || status === 'paused'
      },
      apply: () => {
        // toggle() would also start() from 'idle', which the key must never do.
        const status = controller.getSnapshot().status
        if (status === 'playing' || status === 'starting') void controller.pause()
        else if (status === 'paused') void controller.resume()
      },
    })
  }, [controller, coordinator])

  useEffect(() => {
    if (!controller) return
    const timers = [0, 2_000].map((delay) => window.setTimeout(() => controller.refreshVoices(), delay))
    const synthesis = globalThis.speechSynthesis
    synthesis?.addEventListener?.('voiceschanged', controller.refreshVoices)
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      synthesis?.removeEventListener?.('voiceschanged', controller.refreshVoices)
      controller.dispose()
    }
  }, [controller])

  const state = useSyncExternalStore(controller?.subscribe ?? (() => () => undefined), controller?.getSnapshot ?? (() => IDLE_TTS_STATE), () => IDLE_TTS_STATE)
  useEffect(() => {
    // Mirror AutoReadingPanel: failures toast so dismissing the popover on
    // start never hides them. The panel renders the same generic message
    // in-panel; the controller's raw error strings are not i18n keys.
    if (state.error) notify.error({ key: 'reader.ttsPlaybackFailed' })
  }, [state.error])
  return <TtsSessionContext.Provider value={{ controller, state }}>{children}</TtsSessionContext.Provider>
}
