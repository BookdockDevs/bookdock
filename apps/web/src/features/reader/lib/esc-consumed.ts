// "Esc already handled by a popup" flag (boss key support): popups mark the
// flag in their own Esc branches; the Reader's global Esc handler defers its
// decision with setTimeout(0) so every popup listener runs first, then checks
// the flag — Esc exits the reader only when nothing else consumed it.
let consumed = false

export function markEscConsumed() {
  consumed = true
}

export function consumeEscFlag(): boolean {
  const was = consumed
  consumed = false
  return was
}
