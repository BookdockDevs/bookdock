export interface ProgressRestoreState {
  locationAvailable?: boolean
  progressRevisionId?: string | null
  cfi?: string | null
  contentCfi?: string | null
  positionAnchor?: { revisionId: string; cfi?: string } | null
  percent?: number | null
  fraction?: number | null
}

export function getProgressRestoreTarget(progress: ProgressRestoreState | null | undefined) {
  if (!progress || progress.locationAvailable === false) return { cfi: '', contentCfi: '', fraction: undefined }

  const anchoredCfi = progress.positionAnchor?.revisionId === progress.progressRevisionId
    ? progress.positionAnchor?.cfi
    : undefined
  const cfi = anchoredCfi ?? progress.cfi ?? ''
  return {
    cfi,
    contentCfi: cfi.startsWith('epubcfi(') ? cfi
      : progress.cfi?.startsWith('epubcfi(') ? progress.cfi
        : progress.contentCfi?.startsWith('epubcfi(') ? progress.contentCfi : '',
    fraction: progress.percent && progress.percent > 0 ? progress.fraction ?? progress.percent / 100 : undefined,
  }
}
