import {formatBytes, formatDuration, formatEta, formatSpeed, shortenPath, truncate} from '../lib/format.js'
import {detectPlatform, isProbablyUrl, type Platform} from '../lib/platforms.js'
import type {DownloadProgress} from '../lib/ytdlp.js'
import type {ChoiceSummary, VideoSummary} from '../shared/api.js'
import {mountLogo} from './components/logo.js'
import {setProgress} from './components/progress-bar.js'
import {renderShortcuts} from './components/shortcuts.js'
import {startSpinners} from './components/spinner.js'
import {attachTextInput} from './components/text-input.js'
import {applyTheme, nextThemeMode, type ThemeMode} from './theme.js'

const api = window.yoinks

const choiceLabel = (choice: ChoiceSummary) => `${choice.kind === 'audio' ? '♪ ' : '▶ '}${choice.label}`

// fixed-width slots — the centered line must not change width as values tick
function partLabel(progress: DownloadProgress): string {
  // explains the bar resetting between files (video, then audio)
  return progress.totalParts > 1 ? `part ${progress.part + 1}/${progress.totalParts}  ` : ''
}

function downloadMeta(progress: DownloadProgress): string {
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  const eta = progress.eta ? `${formatEta(progress.eta)} left` : ''
  return `${partLabel(progress)}${speed.padStart(10)}  ${eta.padEnd(12)}`
}

function indeterminateMeta(progress: DownloadProgress): string {
  const bytes = formatBytes(progress.downloadedBytes)
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  return `${partLabel(progress)}${bytes.padStart(8)}  ${speed.padEnd(10)}`
}

type Phase =
  | {name: 'input'; warning?: string}
  | {name: 'probing'; status: string}
  | {name: 'picking'}
  | {name: 'downloading'; choice: ChoiceSummary; progress?: DownloadProgress; processing: boolean; refreshing?: boolean}
  | {name: 'done'; filepath: string}
  | {name: 'error'; message: string}

