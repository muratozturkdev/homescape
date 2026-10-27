import { useSync } from '@/ha/planSync'
import { useHa } from '@/ha/store'
import { activeHomeId, homesOf, useLayout } from '@/model/layoutStore'

/*
 * Development: sends the active plan to the dev server, which writes it to .homescape-dump/plan-<browser>.json
 * (vite.config.ts > planDump), so the plan in the developer's own browser can be read while debugging. Sends on start, when
 * the plan changes (after 2 s) and when the plan sync status changes. A device opening the app over the network (iPad)
 * writes a separate file (`-lan`) so the same browser family does not overwrite the computer's. The headless browser of the
 * tests does not send.
 */

const ua = navigator.userAgent
const headless = /HeadlessChrome/.test(ua) || navigator.webdriver
const where = /^(localhost|127\.|\[::1\])/.test(location.hostname) ? '' : '-lan'
const family = /Edg\//.test(ua) ? 'edge' : /Electron/.test(ua) ? 'electron' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other'

if (import.meta.hot && !headless) {
  const hot = import.meta.hot
  let t: ReturnType<typeof setTimeout> | undefined
  const send = () => {
    const s = useLayout.getState()
    const src = useHa.getState().source
    const sync = useSync.getState()
    hot.send('homescape:plan', {
      browser: `${family}-${src?.kind ?? 'none'}${where}`,
      at: new Date().toISOString(),
      host: location.host,
      homeId: activeHomeId(s),
      homes: homesOf(s).map((h) => h.name),
      sync: { status: sync.status, at: sync.at, conflict: Boolean(sync.conflict) },
      levelId: s.levelId,
      layout: s.layout,
    })
  }
  setTimeout(send, 2500)
  useLayout.subscribe((s, p) => {
    if (s.layout === p.layout) return
    clearTimeout(t)
    t = setTimeout(send, 2000)
  })
  useSync.subscribe((s, p) => {
    if (s.status === p.status && s.conflict === p.conflict) return
    clearTimeout(t)
    t = setTimeout(send, 500)
  })
}
