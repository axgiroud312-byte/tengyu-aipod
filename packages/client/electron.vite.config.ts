import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const mainServerUrlDefine = process.env.TENGYU_SERVER_URL
  ? { 'process.env.TENGYU_SERVER_URL': JSON.stringify(process.env.TENGYU_SERVER_URL) }
  : {}

export default defineConfig({
  main: {
    ...(Object.keys(mainServerUrlDefine).length ? { define: mainServerUrlDefine } : {}),
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
