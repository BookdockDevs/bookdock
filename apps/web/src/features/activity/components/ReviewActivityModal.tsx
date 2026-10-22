import { useQueryClient } from '@tanstack/react-query'

import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import ReviewDetailHeaderActions, { ReviewDetailModalTitle } from '@/features/reviews/components/ReviewDetailHeaderActions'
import ReviewDetailView from '@/features/reviews/components/ReviewDetailView'
import { useReviewDiscussion } from '@/features/reviews/hooks/useReviews'
import { useTranslation } from '@/hooks/useTranslation'

interface ReviewActivityModalProps {
  reviewId: string
  onClose: () => void
}

export default function ReviewActivityModal({ reviewId, onClose }: ReviewActivityModalProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const query = useReviewDiscussion(reviewId)

  const titleNode = <ReviewDetailModalTitle onBack={onClose} />

  if (query.isError) {
    return (
      <Modal title={titleNode} onClose={onClose} closeLabel={_('library.close')} hideClose={true} size="xl">
        <QueryErrorState isRetrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Modal>
    )
  }

  if (query.isPending || !query.data) {
    return (
      <Modal title={titleNode} onClose={onClose} closeLabel={_('library.close')} hideClose={true} size="xl">
        <div role="status" className="h-48 animate-pulse rounded-xl bg-stone-500/10" />
      </Modal>
    )
  }

  const review = query.data.data.review

  return (
    <Modal
      title={titleNode}
      onClose={onClose}
      closeLabel={_('library.close')}
      hideClose={true}
      size="xl"
      actions={
        <ReviewDetailHeaderActions
          review={review}
          onDeleted={() => {
            void queryClient.invalidateQueries({ queryKey: ['activity'] })
            onClose()
          }}
        />
      }
    >
      <ReviewDetailView review={review} />
    </Modal>
  )
}
