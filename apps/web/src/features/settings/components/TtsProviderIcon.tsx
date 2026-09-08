import type { TtsProvider } from '@bookdock/shared'

interface TtsProviderIconProps {
  provider: TtsProvider
  className?: string
}

interface TtsBrand {
  asset: string
  adaptive?: boolean
  label: string
}

const TTS_BRANDS: Record<TtsProvider, TtsBrand> = {
  openai: { asset: '/ai-icons/openai.svg', adaptive: true, label: 'OpenAI' },
  azure: { asset: '/ai-icons/azure.svg', label: 'Azure' },
  aliyun: { asset: '/ai-icons/alibabacloud.svg', label: '阿里云' },
  dashscope: { asset: '/ai-icons/qwen-color.svg', label: '通义千问' },
  minimax: { asset: '/ai-icons/minimax-color.svg', label: 'MiniMax' },
  mimo: { asset: '/ai-icons/mimo.svg', adaptive: true, label: 'MiMo' },
  volcengine: { asset: '/ai-icons/volcengine.svg', label: '火山引擎' },
  'openai-compatible': { asset: '/ai-icons/openai.svg', adaptive: true, label: 'OpenAI-compatible' },
}

export default function TtsProviderIcon({ provider, className = 'h-8 w-8' }: TtsProviderIconProps) {
  const brand = TTS_BRANDS[provider]

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800 ${className}`}
      title={brand.label}
    >
      <img src={brand.asset} alt="" aria-hidden="true" decoding="async" className={`h-[62%] w-[62%] object-contain ${brand.adaptive ? 'dark:invert' : ''}`} />
    </span>
  )
}
