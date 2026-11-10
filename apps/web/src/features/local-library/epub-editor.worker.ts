import { processLocalEpub } from './epub-editor'
import { relocatePublication } from './publication-relocation'
import type { PublicationWorkerInput } from './epub-editor-worker'

self.onmessage = async (event: MessageEvent<PublicationWorkerInput>) => {
  try {
    const input = event.data
    const signal = new AbortController().signal
    if ('operation' in input) {
      const [source, target] = await Promise.all([processLocalEpub(input.source, signal), processLocalEpub(input.target, signal)])
      self.postMessage({ result: relocatePublication(input.snapshot, input.contentId, source.source.documents, target.source.documents, source.source.spineOrder, target.source.spineOrder) })
    } else self.postMessage({ result: await processLocalEpub(input.file, signal, input.draft) })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'EPUB preparation failed' }) }
}
