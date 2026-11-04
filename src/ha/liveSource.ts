import {
  callService,
  createConnection,
  createLongLivedTokenAuth,
  ERR_INVALID_AUTH,
  getAuth,
  subscribeEntities,
  type AuthData,
  type Connection,
} from 'home-assistant-js-websocket'
import { t } from '@/i18n'
import { hostConnection, servedByHomeAssistant } from './embed'
import type { Entities, HaArea, HaRegistry, HaSource } from './types'

/*
 * Live source: the Home Assistant WebSocket API.
 * Two ways to sign in: Home Assistant's own login page (OAuth, recommended) or a
 * long-lived token the user created. The code never sees a password.
 */

const TOKENS_KEY = 'homescape-auth'

/**
 * Served by Home Assistant itself, the Home Assistant frontend's own tokens (same origin, same OAuth client id) are reused,
 * so a user who is signed in to Home Assistant in this browser does not sign in again.
 */
const HA_FRONTEND_TOKENS_KEY = 'hassTokens'

function loadTokens(): Promise<AuthData | null | undefined> {
  try {
    const raw = localStorage.getItem(TOKENS_KEY) ?? (servedByHomeAssistant() ? localStorage.getItem(HA_FRONTEND_TOKENS_KEY) : null)
    return Promise.resolve(raw ? (JSON.parse(raw) as AuthData) : undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}

function saveTokens(data: AuthData | null) {
  try {
    if (data) localStorage.setItem(TOKENS_KEY, JSON.stringify(data))
    else localStorage.removeItem(TOKENS_KEY)
  } catch {
    /* storage unavailable: sign-in is asked again on every start */
  }
}

export function clearSavedTokens() {
  saveTokens(null)
}

export function hasSavedTokens() {
  try {
    return Boolean(localStorage.getItem(TOKENS_KEY))
  } catch {
    return false
  }
}

export function isAuthCallback() {
  return new URLSearchParams(location.search).has('auth_callback')
}

interface RegEntity {
  entity_id: string
  area_id: string | null
  device_id: string | null
  hidden_by: string | null
  disabled_by: string | null
  entity_category: string | null
}

export async function connectLive(opts: { hassUrl: string; token?: string }): Promise<HaSource> {
  const hassUrl = opts.hassUrl.replace(/\/$/, '')
  const auth = opts.token
    ? createLongLivedTokenAuth(hassUrl, opts.token)
    : await getAuth({ hassUrl, saveTokens, loadTokens }) // without a session, redirects to Home Assistant's login page

  if (isAuthCallback()) history.replaceState(null, '', location.pathname)

  let conn
  try {
    conn = await createConnection({ auth })
  } catch (err) {
    if (err === ERR_INVALID_AUTH) clearSavedTokens()
    throw err
  }

  return sourceFromConnection(conn, hostLabel(hassUrl), true)
}

const hostLabel = (hassUrl: string) => {
  try {
    return new URL(hassUrl).host
  } catch {
    return hassUrl
  }
}

/**
 * Inside the Home Assistant frontend (app panel or Webpage dashboard, ha/embed.ts): uses the frontend's own connection,
 * so there is no sign-in. Returns null when Homescape is not shown inside Home Assistant.
 */
export async function connectEmbedded(): Promise<HaSource | null> {
  const host = hostConnection()
  if (!host) return null
  const { auth, conn } = await host
  return sourceFromConnection(conn, `${t('Home Assistant')} · ${hostLabel(auth.data.hassUrl)}`, false)
}

/** A source on an open connection; `owned` connections are closed with the source (the frontend's own one is not) */
function sourceFromConnection(conn: Connection, label: string, owned: boolean): HaSource {
  return {
    kind: 'live',
    label,
    subscribe(cb) {
      return subscribeEntities(conn, (ents) => cb(ents as unknown as Entities))
    },
    async callService(domain, service, data) {
      await callService(conn, domain, service, data)
    },
    async registry(): Promise<HaRegistry> {
      const [areas, ents, devices] = await Promise.all([
        conn.sendMessagePromise<HaArea[]>({ type: 'config/area_registry/list' }),
        conn.sendMessagePromise<RegEntity[]>({ type: 'config/entity_registry/list' }),
        conn.sendMessagePromise<{ id: string; area_id: string | null; manufacturer?: string | null; model?: string | null }[]>({ type: 'config/device_registry/list' }),
      ])
      const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]))
      const deviceModel = new Map(devices.filter((d) => d.model).map((d) => [d.id, [d.manufacturer, d.model].filter(Boolean).join(' ')]))
      return {
        areas: areas.map(({ area_id, name, icon }) => ({ area_id, name, icon })),
        entityArea: Object.fromEntries(ents.map((e) => [e.entity_id, e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) ?? null : null)])),
        skip: ents.filter((e) => e.hidden_by || e.disabled_by || e.entity_category).map((e) => e.entity_id),
        entityModel: Object.fromEntries(ents.flatMap((e) => (e.device_id && deviceModel.has(e.device_id) ? [[e.entity_id, deviceModel.get(e.device_id)!]] : []))),
      }
    },
    userData: {
      async get(key) {
        const r = await conn.sendMessagePromise<{ value?: unknown } | null>({ type: 'frontend/get_user_data', key })
        return r?.value ?? null
      },
      async set(key, value) {
        await conn.sendMessagePromise({ type: 'frontend/set_user_data', key, value })
      },
      async owner() {
        try {
          const user = await conn.sendMessagePromise<{ id?: string } | null>({ type: 'auth/current_user' })
          return user?.id ?? null
        } catch {
          return null
        }
      },
      async subscribe(key, cb) {
        try {
          const off = await conn.subscribeMessage<{ value?: unknown } | null>((m) => cb(m?.value ?? null), { type: 'frontend/subscribe_user_data', key })
          return () => void off().catch(() => {})
        } catch {
          return null
        }
      },
    },
    close() {
      if (owned) conn.close()
    },
  }
}