const HINTS: Record<Phase['name'], Array<[string, string]>> = {
  input: [
    ['↵', 'yoink'],
    ['^c', 'quit'],
  ],
  probing: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  picking: [
    ['↑↓', 'choose'],
    ['↵', 'yoink'],
    ['^o', 'folder'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  downloading: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  done: [['^c', 'quit']],
  error: [
    ['↵', 'try again'],
    ['^c', 'quit'],
  ],
}

// ── elements ──────────────────────────────────────────────────────────────
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const ui = {
  logo: byId<HTMLButtonElement>('logo'),
  logoArt: byId('logo-art'),
  phases: {
    input: byId('phase-input'),
    probing: byId('phase-probing'),
    picking: byId('phase-picking'),
    downloading: byId('phase-downloading'),
    done: byId('phase-done'),
    error: byId('phase-error'),
  } satisfies Record<Phase['name'], HTMLElement>,
  urlInput: byId<HTMLInputElement>('url-input'),
  yoinkButton: byId<HTMLButtonElement>('yoink-button'),
  inputNote: byId('input-note'),
  probeTitle: byId('probe-title'),
  probeUrl: byId('probe-url'),
  videoTitle: byId('video-title'),
  videoDetails: byId('video-details'),
  choices: byId<HTMLUListElement>('choices'),
  dlTitle: byId('dl-title'),
  dlProgress: byId('dl-progress'),
  dlBusy: byId('dl-busy'),
  dlMeta: byId('dl-meta'),
  dlStatus: byId('dl-status'),
  dlStatusText: byId('dl-status-text'),
  donePath: byId('done-path'),
  doneButton: byId<HTMLButtonElement>('done-button'),
  errorMessage: byId('error-message'),
  probeStatus: byId('probe-status'),
  probeStatusText: byId('probe-status-text'),
  hints: byId<HTMLUListElement>('hints'),
  videoThumb: byId<HTMLImageElement>('video-thumb'),
  videoDescription: byId('video-description'),
  dirButton: byId<HTMLButtonElement>('dir-button'),
}

// ── state (was useState / useRef) ─────────────────────────────────────────
let phase: Phase = {name: 'input'}
let themeMode: ThemeMode = 'auto'
let url = ''
let history: string[] = []
let platform: Platform | undefined
let info: VideoSummary | undefined
let choices: ChoiceSummary[] = []
let highlight = 0 // choice under the cursor, for the ↵ hint click
let clipboardUrl: string | undefined
let homedir = ''
let outDir = ''
let nextJob = 0
let activeJob = 0 // the run abortRef pointed at; events from any other job are stale
let hintsKey = ''

const clipboardOffered = () => Boolean(clipboardUrl) && ui.urlInput.value === ''
const clipboardAccepted = () => Boolean(clipboardUrl) && ui.urlInput.value === clipboardUrl

const textInput = attachTextInput({
  input: ui.urlInput,
  history: () => history,
  onChange: () => render(),
  onSubmit: value => handleUrlSubmit(value),
  submitOnPaste: isProbablyUrl,
  onTab: () => {
    if (clipboardOffered()) setUrlInput(clipboardUrl!)
  },
})

function setUrlInput(value: string) {
  textInput.setValue(value)
  render()
}

function setPhase(next: Phase) {
  phase = next
  render()
}

// ── actions ───────────────────────────────────────────────────────────────
function cycleTheme() {
  themeMode = nextThemeMode(themeMode)
  applyTheme(themeMode)
  render()
}

function quit() {
  api.quit()
}

async function startProbe(targetUrl: string) {
  const job = ++nextJob
  activeJob = job
  platform = detectPlatform(targetUrl)
  setPhase({name: 'probing', status: 'warming up…'})
  const result = await api.probe(job, targetUrl)
  if (job !== activeJob || result.status === 'cancelled') return
  if (result.status === 'error') {
    setPhase({name: 'error', message: result.message})
    return
  }
  info = result.info
  choices = result.choices
  highlight = 0
  renderChoices()
  setPhase({name: 'picking'})
}

function resetToInput() {
  url = ''
  textInput.setValue('')
  platform = undefined
  info = undefined
  choices = []
  setPhase({name: 'input'})
}

function cancelRun() {
  api.cancel(activeJob)
  activeJob = 0
  const kept = url
  resetToInput()
  setUrlInput(kept) // keep the link around so a cancel isn't destructive
}

function handleUrlSubmit(value: string) {
  const trimmed = value.trim()
  if (!isProbablyUrl(trimmed)) {
    setPhase({name: 'input', warning: 'that doesn’t look like a link — paste a full url'})
    return
  }
  url = trimmed
  void startProbe(trimmed)
}

function formatUploadDate(raw?: string): string | undefined {
if (!raw || !/^\d{8}$/.test(raw)) return undefined
return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`
}

async function chooseDir() {
const picked = await api.chooseDir()
if (picked) {
    outDir = picked
render()
  }
}

function handlePick(index: number) {
  const choice = choices[index]
  if (!choice) return
  const job = ++nextJob
  activeJob = job
  setPhase({name: 'downloading', choice, processing: false})
  void (async () => {
    const result = await api.download(job, index)
    if (job !== activeJob || result.status === 'cancelled') return
    if (result.status === 'error') {
      setPhase({name: 'error', message: result.message})
      return
    }
    history = result.history
    setPhase({name: 'done', filepath: result.filepath})
  })()
}

function currentHints(): Array<[string, string]> {
  let hints: Array<[string, string]> = [...HINTS[phase.name], ['^t', `theme:${themeMode}`]]
  if (phase.name === 'input' && history.length > 0) {
    hints = [hints[0]!, ['↑', 'history'], ...hints.slice(1)]
  }
  return hints
}

function hintAction(key: string): (() => void) | undefined {
  if (key === '^c') return quit
  if (key === '^t') return cycleTheme
  if (key === '^o') return phase.name === 'picking' ? () => void chooseDir() : undefined
  if (key === 'esc') return phase.name === 'probing' || phase.name === 'downloading' ? cancelRun : resetToInput
  if (key === '↵') {
    if (phase.name === 'input') return () => handleUrlSubmit(ui.urlInput.value)
    if (phase.name === 'picking') return () => handlePick(highlight)
    if (phase.name === 'error' || phase.name === 'done') return resetToInput
  }
  return undefined // ↑↓ / ↑ stay keyboard-only
}

// ── progress events from main ─────────────────────────────────────────────
api.onProbeStatus((job, status) => {
  if (job === activeJob && phase.name === 'probing') setPhase({name: 'probing', status})
})
api.onProgress((job, progress) => {
  if (job === activeJob && phase.name === 'downloading') setPhase({...phase, progress, processing: false})
})
api.onProcessing(job => {
  if (job === activeJob && phase.name === 'downloading') setPhase({...phase, processing: true})
})
api.onRefreshing(job => {
  if (job === activeJob && phase.name === 'downloading') setPhase({...phase, progress: undefined, refreshing: true})
})

// ── rendering ─────────────────────────────────────────────────────────────
function renderChoices() {
  ui.choices.replaceChildren(
    ...choices.map((choice, index) => {
      const item = document.createElement('li')
      item.id = `choice-${index}`
      item.className = 'choice'
      item.setAttribute('role', 'option')
      item.dataset.index = String(index)
      const indicator = document.createElement('span')
      indicator.className = 'indicator'
      indicator.setAttribute('aria-hidden', 'true')
      indicator.textContent = '❯'
      const label = document.createElement('span')
      label.textContent = choiceLabel(choice)
      item.append(indicator, label)
      return item
    }),
  )
  renderHighlight()
}

function renderHighlight() {
  for (const item of ui.choices.children) {
    item.setAttribute('aria-selected', String(Number((item as HTMLElement).dataset.index) === highlight))
  }
  ui.choices.setAttribute('aria-activedescendant', `choice-${highlight}`)
}

function render() {
  const current = phase
  document.body.dataset.phase = current.name
  for (const [name, section] of Object.entries(ui.phases)) section.hidden = name !== current.name

  switch (current.name) {
    case 'input': {
      const note = current.warning
        ? `✗ ${current.warning}`
        : clipboardOffered()
          ? 'link in your clipboard — ⇥ to paste it'
          : clipboardAccepted()
            ? 'from your clipboard — ↵ to yoink it'
            : ''
      ui.inputNote.textContent = note
      ui.inputNote.hidden = !note
      if (document.activeElement !== ui.urlInput) ui.urlInput.focus()
      break
    }
    case 'probing': {
      ui.probeTitle.textContent = platform ? platform.label : 'Paste a link'
      ui.probeUrl.textContent = url // CSS adds the … when it doesn't fit
      break
    }
    case 'picking': {
          ui.videoTitle.textContent = info?.title ?? ''
          ui.videoThumb.src = info?.thumbnail ?? ''
          ui.videoThumb.hidden = !info?.thumbnail
          ui.videoDetails.textContent = [
      `▸ ${platform?.label ?? ''}`,
            info?.duration ? formatDuration(info.duration) : '',
            info?.uploader ?? '',
            formatUploadDate(info?.uploadDate) ?? '',
          ]
            .filter(Boolean)
            .join(' · ')
          ui.videoDescription.textContent = info?.description ?? ''
          ui.videoDescription.hidden = !info?.description
          ui.dirButton.textContent = `saving to ${shortenPath(outDir, homedir, 40)} · change`
    if (document.activeElement !== ui.choices) ui.choices.focus()
    break
    }
    case 'downloading': {
      ui.dlTitle.textContent = `${info?.title ? `${truncate(info.title, 42)} · ` : ''}${current.choice.label}`
      // every branch fills the same two rows, so the layout never jumps
      const progress = current.progress
      let percent: number | undefined // undefined → spinner row instead of bar
      let meta: string | undefined // undefined → status row instead of meta
      let status = ''
      if (current.processing) {
        percent = 1
        status = 'processing…'
      } else if (progress?.totalBytes) {
        percent = progress.downloadedBytes / progress.totalBytes
        meta = downloadMeta(progress)
      } else if (progress) {
        meta = indeterminateMeta(progress)
      } else {
        percent = 0
        status = current.refreshing ? 'link expired — grabbing a fresh one…' : 'starting download…'
      }
      ui.dlProgress.hidden = percent === undefined
      ui.dlBusy.hidden = percent !== undefined
      if (percent !== undefined) setProgress(ui.dlProgress, percent)
      ui.dlMeta.hidden = meta === undefined
      ui.dlStatus.hidden = meta !== undefined
      ui.dlMeta.textContent = meta ?? ''
      ui.dlStatusText.textContent = status
      break
    }
    case 'done': {
      ui.donePath.textContent = shortenPath(current.filepath, homedir, 60)
      break
    }
    case 'error': {
      ui.errorMessage.textContent = `✗ ${current.message}`
      break
    }
  }

  // rebuild the hint buttons only when they change — progress ticks re-render
  // many times a second, and replacing a button mid-click would eat the click
  const hints = currentHints()
  const key = `${current.name}|${hints.map(hint => hint.join(' ')).join('|')}`
  if (key !== hintsKey) {
    hintsKey = key
    renderShortcuts(
      ui.hints,
      hints.map(([hintKey, label]) => ({
        key: hintKey,
        label,
        onClick: hintAction(hintKey) ? () => hintAction(hintKey)?.() : undefined,
      })),
    )
  }
  ui.probeStatus.hidden = current.name !== 'probing'
  if (current.name === 'probing') ui.probeStatusText.textContent = current.status
}

// ── input ─────────────────────────────────────────────────────────────────
function hasTextSelection(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLInputElement) return active.selectionStart !== active.selectionEnd
  return Boolean(window.getSelection()?.toString())
}

/** ink-select-input's keys: ↑/k ↓/j (wrapping), 1–9 pick directly, ↵ picks. */
function handlePickerKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const {key} = event
  if (key === 'ArrowUp' || key === 'k' || key === 'ArrowDown' || key === 'j') {
    const step = key === 'ArrowUp' || key === 'k' ? -1 : 1
    highlight = (highlight + step + choices.length) % choices.length
    renderHighlight()
    return true
  }
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1
    if (index < choices.length) handlePick(index)
    return true
  }
  if (key === 'Enter') {
    handlePick(highlight)
    return true
  }
  return false
}

document.addEventListener('keydown', event => {
  const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey
  const key = event.key
  if (ctrlOnly && key.toLowerCase() === 't') {
    event.preventDefault()
    cycleTheme()
    return
  }
  if (ctrlOnly && key.toLowerCase() === 'o' && phase.name === 'picking') {
    event.preventDefault()
    void chooseDir()
    return
  }
  // ^c quits as it did in the terminal — unless text is selected, then it copies
  if (ctrlOnly && key.toLowerCase() === 'c' && !hasTextSelection()) {
    event.preventDefault()
    quit()
    return
  }
  if (key === 'Escape') {
    if (phase.name === 'picking' || phase.name === 'error' || phase.name === 'done') resetToInput()
    else if (phase.name === 'probing' || phase.name === 'downloading') cancelRun()
    return
  }
  if (key === 'Enter' && (phase.name === 'error' || phase.name === 'done')) {
    event.preventDefault()
    resetToInput()
    return
  }
  if (phase.name === 'picking') {
    if (handlePickerKey(event)) event.preventDefault()
    return
  }
  if (phase.name === 'input' && document.activeElement !== ui.urlInput) ui.urlInput.focus()
})

// Keyboard focus stays where the terminal had it: clicking a button, the logo
// or empty space must not pull it off the url field or the choice list.
// (Text stays selectable in the downloading / done / error phases.)
document.addEventListener('mousedown', event => {
  const target = event.target as Element
  if (target === ui.urlInput) return
  if (target.closest('button, [role="option"]') || phase.name === 'input' || phase.name === 'picking') {
    event.preventDefault()
  }
})

ui.yoinkButton.addEventListener('click', () => handleUrlSubmit(ui.urlInput.value))
ui.doneButton.addEventListener('click', resetToInput)
ui.choices.addEventListener('click', event => {
  const option = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
  if (option && phase.name === 'picking') handlePick(Number(option.dataset.index))
})
// the logo takes you home
ui.logo.addEventListener('click', () => {
  if (phase.name === 'probing' || phase.name === 'downloading') cancelRun()
  else if (phase.name !== 'input') resetToInput()
})
ui.dirButton.addEventListener('click', () => void chooseDir())
ui.videoDescription.addEventListener('click', () => ui.videoDescription.classList.toggle('expanded'))

// ── drag a link from the browser onto the window ─────────────────────────
// Browsers put the dragged link in text/uri-list (or text/plain as a fallback).
function carriesLink(event: DragEvent): boolean {
const types = Array.from(event.dataTransfer?.types ?? [])
return types.includes('text/uri-list') || types.includes('text/plain')
}


function linkFromDrop(event: DragEvent): string | undefined {
const data = event.dataTransfer
if (!data) return undefined
// uri-list can hold several lines; the first non-comment line is the link
const fromList = data
    .getData('text/uri-list')
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))
return fromList || data.getData('text/plain').trim() || undefined
}


// dragenter/dragleave fire for every child element; a counter keeps the
// highlight from flickering as the pointer crosses boundaries
let dragDepth = 0


document.addEventListener('dragenter', event => {
if (!carriesLink(event)) return
  dragDepth++
document.body.classList.add('drop-target')
})


document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
if (dragDepth === 0) document.body.classList.remove('drop-target')
})


// preventDefault on every dragover: that's what allows a drop at all, and it
// stops the window from navigating to whatever was dropped
document.addEventListener('dragover', event => {
  event.preventDefault()
if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
})


document.addEventListener('drop', event => {
  event.preventDefault()
  dragDepth = 0
document.body.classList.remove('drop-target')


const dropped = linkFromDrop(event)
if (!dropped) return
// a probe or download is already running — don't silently replace it
if (phase.name === 'probing' || phase.name === 'downloading') return


if (!isProbablyUrl(dropped)) {
    setPhase({name: 'input', warning: 'that doesn’t look like a link — paste a full url'})
return
  }
  setUrlInput(dropped) // show it in the field too, so it's editable afterward
  handleUrlSubmit(dropped)
})
// ── boot ──────────────────────────────────────────────────────────────────
async function boot() {
mountLogo(ui.logoArt, !matchMedia('(prefers-reduced-motion: reduce)').matches)
startSpinners()
const init = await api.init()
  themeMode = init.initialThemeMode
applyTheme(themeMode)
  history = init.history
  clipboardUrl = init.clipboardUrl
  homedir = init.homedir
  outDir = init.outDir
  if (init.initialUrl) {
    url = init.initialUrl
    void startProbe(init.initialUrl)
  } else {
    render()
  }
}

void boot()