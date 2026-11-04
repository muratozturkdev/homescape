// Weather regression test (ha/weather.ts, scene/Weather.tsx, ui/WeatherTile.tsx): the weather in the scene follows the weather
// entity in Home Assistant (rain, snow, storm and lightning, fog, wind), the "Weather" tile at the top, preview, entity choice, sound.
// `npm run dev` must be running first. Run: npm run check:weather  (all at once: npm run check)
// Intermediate screenshots: shots/weather-*.png
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
// Daytime (at night the people and the sky differ)
await p.clock.setFixedTime(new Date('2026-10-27T13:00:00'))
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1500)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const weather = () => p.evaluate(() => window.__homescape.weather())
const lighting = () => p.evaluate(() => window.__homescape.lighting())
const snd = () => p.evaluate(() => window.__homescape.sound())
const shot = (name) => p.screenshot({ path: `shots/weather-${name}.png` })
const tile = () => p.locator('#kpi-weather').innerText()
const setWeather = (id, state, attributes = {}) =>
  p.evaluate(
    ([id, state, attributes]) =>
      window.__homescape.setEntity({ entity_id: id, state, attributes: { friendly_name: id, temperature_unit: '°C', wind_speed_unit: 'km/h', ...attributes } }),
    [id, state, attributes],
  )

// --- With no weather entity in HA: clear sky, no precipitation; the tile invites a preview ---
{
  const ids = await p.evaluate(() => window.__homescape.entityIds().filter((i) => i.startsWith('weather.')))
  const w = await weather()
  ok(ids.length === 0 && w.sky === 'clear' && !w.preview && !w.drawn && w.rain === 0, `The sample home has no weather entity: the scene is clear, no precipitation is drawn (${w.sky})`)
  const t = await tile()
  ok(/Weather/.test(t) && /-/.test(t) && /no entity/.test(t), `The "Weather" tile shows "-" instead of a value and "no entity in HA, preview" (${t.replace(/\n/g, ' | ')})`)
}
const clear = await lighting()

// Turn the sound on (for the rain sound and the thunder)
await p.click('#sound-toggle')
await p.waitForTimeout(600)
await p.mouse.click(800, 500)
await p.waitForTimeout(400)

// --- HA's weather is rainy: rain in the scene, the sun dims, the sky greys, the ground gets wet; temperature on the tile; rain sound ---
{
  ok(await setWeather('weather.home', 'rainy', { temperature: 12.4, wind_speed: 8 }), 'A HA weather entity is written in demo mode (weather.home: rainy)')
  await p.waitForTimeout(4500)
  const w = await weather()
  const l = await lighting()
  ok(w.sky === 'rain' && !w.preview && w.drawn && w.rain > 500 && w.snow === 0, `When HA says "rainy", it rains in the scene (${w.rain} drops)`)
  ok(w.light.cloud > 0.6 && l.sunI < clear.sunI * 0.6, `Clouds dim the sun (sun ${clear.sunI.toFixed(2)} -> ${l.sunI.toFixed(2)})`)
  ok(w.light.wet > 0.05, `The ground gets wet in the rain (${w.light.wet.toFixed(2)})`)
  const t = await tile()
  ok(/12°C/.test(t) && /Rainy/.test(t), `HA's temperature and condition on the tile (${t.replace(/\n/g, ' | ')})`)
  const s = await snd()
  ok(s.wanted.some((x) => x.voice === 'rain'), 'The rain sound follows the same weather')
  await shot('rain')
}

// --- Snow: snowflakes, the rain stops; a snow cover starts to build up ---
{
  await setWeather('weather.home', 'snowy', { temperature: -2 })
  await p.waitForTimeout(3000)
  const a = await weather()
  await p.waitForTimeout(3000)
  const c = await weather()
  ok(c.sky === 'snow' && c.snow > 500 && c.rain === 0, `HA "snowy": it snows, the rain stopped (${c.snow} flakes)`)
  ok(c.light.snow > a.light.snow && c.light.snow > 0.02, `The snow cover builds up (${a.light.snow.toFixed(3)} -> ${c.light.snow.toFixed(3)})`)
  const s = await snd()
  ok(!s.wanted.some((x) => x.voice === 'rain'), 'No rain sound in the snow')
  await shot('snow')
}

// --- Storm: heavy rain, wind, lightning and a little later thunder ---
{
  await setWeather('weather.home', 'lightning-rainy', { temperature: 16, wind_speed: 20 })
  const t0 = await p.evaluate(() => Math.round(performance.now()))
  let w = await weather()
  const f0 = w.flashes
  let peak = 0
  for (let i = 0; i < 200 && w.flashes === f0; i++) {
    await p.waitForTimeout(80)
    w = await weather()
    peak = Math.max(peak, w.light.flash)
  }
  ok(w.sky === 'storm' && w.rain > 1000 && w.wind >= 0.6, `HA "lightning-rainy": storm, heavy rain, wind (${w.rain} drops, wind ${w.wind})`)
  ok(w.flashes > f0, `Lightning strikes (${w.flashes - f0} times, within ${((await p.evaluate(() => performance.now())) - t0) / 1000 | 0} s)`)
  for (let i = 0; i < 8; i++) {
    peak = Math.max(peak, (await weather()).light.flash)
    await p.waitForTimeout(40)
  }
  ok(peak > 0.3, `The scene flashes bright for a moment at the lightning (peak ${peak.toFixed(2)})`)
  await p.waitForTimeout(2600)
  const thunder = (await snd()).log.filter((e) => e.name === 'thunder' && e.at >= t0)
  ok(thunder.length >= 1, `Thunder plays after the lightning (${thunder.length})`)
  await shot('storm')
}

