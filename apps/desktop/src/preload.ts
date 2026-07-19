import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aigcDirector', {
  getSessionConfig: async () => await ipcRenderer.invoke('director:session') as { apiBaseUrl: string; sessionToken: string; platform: string },
  selectExportDirectory: async () => await ipcRenderer.invoke('director:select-export-directory') as string | null,
  getAppInfo: async () => await ipcRenderer.invoke('director:app-info') as { name: string; version: string },
})

contextBridge.exposeInMainWorld('legacyGate', {
  getSummary: async () => await ipcRenderer.invoke('legacy-purge:summary') as { totalFiles: number; totalBytes: number; locations: Array<{ label: string; files: number; bytes: number }> },
  confirm: async (confirmation: string) => await ipcRenderer.invoke('legacy-purge:confirm', confirmation) as { completed: boolean },
  cancel: async () => await ipcRenderer.invoke('legacy-purge:cancel') as { cancelled: boolean },
})
