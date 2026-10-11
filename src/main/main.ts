import {app, BrowserWindow, clipboard, dialog, ipcMain, Menu, type WebContents} from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {parseArgs} from '../lib/args.js'
import {addToHistory, loadHistory} from '../lib/history.js'
import {isProbablyUrl} from '../lib/platforms.js'
import {
  buildChoices,
  download,
  ensureYtDlp,
  findFfmpeg,
  probe,
  type DownloadChoice,
  type DownloadProgress,
} from '../lib/ytdlp.js'
import type {DownloadResponse, InitData, ProbeResponse} from '../shared/api.js'

const CONFIG_FILE = path.join(os.homedir(), '.yoinks', 'config.json')
const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Downloads')

// set at startup (see whenReady) and whenever the user picks a new folder
let outDir = DEFAULT_OUT_DIR


async function loadOutDir(): Promise<string> {
  try {
const saved = (JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) as {outDir?: unknown}).outDir
if (typeof saved === 'string' && (await fs.stat(saved)).isDirectory()) return saved
  } catch {
  }
return DEFAULT_OUT_DIR
}


async function saveOutDir(dir: string): Promise<void> {
  try {
await fs.mkdir(path.dirname(CONFIG_FILE), {recursive: true})
await fs.writeFile(CONFIG_FILE, JSON.stringify({outDir: dir}, null, 2))
  } catch (error) {
// the choice still applies for this session, it just won't persist
console.warn('yoinks: could not save config —', error)
  }
}


/** Thumbnails are small; fetching here keeps the window's CSP strict. */
async function fetchThumbnail(url?: string): Promise<string | undefined> {
if (!url) return undefined
try {
const response = await fetch(url, {signal: AbortSignal.timeout(8_000)})
if (!response.ok) return undefined
const type = response.headers.get('content-type') ?? ''
if (!type.startsWith('image/')) return undefined
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.length > 5 * 1024 * 1024) return undefined
return `data:${type};base64,${bytes.toString('base64')}`
  } catch {
return undefined
  }
}


// launched from Finder / a launcher there is no terminal attached — a write
// to the closed pipe must not crash the app
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

// Apps launched from Finder or a desktop menu don't get the shell's PATH, so a
// yt-dlp/ffmpeg from Homebrew or `pip --user` would go unseen. Append the
// usual install dirs (appended, so a PATH you launched with still wins).
if (process.platform !== 'win32') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')]
  process.env.PATH = [process.env.PATH ?? '', ...extra].join(path.delimiter)
}

// ── was cli.tsx ───────────────────────────────────────────────────────────
const HELP = `
  yoinks — yoink any video. paste. yoink. done.

  Usage
    $ yoinks [url]

  Examples
    $ yoinks https://youtu.be/dQw4w9WgXcQ
    $ yoinks https://x.com/user/status/123456
    $ yoinks                 (prompts for a url)

  Options
    --theme <mode>  use auto, light, or dark for this run
    -h, --help      show this help
    -v, --version   show version

  Downloads are saved to ~/Downloads.
  Powered by yt-dlp — YouTube, X, Instagram, Threads, TikTok & 1800+ sites.
`

// packaged: [app, ...args] · dev (`electron .`): [electron, '.', ...args]
const args = parseArgs(process.argv.slice(app.isPackaged ? 1 : 2))

if (args.error) {
  console.error(`yoinks: ${args.error}\nTry “yoinks --help” for usage.`)
  process.exit(1)
}
if (args.help) {
  console.log(HELP)
  process.exit(0)
}
if (args.version) {
  console.log(app.getVersion()) // read from package.json, as before
  process.exit(0)
}

const initialUrl = args.initialUrl
const themeMode = args.themeMode ?? 'auto'

// ── state that used to live in refs in app.tsx ────────────────────────────
let ytdlp = '' // ytdlpRef
let current: {url: string; choices: DownloadChoice[]; infoJsonPath: string} | undefined
let outcome: string | undefined // what onOutcome received
const jobs = new Map<number, AbortController>() // abortRef, keyed by job

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

function startJob(job: number): AbortController {
  const controller = new AbortController()
  jobs.set(job, controller)
  return controller
}

function sender(contents: WebContents) {
  return (channel: string, ...args: unknown[]) => {
    if (!contents.isDestroyed()) contents.send(channel, ...args)
  }
}

/**
 * The clipboard only feeds an optional suggestion, so a clipboard problem
 * must never stop the app from starting — it just means no suggestion.
 */
