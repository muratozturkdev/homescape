import { create } from 'zustand'
import { DEMO_SNAPSHOT } from '@/demo/snapshot'
import { t } from '@/i18n'
import { createDemoSource, hasDemoExtras, isDemoExtra, onDemoExtras } from './demoSource'
import { servedByHomeAssistant } from './embed'
import { clearSavedTokens, connectEmbedded, connectLive, hasSavedTokens, isAuthCallback } from './liveSource'
import type { Entities, HaRegistry, HaSource } from './types'

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface ConnSettings {
  mode: 'demo' | 'live'
  hassUrl: string
  /** Long-lived token, kept only when the user chooses "remember in this browser" */
  token: string | null
}

const SETTINGS_KEY = 'homescape-connection'
/** With the development proxy, Home Assistant is reachable on the same origin. */
export const PROXY_TARGET = __HA_PROXY_TARGET__
/** Served by Home Assistant itself (/local or ingress), Home Assistant is this origin and the default is to connect to it */
const DEFAULTS: ConnSettings = servedByHomeAssistant()
  ? { mode: 'live', hassUrl: location.origin, token: null }
  : { mode: 'demo', hassUrl: PROXY_TARGET ? location.origin : '', token: null }

function readSettings(): ConnSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ConnSettings>) }
  } catch {
    /* storage unavailable */
  }
  return DEFAULTS
}

function writeSettings(s: ConnSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

interface HaState {
  status: ConnStatus
  error: string | null
  source: HaSource | null
  entities: Entities
  registry: HaRegistry | null
  settings: ConnSettings
  /** Short-lived notice (service error etc.) */
  notice: string | null
  /** Shown inside the Home Assistant frontend, on its connection (ha/embed.ts): no sign-in, no connection settings */
  embedded: boolean

  boot: () => Promise<void>
  connectDemo: () => Promise<void>
  connectLive: (hassUrl: string, token?: string | null, remember?: boolean) => Promise<void>
  disconnect: () => Promise<void>
  call: (domain: string, service: string, data: Record<string, unknown>) => Promise<void>
  clearNotice: () => void
  /** Attaches a source (demo, live, or a fake live source for tests) */
  attach: (source: HaSource) => Promise<void>
}

let unsubscribe: (() => void) | null = null

/*
 * Local simulation of the sample home: its objects can be toggled by clicking without linking anything to Home Assistant.
 * While connected to a live Home Assistant, the sample home's entities (us_) do not exist in the real home; while that home
 * is open, a separate demo source (ha/demoSource.ts) keeps them alive. They are merged with the live entities (the sample
 * home's first, so the first alarm and weather are its own), and commands to them never reach the real Home Assistant:
 * they are applied locally. Not needed on the demo connection (the demo source already carries them).
 */
let overlay: { source: HaSource; entities: Entities; off: () => void } | null = null
let mainEntities: Entities = {}

/** Is it a locally simulated entity of the sample home (demo or live connection)? In view mode a click toggles it directly */
export function isSimulated(entityId: string) {
  return isDemoExtra(entityId) && (useHa.getState().source?.kind === 'demo' || Boolean(overlay?.entities[entityId]))
}

function errorText(err: unknown) {
  if (err === 1) return t('Could not connect (the Home Assistant address is unreachable).')
  if (err === 2) return t('Authentication failed. Sign in again or check the token.')
  if (err === 3) return t('Connection lost.')
  if (err === 4) return t('The Home Assistant address is required.')
  if (err instanceof Error) return err.message
  return t('Unknown error.')
}

export const useHa = create<HaState>()((set, get) => {
  const merge = () => set({ entities: overlay ? { ...overlay.entities, ...mainEntities } : mainEntities })
  /** On a live source, sets up the local simulation layer while the sample home is open, otherwise removes it */
  const syncOverlay = () => {
    const need = get().source?.kind === 'live' && hasDemoExtras()
    if (need && !overlay) {
      const source = createDemoSource({ areas: [], entities: [] })
      overlay = { source, entities: {}, off: () => {} }
      const o = overlay
      o.off = source.subscribe((e) => {
        o.entities = e
        merge()
      })
    } else if (!need && overlay) {
      overlay.off()
      overlay.source.close()
      overlay = null
      merge()
    }
  }
  onDemoExtras(syncOverlay)
  const attach = async (source: HaSource) => {
    unsubscribe?.()
    get().source?.close()
    mainEntities = {}
    set({ source, status: 'connected', error: null, entities: {} })
    unsubscribe = source.subscribe((entities) => {
      mainEntities = entities
      merge()
    })
    syncOverlay()
    try {
      set({ registry: await source.registry() })
    } catch {
      // Non-admin users may not be able to read the registry; the plan still works.
      set({ registry: null, notice: t('Could not read the area list; you can match rooms by hand.') })
    }
  }

  return {
    status: 'idle',
    error: null,
    source: null,
    entities: {},
    registry: null,
    settings: readSettings(),
    notice: null,
    embedded: false,

    boot: async () => {
      // Inside Home Assistant: the frontend's own connection (falls back to the usual ways if it fails)
      try {
        set({ status: 'connecting', error: null })
        const host = await connectEmbedded()
        if (host) {
          set({ embedded: true })
          return await attach(host)
        }
      } catch {
        set({ embedded: false })
      }
      const s = get().settings
      if (isAuthCallback()) return get().connectLive(s.hassUrl || location.origin)
      if (s.mode === 'live' && s.hassUrl && (s.token || hasSavedTokens())) return get().connectLive(s.hassUrl, s.token)
      // Opened from Home Assistant's own address: sign in through Home Assistant there
      if (servedByHomeAssistant() && s.mode === 'live') return get().connectLive(s.hassUrl || location.origin)
      return get().connectDemo()
    },

    connectDemo: async () => {
      await attach(createDemoSource(DEMO_SNAPSHOT))
      const settings = { ...get().settings, mode: 'demo' as const }
      writeSettings(settings)
      set({ settings })
    },

    connectLive: async (hassUrl, token, remember = false) => {
      set({ status: 'connecting', error: null })
      const settings: ConnSettings = { mode: 'live', hassUrl, token: token && remember ? token : null }
      writeSettings(settings)
      set({ settings })
      try {
        await attach(await connectLive({ hassUrl, token: token ?? undefined }))
      } catch (err) {
        set({ status: 'error', error: errorText(err) })
      }
    },

    disconnect: async () => {
      clearSavedTokens()
      const settings = { ...get().settings, mode: 'demo' as const, token: null }
      writeSettings(settings)
      set({ settings })
      await get().connectDemo()
    },

    call: async (domain, service, data) => {
      // The sample home's entities are local (never sent to the real Home Assistant)
      const ids = Array.isArray(data.entity_id) ? (data.entity_id as string[]) : typeof data.entity_id === 'string' ? [data.entity_id] : []
      const source = overlay && ids.length && ids.every((id) => overlay!.entities[id]) ? overlay.source : get().source
      if (!source) return
      try {
        await source.callService(domain, service, data)
      } catch (err) {
        set({ notice: t('Could not send the command: {error}', { error: errorText(err) }) })
      }
    },

    clearNotice: () => set({ notice: null }),
    attach,
  }
})
