export interface HassEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
}

export type Entities = Record<string, HassEntity>

export interface HaArea {
  area_id: string
  name: string
  icon?: string | null
}

export interface HaRegistry {
  areas: HaArea[]
  /** Area of the entity: the entity's own area first, else its device's area */
  entityArea: Record<string, string | null>
  /** Hidden, disabled, or config/diagnostic category entities: not added to the plan automatically */
  skip: string[]
  /** Manufacturer and model of the entity's device ("Apple HomePod Mini"): tells the device type when the name does not */
  entityModel?: Record<string, string>
}

/** Home Assistant snapshot for the demo source and tests. Same shape as the live source provides. */
export interface HaSnapshot {
  capturedAt?: string
  areas: HaArea[]
  entities: (HassEntity & { area_id: string | null; device_model?: string })[]
}

/** Connection layer. Demo, live (WebSocket) and, later, the add-on (ingress) implement the same interface. */
export interface HaSource {
  kind: 'demo' | 'live'
  /** Name shown in the UI, e.g. "Demo" or "homeassistant.local" */
  label: string
  subscribe(cb: (entities: Entities) => void): () => void
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void>
  registry(): Promise<HaRegistry>
  close(): void
  /** Demo only: adds or updates an entity in the local state (tests; never touches a real home) */
  inject?(e: HassEntity): void
  /**
   * Live only: Home Assistant's per-user storage (frontend user data, where Home Assistant's own frontend keeps its
   * settings). The home plan is synced between devices here (ha/planSync.ts). subscribe reports writes from other devices;
   * it returns null when the Home Assistant version does not support it (sync then polls).
   */
  userData?: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    subscribe(key: string, cb: (value: unknown) => void): Promise<(() => void) | null>
  }
}
