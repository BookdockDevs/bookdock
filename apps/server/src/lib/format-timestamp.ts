/**
 * Server-side timestamp rendering.
 *
 * Storage is unix milliseconds everywhere, which is unambiguous. Rendering is
 * the half that is easy to get wrong: a self-hosted container almost always
 * runs UTC while its owner does not, so server-local time is never the answer.
 * The Web app sidesteps the question because the browser formats every date it
 * shows; the Legado book source cannot, because it prints whatever string the
 * server sends.
 *
 * So the reader's own IANA zone is stored on the account (`users.timezone`) and
 * passed in here. `null` means UTC, which is the only defensible fallback: it is
 * what the reader would have seen before the zone was known, so the worst case
 * is the status quo rather than a new surprise.
 *
 * `Intl.DateTimeFormat` throws RangeError on an unknown zone. Zones are
 * validated on write, but a value can also be dropped by an older row or a
 * restored backup, so the formatter is treated as fallible here rather than
 * letting one bad string take down a whole response.
 */
export function formatTimestamp(timestamp: number, timezone: string | null | undefined): string {
  if (!Number.isFinite(timestamp)) return ''
  if (!timezone) return formatUtc(timestamp)
  try {
    return formatInZone(timestamp, timezone)
  } catch {
    return formatUtc(timestamp)
  }
}

function formatInZone(timestamp: number, timezone: string): string {
  // en-GB yields the ISO-like YYYY-MM-DD ordering, and the numeric parts come
  // back in that fixed order regardless of the runtime's locale data.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  // en-GB renders midnight as "24" in some ICU versions; 0 is the same instant.
  const hour = get('hour')
  return `${get('year')}-${get('month')}-${get('day')} ${hour === '24' ? '00' : hour}:${get('minute')}`
}

function formatUtc(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}
