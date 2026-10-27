import { setDemoExtras } from '@/ha/demoSource'
import { activeHomeId, homesOf, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { AMERICAN_NAME, americanEntities, americanLayout, isAmericanLayout } from './american'

/*
 * Sample homes: a full demo home with everything in it, for trying the app and for testing. Opened from the home menu
 * (ui/HomeMenus.tsx) or the test hook (window.__homescape.loadDemo). Uses only existing store actions (addHome, switchHome,
 * setLayout): the user's other homes are untouched, no migration. The sample home's entities enter the demo source only
 * while that home is open (ha/demoSource.ts > setDemoExtras); after a reload they come back if the home is open. Also works
 * on a live connection: while the home is open a separate local demo source keeps its entities alive and its commands never
 * reach the real HA (ha/store.ts > overlay), since a demo needs no Home Assistant.
 */

export type DemoName = 'american'

/** Id of the American house among the saved homes: by its plan (level ids "us-lvl"), else by its name. null if absent. */
export function findAmericanHome(): string | null {
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  if (isAmericanLayout(s.layout)) return cur
  const homes = homesOf(s)
  return homes.find((h) => h.id !== cur && isAmericanLayout(h.layout))?.id ?? homes.find((h) => h.name === AMERICAN_NAME)?.id ?? null
}

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