function readClipboardText(): string {
  try {
    const text: unknown = clipboard.readText()
    if (typeof text === 'string') return text
    console.warn(`yoinks: clipboard.readText() returned ${typeof text}, expected string — skipping clipboard suggestion`)
  } catch (error) {
    console.warn('yoinks: could not read the clipboard —', error)
  }
  return ''
}

// ── IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('init', (): InitData => {
  // no url given — offer the clipboard url (⇥ to paste) when it already holds one
  let clipboardUrl: string | undefined
  if (!initialUrl) {
    const clipped = readClipboardText().trim()
    // reject multi-line clipboard content — new URL() silently strips newlines
    if (clipped && !/\s/.test(clipped) && isProbablyUrl(clipped)) clipboardUrl = clipped
  }
  return {
  initialUrl,
  clipboardUrl,
  initialThemeMode: themeMode,
  history: loadHistory(),
  homedir: os.homedir(),
  outDir,
    }
})

ipcMain.handle('probe', async (event, job: number, url: string): Promise<ProbeResponse> => {
const controller = startJob(job)
const send = sender(event.sender)
try {
    ytdlp ||= await ensureYtDlp(status => send('probe:status', job, status), controller.signal)
if (controller.signal.aborted) return {status: 'cancelled'}
send('probe:status', job, 'fetching video info…')
const {info, infoJsonPath} = await probe(ytdlp, url, controller.signal)
if (controller.signal.aborted) return {status: 'cancelled'}
const choices = buildChoices(info)
    current = {url, choices, infoJsonPath}
const thumbnail = await fetchThumbnail(info.thumbnail)
return {
  status: 'ok',
  info: {
  title: info.title,
  uploader: info.uploader,
  duration: info.duration,
  description: info.description,
  uploadDate: info.upload_date,
  thumbnail,
      },
choices: choices.map(({label, kind}) => ({label, kind})),
    }
  } catch (error) {
return controller.signal.aborted ? {status: 'cancelled'} : {status: 'error', message: errorMessage(error)}
  } finally {
    jobs.delete(job)
  }
})

ipcMain.handle('download', async (event, job: number, choiceIndex: number): Promise<DownloadResponse> => {
  const run = current
  const choice = run?.choices[choiceIndex]
  if (!run || !choice) return {status: 'error', message: 'Nothing to download — paste a link first.'}

  const controller = startJob(job)
  const send = sender(event.sender)
  const handlers = {
    onProgress: (progress: DownloadProgress) => send('download:progress', job, progress),
    onProcessing: () => send('download:processing', job),
  }
  try {
    const ffmpegLocation = await findFfmpeg()
    const base = {ytdlp, ffmpegLocation, url: run.url, choice, outDir}
    let filepath: string
    try {
      // reuse the probe's metadata — starts immediately instead of re-extracting
      filepath = await download({...base, infoJsonPath: run.infoJsonPath}, handlers, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) throw error
      // media urls in the cached info can expire — retry with a fresh extraction
      send('download:refreshing', job)
      filepath = await download(base, handlers, controller.signal)
    }
    outcome = filepath
    return {status: 'ok', filepath, history: addToHistory(run.url)}
  } catch (error) {
    return controller.signal.aborted ? {status: 'cancelled'} : {status: 'error', message: errorMessage(error)}
  } finally {
    jobs.delete(job)
  }
})

ipcMain.handle('choose-dir', async (event): Promise<string | undefined> => {
const win = BrowserWindow.fromWebContents(event.sender)
const options = {
title: 'Save downloads to',
defaultPath: outDir,
properties: ['openDirectory', 'createDirectory'] as const,
  }
const result = win
? await dialog.showOpenDialog(win, {...options, properties: [...options.properties]})
: await dialog.showOpenDialog({...options, properties: [...options.properties]})
if (result.canceled || !result.filePaths[0]) return undefined
  outDir = result.filePaths[0]
await saveOutDir(outDir)
return outDir
})

ipcMain.on('cancel', (_event, job: number) => jobs.get(job)?.abort())
ipcMain.on('quit', () => app.quit())

// ── window ────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 520,
    minHeight: 460,
    title: 'yoinks',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  // dropping a link outside the input would otherwise navigate the window away
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

void app.whenReady().then(async () => {
  outDir = await loadOutDir()
  Menu.setApplicationMenu(
    process.platform === 'darwin'
? Menu.buildFromTemplate([{role: 'appMenu'}, {role: 'editMenu'}, {role: 'windowMenu'}])
: null,
  )
createWindow()
})

// the terminal app ended when you left it — same here, on every platform
app.on('window-all-closed', () => app.quit())

app.on('will-quit', () => {
  if (outcome) console.log(`✓ yoinked → ${outcome}`)
})