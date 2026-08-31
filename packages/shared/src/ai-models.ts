import type { AiModelRes } from './contract'

export type AiModelCapability = 'vision' | 'tools' | 'reasoning' | 'embedding'

export interface AiModelCapabilityFlags {
  vision: boolean
  tools: boolean
  reasoning: boolean
  embedding: boolean
}

const MODEL_CAPABILITY_HINTS: Array<{ pattern: RegExp; capabilities: Partial<AiModelCapabilityFlags> }> = [
  {
    pattern: /gpt-4o|gpt-4\.1|gpt-5(?!-chat)|(?:^|[^a-z])o\d|gemini|claude|kimi-k2[-.]?(?:5|6|7)|kimi-k3(?:$|[/_:@.-])|muse-spark-1\.1(?:$|[/_:@.-])|doubao.+(?:1[-.]?(?:6|8)|seed-2|seed-evolving)|grok-4|step-3|intern-s1|minimax-m3(?:$|[/_:@])|mimo-v2(?:-omni(?:$|[/_:@])|\.5(?:$|[/_:@]))|sensenova-6\.7-flash-lite|deepseek.+vision|image/i,
    capabilities: { vision: true },
  },
  {
    pattern: /gpt-4o|gpt-4\.1|gpt-oss|gpt-5(?!-chat)|(?:^|[^a-z])o\d|gemini|claude|qwen-?3|doubao.+(?:1[-.]?(?:6|8)|seed-2|seed-evolving)|grok-4|kimi-k2|kimi-k3(?:$|[/_:@.-])|muse-spark-1\.1(?:$|[/_:@.-])|step-3|intern-s1|glm-4[-.]?(?:5|6|7)|glm-5|minimax-(?:m2|m3)|deepseek-(?:r1|v3|chat|v3\.1|v3\.2|v4)|deepseek-reasoner|mimo-v2|sensenova-6\.7-flash-lite|laguna/i,
    capabilities: { tools: true },
  },
  {
    pattern: /gpt-oss|gpt-5(?!-chat)|(?:^|[^a-z])o\d|gemini-(?:2\.5|3).*|gemini-(?:flash-latest|pro-latest)|gemini-3-pro-image-preview|gemma[-_]?4|claude|qwen-?3|doubao.+(?:1[-.]?(?:6|8)|seed-2|seed-evolving)|grok-4|kimi-k2|kimi-k3(?:$|[/_:@.-])|muse-spark-1\.1(?:$|[/_:@.-])|step-3|intern-s1|glm-4[-.]?(?:5|6|7)|glm-5|minimax-(?:m2|m3)|deepseek-(?:r1|v3\.1|v3\.2|v4)|deepseek-reasoner|mimo-v2|laguna/i,
    capabilities: { reasoning: true },
  },
]

const EMBEDDING_MODEL_PATTERN = /embedding|(?:^|[-_/])embed(?:dings?)?(?:[-_.:@/]|$)/i

function isQwenVisionModel(id: string) {
  if (/qwen-?3[.-]5/.test(id)) return true
  if (/qwen-?3[.-]7-(?:plus|flash)/.test(id)) return true
  if (/qwen-?3[.-]8-max/.test(id)) return true
  const snapshot = id.match(/qwen-?3[.-]7-max-(\d{4})-(\d{2})-(\d{2})/)
  if (!snapshot) return false
  const date = Date.UTC(Number(snapshot[1]), Number(snapshot[2]) - 1, Number(snapshot[3]))
  return Number.isFinite(date) && date >= Date.UTC(2026, 5, 8)
}

export function getAiModelCapabilityFlags(model: Pick<AiModelRes, 'id' | 'name' | 'capabilities'>): AiModelCapabilityFlags {
  const text = `${model.id} ${model.name}`.toLowerCase()
  const id = model.id.trim().toLowerCase()
  const registry: AiModelCapabilityFlags = {
    vision: isQwenVisionModel(id),
    tools: false,
    reasoning: false,
    embedding: EMBEDDING_MODEL_PATTERN.test(id),
  }
  for (const entry of MODEL_CAPABILITY_HINTS) {
    if (entry.pattern.test(id)) Object.assign(registry, entry.capabilities)
  }
  const inferred = {
    vision: /(^|[^a-z])(vision|visual|multimodal|image|vl)([^a-z]|$)/i.test(text),
    tools: /(^|[^a-z])(tools?|tool[_ -]?calling|function[_ -]?calling)([^a-z]|$)/i.test(text),
    reasoning: /(^|[^a-z])(reason|reasoning|think|thinking|qwq|deepseek-r1|o[1-4])([^a-z]|$)/i.test(text),
    embedding: EMBEDDING_MODEL_PATTERN.test(text),
  }
  const embedding = model.capabilities?.embedding ?? registry.embedding ?? inferred.embedding
  if (embedding) {
    return {
      vision: model.capabilities?.vision ?? false,
      tools: model.capabilities?.tools ?? false,
      reasoning: model.capabilities?.reasoning ?? false,
      embedding: true,
    }
  }
  return {
    vision: model.capabilities?.vision ?? (registry.vision || inferred.vision),
    tools: model.capabilities?.tools ?? (registry.tools || inferred.tools),
    reasoning: model.capabilities?.reasoning ?? (registry.reasoning || inferred.reasoning),
    embedding: false,
  }
}

export function isAiEmbeddingModel(model: Pick<AiModelRes, 'id' | 'name' | 'capabilities'>) {
  return getAiModelCapabilityFlags(model).embedding
}
