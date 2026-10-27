interface ProgressRestoreState {
  locationAvailable?: boolean
  progressRevisionId?: string | null
  cfi?: string | null
  positionAnchor?: { revisionId: string; cfi?: string } | null
  percent?: number
  fraction?: number | null
}

export function getProgressRestoreTarget(progress: ProgressRestoreState | null | undefined) {
  if (!progress) return { cfi: '', fraction: undefined }
  if (progress.locationAvailable === false) return { cfi: '', fraction: undefined }

  const anchoredCfi = progress.positionAnchor?.revisionId === progress.progressRevisionId
    ? progress.positionAnchor?.cfi
    : undefined
  return {
    cfi: anchoredCfi ?? progress.cfi ?? '',
    fraction: progress.percent && progress.percent > 0 ? progress.fraction ?? progress.percent / 100 : undefined,
  }
}
