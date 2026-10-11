import {build} from 'esbuild'
import {cp, rm} from 'node:fs/promises'

await rm('dist', {recursive: true, force: true})

const common = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
  // an import that resolves to undefined is always a bug — stop the build
  logOverride: {'import-is-undefined': 'error'},
}

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'ffmpeg-static'],
  }),
  // sandboxed preloads must be a single CommonJS file
  build({
    ...common,
    entryPoints: ['src/main/preload.ts'],
    outfile: 'dist/preload.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/app.ts'],
    outfile: 'dist/renderer/app.js',
    platform: 'browser',
    format: 'iife',
  }),
])

await cp('src/renderer/index.html', 'dist/renderer/index.html')
await cp('src/renderer/styles.css', 'dist/renderer/styles.css')