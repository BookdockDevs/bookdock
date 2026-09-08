import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import TtsProviderIcon from '../features/settings/components/TtsProviderIcon'

describe('TtsProviderIcon', () => {
  it.each([
    ['azure', '/ai-icons/azure.svg'],
    ['aliyun', '/ai-icons/alibabacloud.svg'],
    ['dashscope', '/ai-icons/qwen-color.svg'],
    ['volcengine', '/ai-icons/volcengine.svg'],
  ] as const)('uses the matching brand asset for %s', (provider, asset) => {
    const { container } = render(<TtsProviderIcon provider={provider} />)

    expect(container.querySelector(`img[src="${asset}"]`)).not.toBeNull()
  })
})
