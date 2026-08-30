import { useContext } from 'react'

import { TtsSessionContext } from './tts-session-context'

export function useTtsSession() {
  return useContext(TtsSessionContext)
}
