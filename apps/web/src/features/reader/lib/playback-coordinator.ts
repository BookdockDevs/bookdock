export type ReaderPlaybackOwner = 'auto' | 'tts' | 'media'

export interface PlaybackClaim {
  accepted: boolean
  isCurrent: () => boolean
}

export interface PlaybackToggle {
  /** Whether a toggle press would change anything right now. */
  available: () => boolean
  apply: () => void
}

type Stopper = () => void | Promise<void>

/** Serializes reader playback features so a stale async start cannot take over later. */
export class ReaderPlaybackCoordinator {
  private generation = 0
  private owner: ReaderPlaybackOwner | null = null
  private stoppers = new Map<ReaderPlaybackOwner, Stopper>()
  private toggles = new Map<ReaderPlaybackOwner, PlaybackToggle>()

  register(owner: ReaderPlaybackOwner, stopper: Stopper) {
    this.stoppers.set(owner, stopper)
    return () => {
      if (this.stoppers.get(owner) === stopper) this.stoppers.delete(owner)
    }
  }

  registerToggle(owner: ReaderPlaybackOwner, toggle: PlaybackToggle) {
    this.toggles.set(owner, toggle)
    return () => {
      if (this.toggles.get(owner) === toggle) this.toggles.delete(owner)
    }
  }

  /**
   * Whether the owning session would respond to a pause/resume press. Read
   * synchronously: a key handler must decide whether to consume the press
   * before the browser applies the default action, and the owner's own state
   * decides the answer — a stopped session leaves `owner` set but inert.
   */
  canToggle(): boolean {
    return this.owner !== null && this.toggles.get(this.owner)?.available() === true
  }

  toggle() {
    const toggle = this.owner === null ? undefined : this.toggles.get(this.owner)
    if (toggle?.available()) toggle.apply()
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
