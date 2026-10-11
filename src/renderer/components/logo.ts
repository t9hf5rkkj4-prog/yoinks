const ART = [
  '▓ ▓ █▀█ ▀█▀ █▀▄█ █ █ █▀▀',
  '▀█▀ █ ▓  ▓  █  ▓ ▓▀▄ ▀▀▓',
  ' ▀  ▀▀▀ ▀▀▀ ▀  ▀ ▀ ▀ ▀▀▀',
]
const GRID = ART.map(line => [...line])
const ROWS = GRID.length
const COLS = GRID[0]!.length

// intro: each glyph flickers in as ░, sharpens to ▒, then resolves
const INTRO_MS = 900
const INTRO_SPREAD_MS = 550
// shimmer: a tilted beam crosses the glyphs, thinning them one density step
const SWEEP_MS = 1000
const SWEEP_EVERY_MS = 7_000
const FRAME_MS = 33
const TILT = 2 // columns of lean per row — beam slants like /
const HALF = 2.4 // beam half-width
// full-cell blocks swap to a lighter shade; half-blocks (▀ ▄) keep their
// glyph or the effect spills outside the letterform — they dim instead
const LIGHTER: Record<string, string> = {'█': '▒', '▓': '░'}
const HALF_BLOCKS = new Set(['▀', '▄'])

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

type Phase = 'intro' | 'idle' | 'sweep'
type Tone = 'primary' | 'secondary'
type Cell = {ch: string; tone: Tone}

function cellAt(ch: string, row: number, col: number, phase: Phase, t: number, delay: number): Cell {
  if (ch === ' ' || phase === 'idle') return {ch, tone: 'primary'}
  if (phase === 'intro') {
    const dt = t - delay
    if (dt < 0) return {ch: ' ', tone: 'primary'}
    if (dt < 110) return {ch: HALF_BLOCKS.has(ch) ? ch : '░', tone: 'secondary'}
    if (dt < 220) return {ch: HALF_BLOCKS.has(ch) ? ch : '▒', tone: 'secondary'}
    return {ch, tone: 'primary'}
  }
  // sweep — beam position leans right as it climbs, only glyphs are touched
  const pMin = -TILT * ROWS - HALF
  const pMax = COLS + HALF
  const p = pMin + ease(t / SWEEP_MS) * (pMax - pMin)
  const d = Math.abs(col - (ROWS - 1 - row) * TILT - p)
  if (d <= HALF && 1 - d / HALF > 0.35) {
    if (HALF_BLOCKS.has(ch)) return {ch, tone: 'secondary'}
    return {ch: LIGHTER[ch] ?? ch, tone: 'primary'}
  }
  return {ch, tone: 'primary'}
}

function renderRow(row: number, phase: Phase, t: number, delays: number[]): HTMLSpanElement[] {
  // group consecutive same-tone cells so each row is a few spans, not 24
  const segments: Array<{text: string; tone: Tone}> = []
  GRID[row]!.forEach((ch, col) => {
    const cell = cellAt(ch, row, col, phase, t, delays[col]!)
    const last = segments.at(-1)
    if (last && (last.tone === cell.tone || cell.ch === ' ')) last.text += cell.ch
    else segments.push({text: cell.ch, tone: cell.tone})
  })
  return segments.map(segment => {
    const span = document.createElement('span')
    span.className = segment.tone
    span.textContent = segment.text
    return span
  })
}

export function mountLogo(target: HTMLElement, animated: boolean): void {
  const delays = GRID.map(row => row.map(() => Math.random() * INTRO_SPREAD_MS))
  const draw = (phase: Phase, t: number) => {
    target.replaceChildren(
      ...GRID.flatMap((_, row) => [...renderRow(row, phase, t, delays[row]!), ...(row < ROWS - 1 ? ['\n'] : [])]),
    )
  }

  if (!animated) {
    draw('idle', 0)
    return
  }

  const run = (phase: Phase): void => {
    draw(phase, 0)
    if (phase === 'idle') {
      setTimeout(() => run('sweep'), SWEEP_EVERY_MS)
      return
    }
    const duration = phase === 'intro' ? INTRO_MS : SWEEP_MS
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        clearInterval(id)
        run('idle')
      } else {
        draw(phase, elapsed)
      }
    }, FRAME_MS)
  }
  run('intro')
}