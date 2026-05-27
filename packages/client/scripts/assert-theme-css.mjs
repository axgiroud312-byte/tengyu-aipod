import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDir = fileURLToPath(new URL('../out/renderer/assets/', import.meta.url))

const requiredSelectors = [
  ['bg-primary', /\.bg-primary([,{]|$)/],
  ['text-primary-foreground', /\.text-primary-foreground([,{]|$)/],
  ['bg-card', /\.bg-card([,{]|$)/],
  ['bg-muted', /\.bg-muted([,{]|$)/],
  ['text-muted-foreground', /\.text-muted-foreground([,{]|$)/],
  ['border-border', /\.border-border([,{]|$)/],
  ['border-input', /\.border-input([,{]|$)/],
  ['focus-visible:ring-ring', /\.focus-visible\\:ring-ring:focus-visible([,{]|$)/],
]

const files = (await readdir(assetsDir))
  .filter((file) => file.endsWith('.css'))
  .map((file) => join(assetsDir, file))

if (files.length === 0) {
  console.error('No built renderer CSS found. Run `pnpm -F @tengyu-aipod/client build` first.')
  process.exit(1)
}

const css = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
const missing = requiredSelectors
  .filter(([, pattern]) => !pattern.test(css))
  .map(([selector]) => selector)

if (missing.length > 0) {
  console.error(`Missing Tailwind theme utilities: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(
  `Theme CSS contract passed (${files.length} CSS file${files.length === 1 ? '' : 's'} checked).`,
)
