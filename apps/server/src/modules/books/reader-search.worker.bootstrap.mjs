// Worker threads do not honour `--import tsx`, and Node only strips types on this module graph
// when the loader is registered inside the worker itself, so dev/test source runs boot through here.
import { register } from 'tsx/esm/api'

register()

await import('./reader-search.worker.ts')
