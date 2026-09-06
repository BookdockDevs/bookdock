import type { AiModelRes, AiProviderRes } from '@bookdock/shared'

interface BrandDefinition {
  file: string
  pattern: RegExp
  monochrome?: boolean
}

export interface AiBrandSource {
  name?: string | null
  model?: Pick<AiModelRes, 'id' | 'name' | 'ownedBy'> | null
  provider?: Pick<AiProviderRes, 'id' | 'name'> | string | null
}

const BRANDS: BrandDefinition[] = [
  { file: 'openai.svg', pattern: /openai|gpt(?:-|\s|$)|\bo[1-9](?:-|\s|$)/i, monochrome: true },
  { file: 'gemini-color.svg', pattern: /gemini/i },
  { file: 'claude-color.svg', pattern: /claude/i },
  { file: 'anthropic.svg', pattern: /anthropic/i, monochrome: true },
  { file: 'deepseek-color.svg', pattern: /deepseek/i },
  { file: 'qwen-color.svg', pattern: /qwen|qwq|qvq/i },
  { file: 'doubao-color.svg', pattern: /doubao|豆包/i },
  { file: 'zhipu-color.svg', pattern: /zhipu|智谱|glm/i },
  { file: 'kimi-color.svg', pattern: /kimi|moonshot|月之暗面/i },
  { file: 'openrouter.svg', pattern: /openrouter/i, monochrome: true },
  { file: 'siliconflow-color.svg', pattern: /siliconflow|silicon cloud|硅基/i },
  { file: 'minimax-color.svg', pattern: /minimax|mini max/i },
  { file: 'mimo.svg', pattern: /mimo|xiaomi|小米/i, monochrome: true },
  { file: 'ollama.svg', pattern: /ollama/i, monochrome: true },
  { file: 'mistral-color.svg', pattern: /mistral/i },
]

function textValues({ name, model, provider }: AiBrandSource) {
  const modelValues = model ? [model.name, model.id, model.ownedBy] : []
  const providerValues = typeof provider === 'string' ? [provider] : provider ? [provider.name, provider.id] : []
  return [name, ...modelValues, ...providerValues].filter((value): value is string => Boolean(value?.trim()))
}

function brandFor(values: string[]) {
  for (const value of values) {
    const brand = BRANDS.find((item) => item.pattern.test(value))
    if (brand) return brand
  }
  return null
}

function fallbackLabel(values: string[]) {
  const value = values[0]?.trim() ?? 'AI'
  const words = value.split(/[\s/_-]+/).filter(Boolean)
  if (words.length > 1) return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
  return Array.from(value).slice(0, 2).join('').toUpperCase()
}

export function resolveAiBrand(source: AiBrandSource) {
  const values = textValues(source)
  const brand = brandFor(values)
  return {
    asset: brand ? `/ai-icons/${brand.file}` : null,
    label: values[0] ?? 'AI',
    fallback: fallbackLabel(values),
    adaptive: Boolean(brand?.monochrome),
  }
}

export function preloadAiBrandIcons(models: readonly Pick<AiModelRes, 'id' | 'name' | 'ownedBy'>[]) {
  if (typeof window === 'undefined') return
  const assets = new Set(models.map((model) => resolveAiBrand({ name: model.name, model }).asset).filter((asset): asset is string => Boolean(asset)))
  for (const asset of assets) {
    const image = new window.Image()
    image.decoding = 'async'
    image.src = asset
  }
}
