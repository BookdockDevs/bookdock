import JSZip from 'jszip'

const ICON_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

function manifestCandidates(entries: string[]): string[] {
  const files = entries.filter((name) => !name.endsWith('/') && !name.includes('__MACOSX'))
  const root = files.find((name) => name === 'manifest.json')
  if (root) return [root]
  // A GitHub zipball wraps everything in one directory; mirror the server
  // installer by accepting a manifest inside a single common top-level dir.
  const nested = files.filter((name) => {
    const slash = name.indexOf('/')
    return slash > 0 && name.indexOf('/', slash + 1) === -1 && name.slice(slash + 1) === 'manifest.json'
  })
  const uniqueRoots = new Set(nested.map((name) => name.slice(0, name.indexOf('/'))))
  if (uniqueRoots.size === 1) return nested
  return []
}

function iconMimeType(path: string): string | undefined {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return ICON_MIME_TYPES[extension]
}

export interface ZipPackagePreview {
  /** Object URL of the packaged icon, or null when the package has none. */
  iconUrl: string | null
  /** Display name from the manifest, or null when absent. */
  name: string | null
}

/**
 * Extracts the packaged icon and display name of a personal metadata source
 * ZIP for preview. Fields degrade independently; a package without a manifest
 * yields both null. Preview only: the server re-validates the package on install.
 */
export async function extractZipPreview(file: File): Promise<ZipPackagePreview> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    return { iconUrl: null, name: null }
  }
  const names = Object.keys(zip.files)
  for (const manifestPath of manifestCandidates(names)) {
    let manifest: { icon?: unknown; name?: unknown }
    try {
      const text = await zip.files[manifestPath]!.async('string')
      manifest = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
      continue
    }
    const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : null

    if (typeof manifest.icon !== 'string' || !manifest.icon) {
      if (name) return { iconUrl: null, name }
      continue
    }
    // Same escape rule as the server: icon paths stay inside the package root.
    const normalized = manifest.icon.replace(/\\/g, '/')
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      if (name) return { iconUrl: null, name }
      continue
    }
    const rootPrefix = manifestPath === 'manifest.json' ? '' : manifestPath.slice(0, manifestPath.indexOf('/') + 1)
    const iconFile = zip.file(rootPrefix + normalized)
    const mimeType = iconFile ? iconMimeType(normalized) : undefined
    if (!iconFile || !mimeType) {
      if (name) return { iconUrl: null, name }
      continue
    }
    try {
      const data = await iconFile.async('blob')
      const iconUrl = URL.createObjectURL(new Blob([data], { type: mimeType }))
      return { iconUrl, name }
    } catch {
      if (name) return { iconUrl: null, name }
      continue
    }
  }
  return { iconUrl: null, name: null }
}
