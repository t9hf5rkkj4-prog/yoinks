import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron'
import type {YoinksApi} from '../shared/api.js'


const on = <A extends unknown[]>(channel: string, listener: (...args: A) => void) => {
  ipcRenderer.on(channel, (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as A)))
}


const api: YoinksApi = {
init: () => ipcRenderer.invoke('init'),
probe: (job, url) => ipcRenderer.invoke('probe', job, url),
download: (job, choiceIndex) => ipcRenderer.invoke('download', job, choiceIndex),
chooseDir: () => ipcRenderer.invoke('choose-dir'),
cancel: job => ipcRenderer.send('cancel', job),
quit: () => ipcRenderer.send('quit'),
onProbeStatus: listener => on('probe:status', listener),
onProgress: listener => on('download:progress', listener),
onProcessing: listener => on('download:processing', listener),
onRefreshing: listener => on('download:refreshing', listener),
}


contextBridge.exposeInMainWorld('yoinks', api)