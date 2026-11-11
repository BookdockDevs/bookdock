// Worker threads do not honour `--import tsx`, so register the loader inside the worker itself.
import { register } from 'tsx/esm/api'

register()

await import('./mdict.worker.ts')
