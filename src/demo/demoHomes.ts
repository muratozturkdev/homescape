import { setDemoExtras } from '@/ha/demoSource'
import { withoutEdit } from '@/ha/planSync'
import { currentLang, inLanguage, supported, type Lang } from '@/i18n'
import { activeHomeId, homesOf, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import type { Layout } from '@/model/types'
import { AMERICAN_NAME, LEGACY_NAME, americanEntities, americanLayout, isAmericanLayout, sampleName } from './american'

/*
 * Sample homes: a full demo home with everything in it, for trying the app and for testing. Opened from the home menu
 * (ui/HomeMenus.tsx) or the test hook (window.__homescape.loadDemo). Uses only existing store actions (addHome, switchHome,
 * setLayout): the user's other homes are untouched, no migration. The sample home's entities enter the demo source only
 * while that home is open (ha/demoSource.ts > setDemoExtras); after a reload they come back if the home is open. Also works
 * on a live connection: while the home is open a separate local demo source keeps its entities alive and its commands never
 * reach the real HA (ha/store.ts > overlay), since a demo needs no Home Assistant.
 */

export type DemoName = 'american'

/**
 * Id of the American house among the saved homes, by its plan (level ids "us-lvl"); null if absent. Never by its name: a
 * home of the user's that happens to be called "Sample home" must not be mistaken for it (opening it rebuilds the plan).
 */
export function findAmericanHome(): string | null {
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  if (isAmericanLayout(s.layout)) return cur
  const homes = homesOf(s)
  return homes.find((h) => h.id !== cur && isAmericanLayout(h.layout))?.id ?? null
}

/**
 * Earlier versions called the sample home "Sample home: American house" (translated when it was created). Such homes get
 * the current name; only homes with the sample plan, and a name the user chose is left alone. The sample home is never
 * synced (ha/planSync.ts), so this stays on the device.
 */
function renameLegacy() {
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  const legacy = (name: string) => name === LEGACY_NAME || [':', ' :', '\uff1a'].some((c) => name.startsWith(AMERICAN_NAME + c))
  for (const h of homesOf(s)) {
    if (h.name !== AMERICAN_NAME && legacy(h.name) && isAmericanLayout(h.id === cur ? s.layout : h.layout)) s.renameHome(h.id, AMERICAN_NAME)
  }
}
renameLegacy()

/*
 * The sample home's names (the home, its floors, rooms and items) are made in the language of the moment it was built and
 * saved with the plan. On another language they are translated again: every name that is still the default of the language
 * it was made in gets the default of the current language; a name the user typed stays. The language is remembered in
 * SAMPLE_LANG (missing for homes built before: English is assumed). The sample home is never synced, so this stays on the
 * device.
 */
const SAMPLE_LANG = 'homescape-sample-lang'

function namedIn(code: Lang) {
  try {
    localStorage.setItem(SAMPLE_LANG, code)
  } catch {
    /* storage unavailable: translated again next time */
  }
}

function madeIn(): Lang {
  try {
    return supported(localStorage.getItem(SAMPLE_LANG)) ?? 'en'
  } catch {
    return 'en'
  }
}

/** Names of a sample plan by id: floors, rooms and items */
function namesOf(layout: Layout) {
  const names = new Map<string, string>()
  for (const level of layout.levels) {
    names.set(level.id, level.name)
    for (const r of level.rooms) names.set(r.id, r.name)
    for (const it of level.items) if (it.name) names.set(it.id, it.name)
  }
  return names
}

async function localizeSample() {
  const from = madeIn()
  const to = currentLang()
  if (from === to) return
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  const home = homesOf(s).find((h) => isAmericanLayout(h.id === cur ? s.layout : h.layout))
  if (!home) return namedIn(to)
  const old = await inLanguage(from, () => ({ names: namesOf(americanLayout()), home: sampleName() }))
  if (!old) return
  const now = namesOf(americanLayout())
  const swap = (id: string, name: string) => (old.names.get(id) === name ? (now.get(id) ?? name) : name)
  const relabel = (layout: Layout): Layout => ({
    ...layout,
    levels: layout.levels.map((level) => ({
      ...level,
      name: swap(level.id, level.name),
      rooms: level.rooms.map((r) => ({ ...r, name: swap(r.id, r.name) })),
      items: level.items.map((it) => (it.name ? { ...it, name: swap(it.id, it.name) } : it)),
    })),
  })
  // The store may have changed while the dictionary loaded: read it again
  const st = useLayout.getState()
  const active = activeHomeId(st) === home.id
  const layout = active ? st.layout : homesOf(st).find((h) => h.id === home.id)?.layout
  if (!layout || !isAmericanLayout(layout)) return
  const name = home.name === old.home ? sampleName() : home.name
  withoutEdit(() => {
    const next = relabel(layout)
    const homes = homesOf(st).map((h) => (h.id === home.id ? { ...h, name, ...(active ? {} : { layout: next }) } : h))
    useLayout.setState(active ? { layout: next, homes } : { homes })
  })
  namedIn(to)
}
void localizeSample()

/**
 * Opens the American house: creates it as a new home if missing, else switches to it; reset rebuilds the plan (changes
 * made in that home are lost, other homes stay as they are). Switches to view mode, the camera frames the whole lot.
 * Returns the home's id.
 */
export function openAmericanHome(reset = false): string {
  const L = () => useLayout.getState()
  let id = findAmericanHome()
  let fresh = false
  if (!id) {
    id = L().addHome(AMERICAN_NAME)
    fresh = true
  } else if (id !== activeHomeId(L())) L().switchHome(id)
  if (fresh || reset || !isAmericanLayout(L().layout)) {
    L().setLayout(americanLayout())
    namedIn(currentLang())
    // Keep the setup out of the undo history (undo must not return to an empty plan)
    useLayout.setState({ past: [], future: [] })
  }
  L().setMode('view')
  useView.getState().request({ kind: 'house' })
  return id
}

/** For the test hook and the menu: opens a sample home by name. */
export function openDemoHome(name: DemoName, reset = false): string {
  return name === 'american' ? openAmericanHome(reset) : ''
}

/* If the active home is the American house its entities are in the demo source, else they are removed (only on change). */
let wasAmerican: boolean | null = null
function syncExtras() {
  const us = isAmericanLayout(useLayout.getState().layout)
  if (us === wasAmerican) return
  wasAmerican = us
  setDemoExtras(us ? americanEntities() : [])
}
syncExtras()
const unsubscribe = useLayout.subscribe(syncExtras)
import.meta.hot?.dispose(() => unsubscribe())
