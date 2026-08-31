import type { AiModelRes, AiProviderRes } from '@bookdock/shared'

interface AiBrandIconProps {
  name?: string | null
  model?: Pick<AiModelRes, 'id' | 'name' | 'ownedBy'> | null
  provider?: Pick<AiProviderRes, 'id' | 'name'> | string | null
  className?: string
  selected?: boolean
}

interface BrandDefinition {
  file: string
  pattern: RegExp
  monochrome?: boolean
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

const DARK_ADAPTIVE_BRANDS = new Set(['openai.svg', 'anthropic.svg', 'openrouter.svg', 'mimo.svg', 'ollama.svg'])

function textValues(name: string | null | undefined, model: AiBrandIconProps['model'], provider: AiBrandIconProps['provider']) {
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

export default function AiBrandIcon({ name, model, provider, className = 'h-8 w-8', selected = false }: AiBrandIconProps) {
  const values = textValues(name, model, provider)
  const brand = brandFor(values)
  const asset = brand ? `/ai-icons/${brand.file}` : null
  const label = values[0] ?? 'AI'
  const adaptive = brand ? DARK_ADAPTIVE_BRANDS.has(brand.file) : false

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800 ${selected ? 'ring-2 ring-stone-700 ring-offset-1 ring-offset-white dark:ring-stone-300 dark:ring-offset-stone-900' : ''} ${className}`}
      title={label}
    >
      {asset ? <img src={asset} alt="" aria-hidden="true" className={`h-[62%] w-[62%] object-contain ${adaptive ? 'dark:invert' : ''}`} /> : <span className="text-[0.58em] font-semibold text-stone-500 dark:text-stone-300">{fallbackLabel(values)}</span>}
    </span>
  )
}
