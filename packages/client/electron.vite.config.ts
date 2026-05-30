import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const mainEnvDefine = {
  'process.env.TENGYU_SERVER_URL': JSON.stringify(process.env.TENGYU_SERVER_URL ?? ''),
}

export default defineConfig({
  main: {
    define: mainEnvDefine,
    plugins: [externalizeDepsPlugin({ exclude: ['@tengyu-aipod/shared'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@tengyu-aipod/shared'] })],
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
})
