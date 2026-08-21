import { readFile, rm, writeFile } from 'node:fs/promises'

const scriptPath = new URL('../lib/client.js', import.meta.url)
const cssPath = new URL('../lib/style.css', import.meta.url)
const [script, css] = await Promise.all([
  readFile(scriptPath, 'utf8'),
  readFile(cssPath, 'utf8'),
])
const importLine = "import './style.css';\n"
if (!script.startsWith(importLine)) throw new Error('client bundle did not emit expected CSS import')
const injection = `const style=document.createElement('style');style.dataset.dshProfilePlugin='';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);\n`
await writeFile(scriptPath, injection + script.slice(importLine.length))
await rm(cssPath)
