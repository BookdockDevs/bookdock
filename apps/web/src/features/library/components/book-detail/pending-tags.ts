/** Scraped tags arrive as names, not ids: a name only becomes a tag row when the
 *  edit dialog is saved. Until then it stays "pending" here, so backing out of
 *  the dialog never leaves an orphan tag behind. */

/** Adds names that are not pending yet, comparing case-insensitively so the same
 *  scraped tag twice (or once per source) does not queue two rows. */
export function mergePendingTagNames(current: readonly string[], incoming: readonly string[]): string[] {
  const merged = [...current]
  for (const candidate of incoming) {
    const name = candidate.trim()
    if (!name) continue
    if (!merged.some((existing) => existing.toLowerCase() === name.toLowerCase())) merged.push(name)
  }
  return merged
}

export interface PendingTagResolution {
  ids: string[]
  /** Names the server refused to create; the caller keeps them pending. */
  skipped: string[]
}

/** Turns pending names into ids at save time. A tag that showed up in the library
 *  meanwhile (another dialog, another device) is reused instead of created twice. */
export async function resolvePendingTagNames(
  names: readonly string[],
  known: readonly { id: string; name: string }[],
  create: (name: string) => Promise<string>,
): Promise<PendingTagResolution> {
  const ids: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    const existing = known.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      ids.push(existing.id)
      continue
    }
    try {
      ids.push(await create(name))
    } catch {
      skipped.push(name)
    }
  }
  return { ids, skipped }
}
