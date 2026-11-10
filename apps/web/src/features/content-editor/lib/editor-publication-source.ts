import type { ReaderManifest } from '@bookdock/shared'

export type EditorPublicationSource =
  | { kind: 'local'; file: Blob; revisionId: string; entries: { path: string; mediaType: string; size: number }[] }
  | { kind?: 'remote'; manifest: ReaderManifest; contentUrl: string; epoch: number; accountScope: string; revisionId?: string; entries?: ReaderManifest['entries'] }

export function editorSourceRevision(source: EditorPublicationSource) { return source.kind === 'local' ? source.revisionId : source.manifest.revisionId }
export function editorSourceEntries(source: EditorPublicationSource) { return source.kind === 'local' ? source.entries : source.manifest.entries }

