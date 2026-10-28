const COLUMN_GAP = 16
const ROW_GAP = 26
const MIN_COVER_WIDTH = 96
const MAX_COLUMNS = 6
const MAX_PAGE_SIZE = 100
const TITLE_AND_MARGIN = 54

export function getShelfLayout(width: number, height: number) {
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + COLUMN_GAP) / (MIN_COVER_WIDTH + COLUMN_GAP))))
  const widthByColumns = Math.floor((width - (columns - 1) * COLUMN_GAP) / columns)
  const widthByHeight = Math.floor((height - TITLE_AND_MARGIN) / 1.5)
  const coverWidth = Math.max(1, Math.min(widthByColumns, widthByHeight))
  const rowHeight = coverWidth * 1.5 + TITLE_AND_MARGIN
  const rows = Math.max(1, Math.min(Math.floor(MAX_PAGE_SIZE / columns), Math.floor((height + ROW_GAP) / (rowHeight + ROW_GAP))))
  return { columns, coverWidth, pageSize: columns * rows }
}
