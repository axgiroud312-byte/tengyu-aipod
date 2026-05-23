/// <reference types="vite/client" />

interface Window {
  api: {
    ping: () => Promise<string>
  }
}
