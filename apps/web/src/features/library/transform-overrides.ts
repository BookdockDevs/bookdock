import type { TextTransformRes } from '@bookdock/shared'

/**
 * Computes the override payload for a toggle click:
 * - no override: flip the current effective value
 * - override exists and the flip lands back on the global default: null (restore inheritance)
 * - otherwise: the flipped value updates the override
 */
export function nextOverrideValue(
  rule: Pick<TextTransformRes, 'enabled' | 'effectiveEnabled' | 'hasOverride'>,
): boolean | null {
  const target = !(rule.effectiveEnabled ?? rule.enabled)
  if (rule.hasOverride && target === rule.enabled) return null
  return target
}
