import { useContext } from 'react'

import { AutoReadingSessionContext } from './auto-reading-session-context'

export function useAutoReadingSession() {
  return useContext(AutoReadingSessionContext)
}
