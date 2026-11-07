/*
 * House plan data model. Units are meters; x to the right, z to the front (toward the camera), y up.
 * Rooms are axis-aligned rectangles: (x, z) the back-left corner, w the width (x), d the depth (z).
 */

/**
 * Floor. Outdoor floors model the area outside, like the front of the house: road (asphalt, markings along the long side),
 * sidewalk (paving stones, a curb on the edge facing the road and the grass), crosswalk, parking (bay lines), gravel,
 * water (a pond: below the ground, stone rim, drifting glints).
 */
export type FloorMaterial = 'wood' | 'tile' | 'carpet' | 'concrete' | 'grass' | 'deck' | 'paving' | 'road' | 'sidewalk' | 'crosswalk' | 'parking' | 'gravel' | 'water'

/**
 * Room type, for homes with a garden, a balcony or several floors: room (default) and garage have walls; balcony and
 * terrace are outdoor with railings along their edges; garden is outdoor without walls. A room next to an outdoor space
 * draws that wall at full thickness like an exterior wall (geometry.ts > wallRuns).
 */
export type RoomType = 'room' | 'garage' | 'balcony' | 'terrace' | 'garden'

/** Axis-aligned rectangle: (x, z) the back-left corner, w the width (x), d the depth (z). */
export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

/**
 * Room: the main rectangle (x, z, w, d) plus optional extra parts. L, T and U shaped rooms and hallways are built from
 * several parts; there is no wall where parts meet (geometry.ts > wallRuns).
 */
export interface Room extends Rect {
  id: string
  name: string
  floor: FloorMaterial
  /** Linked Home Assistant area (area_id); room temperature and humidity are computed from it */
  areaId?: string | null
  /** Extra rectangular parts (for L, T, U shapes) */
  parts?: Rect[]
  /** Room type; 'room' when not given (indoor with walls) */
  type?: RoomType
}

