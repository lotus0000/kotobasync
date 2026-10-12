import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const out = 'dist'
if (existsSync(out)) rmSync(out, { recursive: true })
mkdirSync(out)

// Default server baked into the build: KOTOBA_SERVER=https://kotoba.example.com npm run build -w extension
const server = new URL(process.env.KOTOBA_SERVER ?? 'http://localhost:8900').origin
const common = {
  bundle: true,
  target: 'chrome120',
  legalComments: 'none',
  logLevel: 'warning',
  define: { __KOTOBA_SERVER__: JSON.stringify(server) },
}
await build({ ...common, entryPoints: ['src/guard-entry.ts'], outfile: `${out}/guard.js`, format: 'iife' })
await build({ ...common, entryPoints: ['src/content.ts'], outfile: `${out}/content.js`, format: 'iife' })
await build({ ...common, entryPoints: ['src/background.ts'], outfile: `${out}/background.js`, format: 'esm' })
await build({ ...common, entryPoints: ['src/options.ts'], outfile: `${out}/options.js`, format: 'esm' })
cpSync('static', out, { recursive: true })
const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'))
manifest.host_permissions.push(`${server}/*`)
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
// Personal builds only (never committed): KOTOBA_PRESET=/path/to/preset.json bakes server + Access token in.
if (process.env.KOTOBA_PRESET) cpSync(process.env.KOTOBA_PRESET, `${out}/preset.json`)
console.log(`built extension/dist (server ${server})`)
