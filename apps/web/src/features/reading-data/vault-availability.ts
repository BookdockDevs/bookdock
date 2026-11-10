import { createContext, useContext } from 'react'

/**
 * Whether this session may read the device vault (signed in, or the instance
 * allows guests). It answers a different question than `useLocalCatalog()`:
 * that one says "this view is source-local", this one says "the device half of
 * a merged view exists at all". Unified screens (shelf, archive, stats) need
 * the second, because they mix sources instead of switching between them.
 */
export const VaultAvailabilityContext = createContext(false)

export const useVaultCapable = () => useContext(VaultAvailabilityContext)
