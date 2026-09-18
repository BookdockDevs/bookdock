export type ReaderPlaybackOwner = 'auto' | 'tts' | 'media'

export interface PlaybackClaim {
  accepted: boolean
  isCurrent: () => boolean
}

type Stopper = () => void | Promise<void>

/** Serializes reader playback features so a stale async start cannot take over later. */
export class ReaderPlaybackCoordinator {
  private generation = 0
  private owner: ReaderPlaybackOwner | null = null
  private stoppers = new Map<ReaderPlaybackOwner, Stopper>()

  register(owner: ReaderPlaybackOwner, stopper: Stopper) {
    this.stoppers.set(owner, stopper)
    return () => {
      if (this.stoppers.get(owner) === stopper) this.stoppers.delete(owner)
    }
  }

  async claim(owner: ReaderPlaybackOwner): Promise<PlaybackClaim> {
    const generation = ++this.generation
    const peers: ReaderPlaybackOwner[] = ['auto', 'tts', 'media']
    for (const peer of peers) {
      if (peer !== owner && this.owner === peer) await this.stoppers.get(peer)?.()
    }
    const accepted = generation === this.generation
    if (accepted) this.owner = owner
    return {
      accepted,
      isCurrent: () => accepted && generation === this.generation && this.owner === owner,
    }
  }

}
