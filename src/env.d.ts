/** vite.config.ts > define: target of the development proxy (HA_URL). Empty: no proxy. */
declare const __HA_PROXY_TARGET__: string

interface Window {
  /** Test and screenshot hook (tools/shot.mjs). Not used by the UI code. */
  __homescape?: {
    select: (sel: { type: 'room' | 'item'; id: string } | null) => void
    setMode: (mode: 'view' | 'edit') => void
    setTheme: (theme: 'auto' | 'day' | 'night') => void
    focusRoom: (roomId: string) => void
    planView: (on: boolean) => void
    getState: () => unknown
    camera: () => { target: number[]; azimuth: number; polar: number; distance: number } | null
    project: (x: number, y: number, z: number) => { x: number; y: number } | null
    /** Pans the camera (x right, z forward; on the ground plane) */
    cameraPan: (x: number, z: number) => void
    /** Usual framing of rooms: target, camera position (before the focal shift), focal shift */
    framePose: (rooms: import('@/model/types').Room[], pad?: number) => { target: [number, number, number]; position: [number, number, number]; focal: [number, number, number] }
    placement: () => unknown
    perf: () => Promise<Record<string, number>>
    setEntity: (e: { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed?: string }) => boolean
    roomLights: () => Promise<{ pos: number[]; range: number; type: number; color: string; rects: { x: number; z: number; w: number; d: number }[] }[]>
    /** Sun and ambient light (scene/Scene.tsx > Lights): direction to the sun, intensities, walk and indoor mix */
    lighting: () => Promise<{ sunDir: number[]; sunI: number; hemiI: number; fps: number; indoor: number }>
    /** Plan of the people at home (mode, count, rooms with motion, spots) and their current positions (scene/People.tsx) */
    people: () => Promise<unknown>
    /** Street life (scene/streetPlan.ts > streetDebug): cars, walkers, dog, kids; force('car' | 'walker' | 'dog' | 'kids' | 'leave') */
    street: () => Promise<unknown>
    /** Roof state (scene/roof.ts > roofView): whether the active floor's roof is down, roof visibility per floor */
    roof: () => Promise<{ covered: boolean; alpha: Record<string, number> }>
    /** Weather in the scene (scene/weatherState.ts): sky, preview or not, visible precipitation, wind, lightning count; values applied to the light */
    weather: () => Promise<{ sky: string; preview: boolean; rain: number; snow: number; hail: number; wind: number; windVec: [number, number]; flashes: number; drawn: boolean; light: { cloud: number; fog: number; flash: number; snow: number; wet: number } }>
    /** Weather preview (ha/weather.ts): 'rain', 'snow', 'storm'... or null (from Home Assistant) */
    weatherPreview: (sky: string | null) => Promise<void>
    /** Doors opened by walkers (scene/doorTraffic.ts): door position keys "x,z" */
    doorTraffic: () => Promise<string[]>
    /** Source that imitates a live Home Assistant connection (dev/fakeLive.ts); received service calls in fakeLiveCalls(); demo() goes back */
    fakeLive: () => Promise<boolean>
    /** Home plan sync (ha/planSync.ts): status, this device's record, last seen Home Assistant version */
    sync: () => Promise<{ status: string; at: string | null; conflict: unknown; meta: { device: string; base: string | null; sig: string | null; editedAt: string | null }; remote: { updatedAt: string; device: string; homes: number } | null }>
    /** The plan in the fake live source's Home Assistant storage (a given value is stored as if another device wrote it) */
    fakeRemote: (value?: unknown) => Promise<unknown>
    /** Settings of the fake live source: failing (reads and writes fail), user (Home Assistant user) */
    fakeUser: (patch: { failing?: boolean; user?: string }) => Promise<void>
    /** Plan backups in the fake live source */
    fakeBackups: () => Promise<unknown>
    fakeLiveCalls: () => Promise<{ domain: string; service: string; data: Record<string, unknown> }[]>
    demo: () => Promise<void>
    /** Ray in the scene: height, distance and item of the first visible hit (dev/sceneProbe.ts) */
    pick: (x: number, y: number, z: number, dx: number, dy: number, dz: number) => Promise<{ y: number; distance: number; itemId: string | null } | null>
    /** The item's group in the scene: its id (changes when rebuilt), world height, visible or not */
    itemObject: (id: string) => Promise<{ uuid: string; y: number; visible: boolean } | null>
    /** Open state of cabinets (scene/bins.ts): cabinet id -> open */
    bins: () => Promise<Record<string, boolean>>
    /** Flight between homes (scene/HomeFlight.tsx): stage, number of finished flights, measurements of the last one */
    homeFlight: () => Promise<{
      stage: 'idle' | 'out' | 'cruise' | 'in'
      runs: number
      last: null | { homeBefore: string; homeAfter: string; startD: number; peakD: number; endD: number; oldInView: boolean; newInView: boolean; switchMs: number; totalMs: number; dir: number }
    }>
    /** Pets and outdoor visitors (scene/petsDebug.ts): positions, tasks; test commands (forceVisitor, command, poke, setHour) */
    pets: () => Promise<unknown>
    /** Sound (audio/engine.ts): state, playing loops, recent short sounds, output level; unlock; measure a sound offline; play a short sound */
    sound: () => Promise<unknown>
    soundUnlock: () => Promise<void>
    soundMeasure: (kind: 'voice' | 'shot', name: string, opt?: { p?: number; v?: string; seconds?: number }) => Promise<{ rms: number; peak: number; nan: boolean; dur: number }>
    /** Plays the night sounds (owl, distant dog) right away */
    soundNight: () => Promise<void>
    soundPlay: (name: string, at?: { x: number; y?: number; z: number } | null, opt?: { v?: string; gain?: number }) => Promise<boolean>
    /** Current state of an entity (demo or live) */
    entity: (id: string) => unknown
    entityIds: () => string[]
    /** First-person walk: position, foot height and view (scene/FpsControls.tsx); teleport to move (tests) */
    fps: () => Promise<{ x: number; z: number; h: number; yaw: number; pitch: number }>
    fpsTeleport: (x: number, z: number, yaw?: number, pitch?: number) => Promise<void>
    /** Opens the sample home (src/demo/demoHomes.ts): sets it up as a new home if missing, otherwise switches to it; reset sets the plan up again. Returns the home's id. */
    loadDemo: (name: 'american', reset?: boolean) => string
    /** Test: Home Assistant service call on the demo source (applied locally); on a live connection it does not call and returns false */
    call: (domain: string, service: string, data: Record<string, unknown>) => Promise<boolean>
  }
}
