import { createContext } from 'react'

import type { TtsController, TtsSessionState } from '../lib/tts-controller'

export interface TtsSessionContextValue {
  controller: TtsController | null
  state: TtsSessionState
}

export const IDLE_TTS_STATE: TtsSessionState = {
  status: 'idle',
  engine: 'system',
  service: null,
  segment: null,
  highlighting: true,
  voices: [],
  error: null,
}

export const TtsSessionContext = createContext<TtsSessionContextValue>({ controller: null, state: IDLE_TTS_STATE })
