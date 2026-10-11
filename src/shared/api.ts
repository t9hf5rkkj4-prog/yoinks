import type {DownloadProgress} from '../lib/ytdlp.js'
import type {ThemeMode} from '../theme.js'
export type {ThemeMode}


/** The part of yt-dlp's info the UI shows. The formats list stays in main. */
export type VideoSummary = {
title: string
uploader?: string
duration?: number
description?: string
/** yt-dlp's yyyymmdd string */
uploadDate?: string
/** data: URL, fetched in main so the renderer never touches the network */
thumbnail?: string
}


/**
 * What the UI needs to list a choice. The yt-dlp args stay in main, so the
 * window can never hand arbitrary flags to a spawned process.
 */
export type ChoiceSummary = {label: string; kind: 'video' | 'audio'}


export type InitData = {
initialUrl?: string
clipboardUrl?: string
initialThemeMode: ThemeMode
history: string[]
homedir: string
/** where finished downloads go */
outDir: string
}


// Results come back as values instead of thrown errors. Errors thrown across
// ipcRenderer.invoke get rewrapped as "Error invoking remote method …", which
// would change the messages users see.
type Failure = {status: 'error'; message: string} | {status: 'cancelled'}
export type ProbeResponse = {status: 'ok'; info: VideoSummary; choices: ChoiceSummary[]} | Failure
export type DownloadResponse = {status: 'ok'; filepath: string; history: string[]} | Failure


export type YoinksApi = {
init(): Promise<InitData>
probe(job: number, url: string): Promise<ProbeResponse>
download(job: number, choiceIndex: number): Promise<DownloadResponse>
/** resolves to the new folder, or undefined if the user cancelled */
chooseDir(): Promise<string | undefined>
cancel(job: number): void
quit(): void
onProbeStatus(listener: (job: number, status: string) => void): void
onProgress(listener: (job: number, progress: DownloadProgress) => void): void
onProcessing(listener: (job: number) => void): void
onRefreshing(listener: (job: number) => void): void
}


declare global {
interface Window {
yoinks: YoinksApi
  }
}