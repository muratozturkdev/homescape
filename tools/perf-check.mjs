// Performance measurement: frames drawn while idle and while the camera rotates, main thread time, draw calls.
// `npm run dev` must be running first. Run: npm run perf
// Note: headless Chrome uses software WebGL (SwiftShader); the absolute values mean little, the before/after comparison matters.
import { chromium } from 'playwright'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

const DSF = Number(process.env.PERF_DPR ?? 2) // Imitate a Retina display
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DSF, locale: 'en-US' })
const p = await ctx.newPage()
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(2500)
const cdp = await ctx.newCDPSession(p)
await cdp.send('Performance.enable')

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const perf = () => p.evaluate(() => window.__homescape.perf())

async function measure(label, ms, action) {
  const m0 = await metrics()
  const f0 = await perf()
  const t0 = Date.now()
  if (action) await action()
  const left = ms - (Date.now() - t0)
  if (left > 0) await p.waitForTimeout(left)
  const m1 = await metrics()
  const f1 = await perf()
  const sec = (Date.now() - t0) / 1000
  const row = {
    state: label,
    'frames/s': +((f1.frames - f0.frames) / sec).toFixed(1),
    'main thread ms/s': +(((m1.TaskDuration - m0.TaskDuration) * 1000) / sec).toFixed(0),
    'script ms/s': +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / sec).toFixed(0),
    'draw calls': f1.calls,
    triangles: f1.triangles,
  }
  return row
}

const rows = []
rows.push(await measure('idle (day)', 5000))
rows.push(
  await measure('camera rotating', 4000, async () => {
    await p.mouse.move(700, 400)
    await p.mouse.down()
    for (let i = 0; i < 60; i++) await p.mouse.move(700 + Math.sin(i / 6) * 200, 400, { steps: 2 })
    await p.mouse.up()
  }),
)
rows.push(await measure('idle after rotation', 5000, () => p.waitForTimeout(1500)))
await p.evaluate(() => window.__homescape.setTheme('night'))
await p.waitForTimeout(1500)
rows.push(await measure('idle (night)', 5000))
const rotate = async () => {
  await p.mouse.move(700, 400)
  await p.mouse.down()
  for (let i = 0; i < 60; i++) await p.mouse.move(700 + Math.sin(i / 6) * 200, 400, { steps: 2 })
  await p.mouse.up()
}
await p.evaluate(() => window.__homescape.setTheme('day'))
await p.click('button[title^="Lite mode"]')
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(2500)
rows.push(await measure('lite mode: camera rotating', 4000, rotate))
rows.push(await measure('lite mode: idle', 5000, () => p.waitForTimeout(1500)))
console.table(rows)
const f = await perf()
console.log(`geometries ${f.geometries} · textures ${f.textures} · shader programs ${f.programs} · shadow updates ${f.shadowUpdates} · DPR ${DSF}`)
await b.close()