export type ItemKind =
  // lights
  | 'pendant'
  | 'floorLamp'
  | 'deskLamp'
  | 'wallLight'
  | 'ledStrip'
  | 'mirrorLight'
  | 'downlight'
  | 'ceilingStrip'
  // devices
  | 'tv'
  | 'console'
  | 'monitor'
  | 'acUnit'
  | 'radiator'
  | 'boiler'
  | 'diffuser'
  | 'fan'
  | 'ceilingFan'
  | 'ceilingLight'
  | 'trackLight'
  | 'tableLamp'
  | 'thermostat'
  | 'airPurifier'
  | 'humidifier'
  | 'dehumidifier'
  | 'heater'
  | 'waterHeater'
  | 'fireplace'
  | 'acOutdoor'
  | 'towelWarmer'
  | 'speaker'
  | 'soundbar'
  | 'projector'
  | 'projectorScreen'
  | 'computer'
  | 'doorbell'
  | 'smokeDetector'
  | 'siren'
  | 'leakSensor'
  | 'airQuality'
  | 'smartButton'
  | 'wallPanel'
  | 'router'
  | 'nas'
  | 'printer'
  | 'petFeeder'
  | 'powerMeter'
  | 'coffeeMachine'
  | 'kettle'
  | 'microwave'
  | 'airFryer'
  | 'waterValve'
  | 'homeBattery'
  | 'tree'
  | 'bush'
  | 'flowerBed'
  | 'gardenLight'
  | 'stringLights'
  | 'sprinkler'
  | 'lawnMower'
  | 'grill'
  | 'parasol'
  | 'lounger'
  | 'outdoorTable'
  | 'pool'
  | 'hotTub'
  | 'gate'
  | 'fence'
  | 'mailbox'
  | 'solarPanel'
  | 'weatherStation'
  | 'swing'
  | 'clothesRack'
  | 'awning'
  | 'car'
  | 'evCharger'
  | 'bicycle'
  | 'motorcycle'
  | 'workbench'
  | 'toolWall'
  | 'storageRack'
  | 'stairs'
  | 'garageDoor'
  // front of the house and street (kit/street.tsx)
  | 'streetLamp'
  | 'bench'
  | 'streetBin'
  | 'wheelieBin'
  | 'recycleBins'
  | 'hydrant'
  | 'trafficSign'
  | 'bollard'
  | 'bikeRack'
  | 'busStop'
  | 'steppingStones'
  | 'rock'
  | 'planter'
  | 'pergola'
  | 'fountain'
  | 'birdBath'
  | 'slide'
  | 'trampoline'
  | 'sandbox'
  | 'streetTree'
  | 'utilityPole'
  | 'outdoorShower'
  | 'manhole'
  | 'speedBump'
  | 'trafficCone'
  | 'gardenShed'
  | 'picnicTable'
  | 'plug'
  | 'powerStrip'
  | 'wallSwitch'
  | 'camera'
  | 'robotVacuum'
  | 'alarmPanel'
  // sensors
  | 'motionSensor'
  | 'tempSensor'
  | 'vibrationSensor'
  // structure
  | 'door'
  | 'window'
  // furniture
  | 'sofa'
  | 'armchair'
  | 'coffeeTable'
  | 'roundTable'
  | 'rug'
  | 'doormat'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'desk'
  | 'chair'
  | 'gamingChair'
  | 'diningTable'
  | 'kitchenCounter'
  | 'tvUnit'
  | 'fridge'
  | 'stove'
  | 'sink'
  | 'bathtub'
  | 'toilet'
  | 'washbasin'
  | 'shoeCabinet'
  | 'bookshelf'
  | 'plant'
  | 'drawerUnit'
  | 'wardrobeSingle'
  | 'dresser'
  | 'mirrorCabinet'
  | 'laundryBasket'
  | 'trashBin'
  // appliances
  | 'washer'
  | 'dryer'
  | 'dishwasher'
  | 'oven'
  | 'waterDispenser'
  // small devices
  | 'wallFan'
  | 'deskFan'
  | 'homepod'
  | 'deskCamera'
  | 'stickVacuum'
  | 'shower'
  // desk and decor
  | 'keyboard'
  | 'mouse'
  | 'mousePad'
  | 'monitorV'
  | 'deskPlant'
  | 'deskPalm'
  | 'pegboard'
  | 'painting'
  | 'aquarium'
  | 'fishbowl'
  | 'mirror'
  | 'soapDispenser'
  // pets (cats and dogs in the house) and their things
  | 'cat'
  | 'dog'
  | 'catBed'
  | 'dogBed'
  | 'petBowl'
  | 'litterBox'
  | 'catTree'
  | 'dogHouse'
  | 'petToy'

