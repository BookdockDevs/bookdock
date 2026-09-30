const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

export function displayWidth(value: string): number {
  let width = 0
  for (const ch of value) width += WIDE_CHAR.test(ch) ? 2 : 1
  return width
}

// Total single-line capacity of the whole meta grid, in display-width units.
// One 3-col cell holds ~18 units (~11 CJK / ~18 ASCII at text-sm),
// one 2-col cell holds ~27; the grid total stays the same.
const TOTAL_CAPACITY = 54

interface SpanRange {
  min: number
  ideal: number
}

function rangeFor(width: number, cols: number): SpanRange {
  const perCell = TOTAL_CAPACITY / cols
  const ideal = Math.min(cols, Math.max(1, Math.ceil(width / perCell)))
  // Any value can squeeze into one cell: collapsed content clamps to 2 lines
  // and ExpandableRowValue offers the expand chevron on residual overflow.
  return { min: 1, ideal }
}

function distribute(ranges: SpanRange[], widths: number[], target: number): number[] {
  const spans = ranges.map((r) => r.min)
  let deficit = target - spans.reduce((sum, s) => sum + s, 0)
  const order = ranges
    .map((r, i) => i)
    .sort((a, b) => ranges[b].ideal - ranges[a].ideal || widths[b] - widths[a])
  for (const i of order) {
    if (deficit <= 0) break
    const add = Math.min(deficit, ranges[i].ideal - spans[i])
    spans[i] += add
    deficit -= add
  }
  if (deficit > 0) {
    // Over-ideal stretch (a row of shorts with nothing long to absorb slack):
    // widen the last item so the whitespace lands at the row end, where a
    // short value simply leaves trailing space, instead of mid-row where it
    // reads as a missing column.
    spans[spans.length - 1] += deficit
  }
  return spans
}

// Greedy row packing in original order: every non-last row sums to exactly
// cols (long values squeeze to one cell with 2-line clamp, shorts stay put),
// the last row extends toward ideal spans and may stay underfilled. No item
// ever crosses a row boundary.
export function packMetaSpans(values: string[], cols: number): number[] {
  const n = values.length
  if (n === 0) return []
  const widths = values.map(displayWidth)
  const ranges = widths.map((w) => rangeFor(w, cols))
  const spans: number[] = new Array(n)
  let i = 0
  while (i < n) {
    const maxK = Math.min(cols, n - i)
    let count = 1
    for (let k = maxK; k >= 1; k--) {
      let sumMin = 0
      for (let j = i; j < i + k; j++) sumMin += ranges[j].min
      if (sumMin <= cols) {
        count = k
        break
      }
    }
    const isLast = i + count === n
    let sumIdeal = 0
    for (let j = i; j < i + count; j++) sumIdeal += ranges[j].ideal
    const target = isLast ? Math.min(sumIdeal, cols) : cols
    const assigned = distribute(
      ranges.slice(i, i + count),
      widths.slice(i, i + count),
      target,
    )
    for (let j = 0; j < count; j++) spans[i + j] = assigned[j]
    i += count
  }
  return spans
}

// A value needs two or more lines when its display width exceeds what its
// span holds on one line; those cells render slightly smaller type.
export function isWrappedValue(value: string, span: number, cols: number): boolean {
  return displayWidth(value) > span * (TOTAL_CAPACITY / cols)
}

const SMALL_VALUE = 'text-[13px]'
const SMALL_VALUE_SM = 'sm:text-[13px]'
const NORMAL_VALUE_SM = 'sm:text-sm'

// Parallel to resolveMetaSpanClasses; empty string means "keep text-sm".
export function resolveMetaValueSizeClasses(values: string[]): string[] {
  const mobile = packMetaSpans(values, 2)
  const desktop = packMetaSpans(values, 3)
  return values.map((value, i) => {
    const smallMobile = isWrappedValue(value, mobile[i], 2)
    const smallDesktop = isWrappedValue(value, desktop[i], 3)
    if (smallMobile && smallDesktop) return SMALL_VALUE
    if (smallMobile) return `${SMALL_VALUE} ${NORMAL_VALUE_SM}`
    if (smallDesktop) return `text-sm ${SMALL_VALUE_SM}`
    return ''
  })
}
const BASE_SPAN: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
}

const SM_SPAN: Record<number, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
}

// Responsive classes for the `grid-cols-2 sm:grid-cols-3` meta grid.
export function resolveMetaSpanClasses(values: string[]): string[] {
  const mobile = packMetaSpans(values, 2)
  const desktop = packMetaSpans(values, 3)
  return values.map((_, i) => `${BASE_SPAN[mobile[i]]} ${SM_SPAN[desktop[i]]}`)
}
