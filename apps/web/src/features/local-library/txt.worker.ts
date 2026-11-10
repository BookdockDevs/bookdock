import { decodeLocalTxt, prepareEditedLocalTxt, prepareLocalTxt } from './prepare-txt'
import type { TxtWorkerInput } from './prepare-txt-worker'

self.onmessage = async (event: MessageEvent<TxtWorkerInput>) => {
  try {
    const input = event.data
    if (input.operation === 'decode') self.postMessage({ result: await decodeLocalTxt(input.file) })
    else if (input.operation === 'edit') self.postMessage({ result: await prepareEditedLocalTxt(input.draft, input.fileName, input.title, input.contentId) })
    else self.postMessage({ result: await prepareLocalTxt(input.file, input.fileName, input.title, input.contentId) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'TXT preparation failed' })
  }
}