export interface Item {
  id: string
  kind: ItemKind
  x: number
  z: number
  /** Height above the floor (like a monitor on a desk). Wall items give their own height. */
  y?: number
  /** Rotation around the Y axis (radians). The front faces local +z. */
  rot: number
  /** Name given by the user; else the main entity's name or the kind name */
  name?: string
  /**
   * Main Home Assistant entity: sets the 3D look (on/off, light, door open) and the main control.
   * Items are independent of HA; the binding is a property given later.
   */
  entityId?: string | null
  /** Extra entities: any HA entity (temperature, humidity, plug, lock, battery...). Shown and controlled on the card. */
  extras?: string[]
  /** Door/window hinge side, looking at the door from inside the room (default left) */
  hinge?: 'left' | 'right'
  /** Which way the door/window opens: into its room (in, default) or to the other side of the wall (out / neighbor room) */
  swing?: 'in' | 'out'
  /** Length of items with adjustable length (local x, m): desk */
  len?: number
  /** Drawer unit of the desk */
  drawers?: 'none' | 'left' | 'right' | 'both'
  /** Colors: top (desktop) and body (drawers, legs) */
  top?: string
  body?: string
  /** Aquarium: last feeding time (ISO) */
  fedAt?: string
  /** Shape option: shower cabin square or round (quarter circle) */
  shape?: 'square' | 'round'
  /** Kind-specific option (catalog OPTIONS.variants): TV 'stand' (on a unit/table) | 'wall' (on the wall), mirror 'tall' | 'small', oven 'under' | 'tall', counter 'straight' | 'lLeft' | 'lRight', power strip '2'...'8' (outlets), rug 'rect' | 'round' | 'cowhide' | 'zebra' | 'sheep' (shape), ceiling fan '3' | '4' | '5' (blades) */
  variant?: string
  /** Second size: arm length of an L counter (from the back wall), depth (length) of a ceiling LED strip and of a rug */
  len2?: number
  /**
   * LED option. Counter: under the upper cabinets (lights the counter) or in the plinth (lights the floor).
   * TV: backlight ('back'); bed: strip on the headboard ('strip') or from behind onto the wall ('back'); ceiling fan: light
   * kit under the blades ('under'). When not given it counts as on if a suitable light is bound (bindings.ts > ledOf).
   */
  led?: 'none' | 'under' | 'plinth' | 'back' | 'strip'
  /**
   * Entity driving the LED feature (TV backlight, headboard, counter LED): chosen separately on the card and also bound as
   * an extra entity. Automatic when not given (bindings.ts > ledSource).
   */
  ledEntity?: string
  /**
   * Light intensity factor (1 = 100%; 10%-300% on the card). The light cast into the room and the visible glow are
   * multiplied by it; the HA brightness applies on top. Products differ in brightness, so the user adjusts it.
   */
  intensity?: number
  /** Hung on the wall (only for rules.ts > MOUNTABLE kinds: power strip). When not given, on the floor or a surface. */
  mount?: 'wall'
  /** Beam angle of a downlight (degrees, full cone; 20-150 on the card, 90 when not given). */
  beam?: number
  /**
   * Built-in sink and faucet of the kitchen counter: its position, or none. When not given it sits in the middle unless a
   * separate sink stands next to the counter (model/counter.ts).
   */
  sink?: 'none' | 'left' | 'center' | 'right'
  /**
   * Group id (grouped lights bind to the same entity). Bindings of items in the same group change together (layoutStore
   * bind / unbind / makeMain).
   */
  group?: string
}

/** A level (floor). */
export interface Level {
  id: string
  name: string
  /** Floor number: 0 ground, 1 first floor, -1 basement (0 when not given). Lower levels are drawn below in the scene. */
  elevation?: number
  rooms: Room[]
  items: Item[]
}

/**
 * How the Dashboard of a home is arranged (ui/Dashboard.tsx, model/dashboardLayout.ts); missing fields mean the default. Card
 * keys: `room:<roomId>`, `side:<name>`, `chip:<name>`, `scenes`, `favorites`. Row keys: `<itemId>|<entityId>` in a room
 * card, the entity id in the favorites and scenes cards. Saved with the plan, so it syncs like the plan.
 */
export interface DashboardLayout {
  /** Card order; cards missing from it follow in their default order */
  order?: string[]
  /** Hidden cards and summary tiles */
  hidden?: string[]
  /** Per card: row order and hidden rows */
  rows?: Record<string, { order?: string[]; hidden?: string[] }>
  /** Entities pinned to the Favorites card, in order */
  favorites?: string[]
}

export interface Layout {
  version: 1
  levels: Level[]
  /** Arrangement of the Dashboard of this home (missing: default) */
  dashboard?: DashboardLayout
  /**
   * Compass direction of the top of the plan (-z), degrees (0 north, 90 east; 0 when not given). The sun's angle on the
   * house follows it (scene/sun.ts): in walk mode sunlight comes in through the right window.
   */
  up?: number
}

export type Selection = { type: 'room' | 'item'; id: string } | null
