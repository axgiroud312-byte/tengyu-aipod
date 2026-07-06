/// <reference types="vite/client" />

import type { ClientApi } from '@tengyu-aipod/shared'

declare global {
  interface Window {
    api: ClientApi & typeof import('../../preload/api').api
  }
}
