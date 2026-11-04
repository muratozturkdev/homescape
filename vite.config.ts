import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

/**
 * Development: writes the active plan of a browser to a local file (.homescape-dump/plan-<browser>.json; ignored by git),
 * to read the plan from your own browser while debugging. The data never leaves the machine; it runs only in the dev
 * server (src/dev/planDump.ts sends it).
 */
function planDump(): Plugin {
  return {
    name: 'homescape-plan-dump',
    apply: 'serve',
    configureServer(server) {
      server.ws.on('homescape:plan', (data: { browser?: string }) => {
        try {
          const name = String(data?.browser ?? 'browser').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'browser'
          mkdirSync('.homescape-dump', { recursive: true })
          writeFileSync(`.homescape-dump/plan-${name}.json`, JSON.stringify(data, null, 1))
        } catch {
          /* could not write */
        }
      })
    },
  }
}

/*
 * With HA_URL (.env.local) the dev server proxies Home Assistant: the browser sees everything on one origin, so no CORS
 * setup is needed and Home Assistant's own login page (OAuth) works through this address.
 */
const HA_PATHS = ['/api', '/auth', '/frontend_latest', '/frontend_es5', '/static', '/manifest.json', '/sw-modern.js']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.HA_URL?.replace(/\/$/, '') ?? ''
  const proxy: Record<string, ProxyOptions> | undefined = target
    ? Object.fromEntries(HA_PATHS.map((p) => [p, { target, changeOrigin: true, ws: p === '/api' }]))
    : undefined

  return {
    // Relative paths: so it also works under the sub path of the Home Assistant app (ingress).
    base: './',
    plugins: [react(), tailwindcss(), planDump()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { __HA_PROXY_TARGET__: JSON.stringify(target) },
    server: { port: 5190, strictPort: true, proxy },
    preview: { port: 5190, strictPort: true, proxy },
  }
})
