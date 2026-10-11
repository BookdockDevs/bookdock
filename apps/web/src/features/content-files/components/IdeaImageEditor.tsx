import { useEffect, useRef, useState } from 'react'

import type { AnnotationUpdateReq, ContentFile } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

import { useContentDraft } from '../hooks/useContentDraft'
import ContentImages from './ContentImages'
import ContentUpload from './ContentUpload'

interface IdeaImageEditorProps {
  bookVersionId: string
  targetId?: string
  initialImages?: ContentFile[]
  disabled?: boolean
  onChange: (association: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>, uploading: boolean) => void
}

export default function IdeaImageEditor({ bookVersionId, targetId, initialImages = [], disabled, onChange }: IdeaImageEditorProps) {
  const _ = useTranslation()
  const [images, setImages] = useState(initialImages)
  const change = useRef(onChange)
  useEffect(() => { change.current = onChange }, [onChange])
  const draft = useContentDraft({ domain: 'idea', bookVersionId, targetId }, (image) => {
    setImages((current) => [...current, image])
  })
  useEffect(() => { change.current({ imageIds: images.map((file) => file.id), draftId: draft.draftId }, draft.uploading) }, [images, draft.draftId, draft.uploading])
  return <div className="flex min-w-0 flex-col gap-2">
    <ContentImages images={images} />
    {images.map((image) => <div key={image.id} className="flex min-w-0 items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate">{image.name}</span><Button variant="secondary" disabled={disabled} onClick={() => setImages((current) => current.filter((file) => file.id !== image.id))}>{_('contentFiles.remove')}</Button></div>)}
    <ContentUpload disabled={disabled} entries={draft.entries} onAdd={draft.add} onRetry={draft.retry} />
  </div>
}
