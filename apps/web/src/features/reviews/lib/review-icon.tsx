/**
 * The review glyph: a bubble carrying two lines of text. It reads as a
 * written review rather than a discussion - the plain bubble stays the
 * comment count inside review cards, so the two must not share a shape.
 *
 * Exported as paths so an action-row icon button can draw it inside its own
 * svg, and a labelled button can do the same in a second size.
 */
export const reviewIconPaths = (
  <>
    <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
    <path d="M8 8.5h8" />
    <path d="M8 12.5h5" />
  </>
)
