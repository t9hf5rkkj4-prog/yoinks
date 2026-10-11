// ink-spinner's "dots" — same frames and speed
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80

/** Animates every `.spinner` element on the page. */
export function startSpinners(root: ParentNode = document): void {
  let frame = 0
  const tick = () => {
    const glyph = FRAMES[frame++ % FRAMES.length]!
    for (const el of root.querySelectorAll<HTMLElement>('.spinner')) el.textContent = glyph
  }
  tick()
  setInterval(tick, INTERVAL_MS)
}