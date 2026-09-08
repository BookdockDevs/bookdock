import { describe, expect, it } from 'vitest'

import { resolveAiBrand } from '../lib/aiBrandIcons'

describe('resolveAiBrand', () => {
  it('uses the LM Studio asset for its provider', () => {
    expect(resolveAiBrand({ provider: 'lmstudio' })).toMatchObject({
      asset: '/ai-icons/lmstudio.svg',
      adaptive: true,
    })
  })
})
