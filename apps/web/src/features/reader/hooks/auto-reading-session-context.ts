import { createContext } from 'react'

import type { AutoReadingController, AutoReadingSessionState } from '../lib/auto-reading'

export interface AutoReadingSessionContextValue {
  controller: AutoReadingController | null
  state: AutoReadingSessionState
}

export const IDLE_AUTO_READING_STATE: AutoReadingSessionState = {
  status: 'idle',
  mode: 'smooth',
  speed: 30,
  error: null,
  stepStartedAt: null,
  stepDuration: null,
  stepRemaining: null,
}

export const AutoReadingSessionContext = createContext<AutoReadingSessionContextValue>({
  controller: null,
  state: IDLE_AUTO_READING_STATE,
})
