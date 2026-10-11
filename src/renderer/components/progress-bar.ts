/** Fills a `.progress` element (track, fill, percent label). Replaces progress-bar.tsx. */
export function setProgress(bar: HTMLElement, percent: number): void {
  const clamped = Math.max(0, Math.min(1, percent))
  const rounded = Math.round(clamped * 100)
  bar.querySelector<HTMLElement>('.progress-fill')!.style.transform = `scaleX(${clamped})`
  bar.querySelector<HTMLElement>('.progress-percent')!.textContent = `${rounded}%`
  bar.setAttribute('aria-valuenow', String(rounded))
}