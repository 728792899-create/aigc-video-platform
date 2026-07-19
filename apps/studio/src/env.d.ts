/// <reference types="vite/client" />

interface DirectorDesktopBridge {
  getSessionConfig(): Promise<{ apiBaseUrl: string; sessionToken: string; platform: string }>
  selectExportDirectory(): Promise<string | null>
  getAppInfo(): Promise<{ name: string; version: string }>
}

interface Window {
  aigcDirector?: DirectorDesktopBridge
}
