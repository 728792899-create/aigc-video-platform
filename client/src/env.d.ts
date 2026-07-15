/// <reference types="vite/client" />

import type { AigcStudioBridge } from '@aigc-video/contracts'

declare global {
  interface Window {
    aigcStudio?: AigcStudioBridge
  }
}

export {}
