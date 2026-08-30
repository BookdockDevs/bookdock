import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Settings from '@/features/settings/Settings'

export interface SettingsSearch {
  section?: 'general' | 'account' | 'reading' | 'library' | 'admin'
  focus?: 'tts'
}

const VALID_SECTIONS = new Set(['general', 'account', 'reading', 'library', 'admin'])

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (input: Record<string, unknown>): SettingsSearch => ({
    section: typeof input.section === 'string' && VALID_SECTIONS.has(input.section)
      ? input.section as SettingsSearch['section']
      : undefined,
    focus: input.focus === 'tts' ? 'tts' : undefined,
  }),
  component: Settings,
})
