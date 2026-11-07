import { setDemoExtras } from '@/ha/demoSource'
import { activeHomeId, homesOf, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { AMERICAN_NAME, LEGACY_NAME, americanEntities, americanLayout, isAmericanLayout } from './american'

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