// --- Fog: the fog closes in; wind: HA's wind speed tilts the precipitation ---
{
  await setWeather('weather.home', 'fog', { temperature: 9 })
  await p.waitForTimeout(5000)
  const l = await lighting()
  const w = await weather()
  ok(w.sky === 'fog' && !w.drawn && l.fog[1] < clear.fog[1] * 0.6, `HA "fog": the fog closes in (far limit ${clear.fog[1] | 0} -> ${l.fog[1] | 0} m), no precipitation`)
  await shot('fog')
  await setWeather('weather.home', 'rainy', { temperature: 10, wind_speed: 60 })
  await p.waitForTimeout(800)
  ok((await weather()).wind === 1, 'HA wind speed 60 km/h: the rain tilts fully')
  // Wind from the north (wind_bearing 0): the precipitation drifts toward the south of the plan (the plan's north is Layout.up)
  await setWeather('weather.home', 'rainy', { temperature: 10, wind_speed: 30, wind_bearing: 0 })
  await p.waitForTimeout(800)
  const up = await p.evaluate(() => window.__homescape.getState().layout.layout.up ?? 0)
  const v = (await weather()).windVec
  const want = [-Math.sin((-up * Math.PI) / 180), Math.cos((-up * Math.PI) / 180)]
  const len = Math.hypot(v[0], v[1])
  ok(len > 1 && Math.abs(v[0] / len - want[0]) < 0.05 && Math.abs(v[1] / len - want[1]) < 0.05, `HA's wind direction (from the north) tilts the precipitation south (${v.map((n) => n.toFixed(2)).join(', ')})`)
  // HA's cloud coverage: cloudy but a sky 20% covered darkens only a little
  await setWeather('weather.home', 'cloudy', { temperature: 14, cloud_coverage: 20 })
  await p.waitForTimeout(5000)
  const c = (await weather()).light.cloud
  ok(c < 0.3, `HA cloud coverage 20%: the sky is barely overcast (${c.toFixed(2)}; cloudy without a coverage value is 0.75)`)
  await setWeather('weather.home', 'fog', { temperature: 9 })
  await p.waitForTimeout(500)
}

// --- Preview: a weather independent of HA is picked from the tile; Automatic returns to HA ---
{
  await p.click('#kpi-weather')
  await p.waitForSelector('[data-weather-picker]')
  ok((await p.$$('[data-weather-sky]')).length === 13, 'Clicking the tile shows Automatic and 12 weather options')
  await p.click('[data-weather-sky="hail"]')
  await p.waitForTimeout(1500)
  let w = await weather()
  ok(w.preview && w.sky === 'hail' && w.hail > 200, `Hail falls in the preview (${w.hail} pieces), HA's weather did not change (${(await p.evaluate(() => window.__homescape.entity('weather.home').state))})`)
  ok(/preview/.test(await tile()), 'The tile says it is in preview')
  await shot('preview')
  await p.click('[data-weather-sky="auto"]')
  await p.waitForTimeout(800)
  w = await weather()
  ok(!w.preview && w.sky === 'fog', `Automatic: the scene is back on HA's weather (${w.sky})`)
  await p.mouse.click(800, 600)
  await p.waitForTimeout(300)
  ok(!(await p.$('[data-weather-picker]')), 'Clicking outside closes the picker')
}

// --- Several weather entities: the chosen one is used ---
{
  await setWeather('weather.forecast_cottage', 'snowy', { temperature: -5 })
  await p.waitForTimeout(500)
  await p.click('#kpi-weather')
  await p.waitForSelector('[data-weather-picker]')
  ok((await p.$$('[data-weather-entity]')).length === 2, 'With two weather entities, both are listed in the picker')
  await p.click('[data-weather-entity="weather.forecast_cottage"]')
  await p.waitForTimeout(1200)
  const w = await weather()
  const pick = await p.evaluate(() => localStorage.getItem('homescape-weather-entity'))
  ok(w.sky === 'snow' && pick === 'weather.forecast_cottage', `The chosen entity's weather is in the scene (${w.sky}), the choice persists`)
  await p.click('[data-weather-entity="weather.forecast_cottage"]')
  await p.waitForTimeout(800)
  ok((await weather()).sky === 'fog', 'When the choice is cleared, the automatically chosen entity is used (weather.home)')
  await p.mouse.click(800, 600)
}

// --- Lite mode: precipitation is not drawn ---
{
  await setWeather('weather.home', 'pouring', { temperature: 11 })
  await p.waitForTimeout(1500)
  ok((await weather()).drawn, 'Precipitation is drawn in a downpour')
  await p.click('button[title^="Lite mode"]')
  await p.waitForSelector('body[data-ready="1"]')
  await p.waitForTimeout(1500)
  const w = await weather()
  ok(!w.drawn && w.rain === 0 && w.sky === 'pour', 'Precipitation is not drawn in lite mode (clouds and fog stay)')
  await p.click('button[title^="Lite mode"]')
  await p.waitForTimeout(1000)
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
