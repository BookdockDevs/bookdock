export type StatsModuleKey =
  | 'summary'
  | 'trend'
  | 'heatmap'
  | 'hours'
  | 'categories'
  | 'tags'
  | 'books'

export const STATS_MODULE_DEFAULTS: StatsModuleKey[] = [
  'summary',
  'trend',
  'heatmap',
  'hours',
  'categories',
  'tags',
  'books',
]

export const STATS_MODULE_LABELS: Record<StatsModuleKey, string> = {
  summary: '数据总览',
  trend: '阅读趋势',
  heatmap: '全年热力图',
  hours: '时间分布图',
  categories: '书籍分类',
  tags: '书籍标签',
  books: '阅读的书籍',
}

const STORAGE_ORDER_KEY = 'bd-stats-modules-order'
const STORAGE_HIDDEN_KEY = 'bd-stats-hidden-modules'

export function getInitialStatsModuleOrder(): StatsModuleKey[] {
  if (typeof window === 'undefined') return [...STATS_MODULE_DEFAULTS]
  try {
    const raw = localStorage.getItem(STORAGE_ORDER_KEY)
    if (!raw) return [...STATS_MODULE_DEFAULTS]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...STATS_MODULE_DEFAULTS]
    const valid = parsed.filter((k): k is StatsModuleKey => STATS_MODULE_DEFAULTS.includes(k as StatsModuleKey))
    const missing = STATS_MODULE_DEFAULTS.filter((k) => !valid.includes(k))
    return [...valid, ...missing]
  } catch {
    return [...STATS_MODULE_DEFAULTS]
  }
}

export function getInitialStatsHiddenModules(): StatsModuleKey[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_HIDDEN_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is StatsModuleKey => STATS_MODULE_DEFAULTS.includes(k as StatsModuleKey))
  } catch {
    return []
  }
}

export function persistStatsModuleOrder(order: StatsModuleKey[]): void {
  try {
    localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(order))
  } catch {
    // ignore in private browsing
  }
}

export function persistStatsHiddenModules(hidden: StatsModuleKey[]): void {
  try {
    localStorage.setItem(STORAGE_HIDDEN_KEY, JSON.stringify(hidden))
  } catch {
    // ignore in private browsing
  }
}
