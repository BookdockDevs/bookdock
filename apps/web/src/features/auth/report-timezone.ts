import { apiPut } from '@/api/client'

/**
 * Report the browser's IANA zone to the server.
 *
 * The Web app never needs this — it formats every date locally, which is why the
 * project had no notion of a stored timezone. The Legado book source does: it
 * prints whatever string the server sends, so a server-rendered date is only
 * meaningful if the server knows whose clock to render it on. The browser is
 * standing right here and already knows the answer, so it is asked once rather
 * than turned into a setting the user has to configure.
 *
 * Guarded per tab: an unchanged zone is not re-sent, so a refetch or a remount
 * costs nothing, while a user who changes timezone still re-reports. A failed
 * request leaves the marker unset, so the next mount tries again.
 */
export async function reportBrowserTimezone(userId: string): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!zone) return
  const marker = `bd-timezone:${userId}`
  if (sessionStorage.getItem(marker) === zone) return
  await apiPut('/auth/timezone', { timezone: zone })
  sessionStorage.setItem(marker, zone)
}
