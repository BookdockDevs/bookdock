import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import SettingsPending from '@/features/settings/components/SettingsPending'

import { rootRoute } from './__root'

export interface SettingsSearch {
  section?: 'general' | 'reading' | 'library' | 'integrations' | 'about' | 'admin'
  focus?: 'tts'
  userTab?: 'instance' | 'library'
  libraryId?: string
}

const VALID_SECTIONS = new Set(['general', 'reading', 'library', 'integrations', 'about', 'admin'])

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (input: Record<string, unknown>): SettingsSearch => ({
    section: typeof input.section === 'string' && VALID_SECTIONS.has(input.section)
      ? input.section as SettingsSearch['section']
      : undefined,
    focus: input.focus === 'tts' ? 'tts' : undefined,
    userTab: input.userTab === 'instance' || input.userTab === 'library' ? input.userTab : undefined,
    libraryId: typeof input.libraryId === 'string' ? input.libraryId : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/settings/Settings')),
  pendingComponent: SettingsPending,
})
