import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'

import { useTtsServiceVoices, useTtsServices } from '@/api/hooks/useTts'
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
  return <TtsSessionContext.Provider value={{ controller, state }}>{children}</TtsSessionContext.Provider>
}
