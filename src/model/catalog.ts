import { formatNumber, t, tc, tn } from '@/i18n'
import type { Item, ItemKind } from './types'

/**
 * Item groups (the tabs of the build bar). Smart home devices by function: light, climate, media, security, sensor, other
 * smart devices; household items by room: kitchen and laundry, bath, furniture, desk and decor; outdoor and garage on
 * their own; structure (door, window, stairs).
 */
export type KindGroup = 'light' | 'climate' | 'media' | 'security' | 'sensor' | 'device' | 'appliance' | 'bath' | 'furniture' | 'decor' | 'pet' | 'outdoor' | 'garage' | 'structure'

export interface KindMeta {
  label: string
  group: KindGroup
  /** HA domains that can be bound; the first is the suggested one */
  domains: string[]
  /** Footprint [width, depth] (m): for the selection ring and placement */
  size: [number, number]
  /** Height of the DOM label */
  labelY: number
  /** Sticks to walls (snaps to the nearest wall while dragged) */
  wall?: boolean
}

export const GROUP_LABEL: Record<KindGroup, string> = {
  light: t('Lights'),
  climate: t('Climate'),
  media: t('Media'),
  security: t('Security'),
  sensor: t('Sensors'),
  device: t('Smart devices'),
  appliance: t('Kitchen and appliances'),
  bath: t('Bathroom'),
  furniture: t('Furniture'),
  decor: t('Desk and decor'),
  pet: t('Pets'),
  outdoor: t('Garden and balcony'),
  garage: t('Garage and vehicles'),
  structure: t('Doors and windows'),
}

const LIGHTISH = ['light', 'switch']

export const CATALOG: Record<ItemKind, KindMeta> = {
  pendant: { label: t('Pendant light'), group: 'light', domains: LIGHTISH, size: [0.7, 0.7], labelY: 2.9 },
  floorLamp: { label: t('Floor lamp'), group: 'light', domains: LIGHTISH, size: [0.5, 0.5], labelY: 2 },
  deskLamp: { label: t('Desk lamp'), group: 'light', domains: LIGHTISH, size: [0.3, 0.3], labelY: 0.7 },
  wallLight: { label: t('Wall light'), group: 'light', domains: LIGHTISH, size: [0.4, 0.25], labelY: 2.3, wall: true },
  ledStrip: { label: t('LED strip'), group: 'light', domains: LIGHTISH, size: [2, 0.2], labelY: 2.6, wall: true },
  mirrorLight: { label: t('Mirror light'), group: 'light', domains: LIGHTISH, size: [0.8, 0.2], labelY: 2.3, wall: true },
  downlight: { label: t('Downlight'), group: 'light', domains: LIGHTISH, size: [0.15, 0.15], labelY: 2.75 },
  ceilingStrip: { label: t('Ceiling LED strip'), group: 'light', domains: LIGHTISH, size: [3, 3], labelY: 2.75 },

  // TV and TV unit are separate items: the TV goes on a unit/table or hangs on the wall.
  tv: { label: t('TV'), group: 'media', domains: ['media_player', 'switch', 'remote'], size: [1.3, 0.2], labelY: 1.75, wall: true },
  // Model and pose in Item.variant (ps5-v, ps5-h, xbox-v, xbox-h); the length (Item.len) follows it, CONSOLE_LEN
  console: { label: t('Game console'), group: 'media', domains: ['media_player', 'switch'], size: [0.13, 0.3], labelY: 0.6 },
  monitor: { label: t('Monitor'), group: 'media', domains: ['switch'], size: [0.7, 0.25], labelY: 0.6 },
  acUnit: { label: t('Air conditioner'), group: 'climate', domains: ['climate', 'switch'], size: [1, 0.3], labelY: 2.6, wall: true },
  radiator: { label: t('Radiator'), group: 'climate', domains: ['climate', 'switch'], size: [1, 0.15], labelY: 1, wall: true },
  // Wall-hung boiler (kit/smart.tsx > Boiler): grouped with radiators (model/groups.ts)
  boiler: { label: t('Boiler'), group: 'climate', domains: ['climate', 'water_heater', 'switch'], size: [0.44, 0.34], labelY: 2.1, wall: true },
  diffuser: { label: t('Diffuser'), group: 'climate', domains: ['humidifier', 'switch', 'light'], size: [0.2, 0.2], labelY: 0.42 },
  fan: { label: t('Fan'), group: 'climate', domains: ['fan', 'switch'], size: [0.5, 0.5], labelY: 1.5 },
  // Ceiling fan: on the ceiling; blade span Item.len (square footprint), blade count Item.variant, light kit Item.led
  // 'under' (automatic once a light is bound)
  ceilingFan: { label: t('Ceiling fan'), group: 'climate', domains: ['fan', 'switch', 'light'], size: [1.3, 1.3], labelY: 2.75 },
  plug: { label: t('Smart plug'), group: 'device', domains: ['switch'], size: [0.2, 0.12], labelY: 0.7, wall: true },
  powerStrip: { label: t('Power strip'), group: 'device', domains: ['switch'], size: [0.43, 0.08], labelY: 0.3 },
  wallSwitch: { label: t('Wall switch'), group: 'device', domains: ['switch', 'light'], size: [0.2, 0.08], labelY: 1.5, wall: true },
  camera: { label: t('Camera'), group: 'security', domains: ['camera', 'switch'], size: [0.25, 0.25], labelY: 2.45, wall: true },
  robotVacuum: { label: t('Robot vacuum'), group: 'device', domains: ['vacuum'], size: [0.4, 0.4], labelY: 0.5 },
  // Stick (cordless) vacuum on its dock, against the wall
  stickVacuum: { label: t('Stick vacuum'), group: 'device', domains: ['switch', 'vacuum', 'sensor'], size: [0.3, 0.28], labelY: 1.35, wall: true },
  alarmPanel: { label: t('Alarm panel'), group: 'security', domains: ['alarm_control_panel'], size: [0.3, 0.08], labelY: 1.75, wall: true },

  motionSensor: { label: t('Motion / presence'), group: 'sensor', domains: ['binary_sensor'], size: [0.2, 0.1], labelY: 2.45, wall: true },
  tempSensor: { label: t('Temperature sensor'), group: 'sensor', domains: ['sensor', 'climate'], size: [0.2, 0.1], labelY: 1.7, wall: true },
  vibrationSensor: { label: t('Vibration sensor'), group: 'sensor', domains: ['binary_sensor'], size: [0.15, 0.15], labelY: 0.6 },

  door: { label: t('Door'), group: 'structure', domains: ['binary_sensor', 'lock', 'cover'], size: [1, 0.2], labelY: 2.4, wall: true },
  window: { label: t('Window'), group: 'structure', domains: ['binary_sensor', 'cover'], size: [1.2, 0.2], labelY: 2.4, wall: true },

  sofa: { label: t('Sofa'), group: 'furniture', domains: [], size: [2.2, 0.9], labelY: 1.1 },
  armchair: { label: t('Armchair'), group: 'furniture', domains: [], size: [0.9, 0.85], labelY: 1.1 },
  coffeeTable: { label: t('Coffee table'), group: 'furniture', domains: [], size: [1.1, 0.6], labelY: 0.7 },
  roundTable: { label: t('Round side table'), group: 'furniture', domains: [], size: [0.6, 0.6], labelY: 0.7 },
  rug: { label: t('Rug'), group: 'furniture', domains: [], size: [2.6, 1.8], labelY: 0.3 },
  // Doormat with adjustable size; walked on like a rug
  doormat: { label: t('Doormat'), group: 'furniture', domains: [], size: [0.75, 0.45], labelY: 0.15 },
  bed: { label: t('Bed'), group: 'furniture', domains: [], size: [1.7, 2.1], labelY: 1.2 },
  nightstand: { label: t('Nightstand'), group: 'furniture', domains: [], size: [0.45, 0.4], labelY: 0.8 },
  wardrobe: { label: t('Wardrobe'), group: 'furniture', domains: [], size: [1.4, 0.6], labelY: 2.3, wall: true },
  desk: { label: t('Desk'), group: 'furniture', domains: [], size: [1.4, 0.7], labelY: 1 },
  chair: { label: t('Chair'), group: 'furniture', domains: [], size: [0.5, 0.5], labelY: 1.1 },
  gamingChair: { label: t('Gaming chair'), group: 'furniture', domains: [], size: [0.68, 0.68], labelY: 1.55 },
  diningTable: { label: t('Dining table'), group: 'furniture', domains: [], size: [1.4, 0.85], labelY: 1 },
  tvUnit: { label: t('TV unit'), group: 'furniture', domains: [], size: [1.8, 0.42], labelY: 0.8, wall: true },
  kitchenCounter: { label: t('Kitchen counter'), group: 'appliance', domains: ['light', 'switch'], size: [2, 0.62], labelY: 1.2, wall: true },
  fridge: { label: t('Fridge'), group: 'appliance', domains: [], size: [0.75, 0.7], labelY: 2.1, wall: true },
  stove: { label: t('Stove'), group: 'appliance', domains: [], size: [0.75, 0.62], labelY: 1.2, wall: true },
  sink: { label: t('Sink'), group: 'appliance', domains: [], size: [1, 0.62], labelY: 1.2, wall: true },
  bathtub: { label: t('Bathtub'), group: 'bath', domains: [], size: [1.6, 0.75], labelY: 0.9, wall: true },
  toilet: { label: t('Toilet'), group: 'bath', domains: [], size: [0.4, 0.65], labelY: 0.9, wall: true },
  washbasin: { label: t('Washbasin'), group: 'bath', domains: [], size: [0.6, 0.45], labelY: 1.1, wall: true },
  shoeCabinet: { label: t('Shoe cabinet'), group: 'furniture', domains: [], size: [1, 0.35], labelY: 1.2, wall: true },
  bookshelf: { label: t('Bookshelf'), group: 'furniture', domains: [], size: [1.2, 0.35], labelY: 2.1, wall: true },
  plant: { label: t('Potted plant'), group: 'furniture', domains: [], size: [0.45, 0.45], labelY: 1.5 },
  drawerUnit: { label: t('Drawer unit'), group: 'furniture', domains: [], size: [0.42, 0.5], labelY: 0.95 },
  wardrobeSingle: { label: t('Single wardrobe'), group: 'furniture', domains: [], size: [0.6, 0.6], labelY: 2.3, wall: true },
  dresser: { label: t('Dresser with mirror'), group: 'furniture', domains: ['light', 'switch'], size: [1, 0.45], labelY: 1.85, wall: true },
  mirrorCabinet: { label: t('Mirror cabinet'), group: 'bath', domains: ['light', 'switch'], size: [0.6, 0.16], labelY: 2.05, wall: true },
  laundryBasket: { label: t('Laundry basket'), group: 'appliance', domains: [], size: [0.45, 0.35], labelY: 0.8 },
  trashBin: { label: t('Trash bin'), group: 'furniture', domains: [], size: [0.3, 0.3], labelY: 0.65 },

  washer: { label: t('Washing machine'), group: 'appliance', domains: ['switch', 'sensor', 'binary_sensor'], size: [0.6, 0.6], labelY: 1.1, wall: true },
  dryer: { label: t('Dryer'), group: 'appliance', domains: ['switch', 'sensor', 'binary_sensor'], size: [0.6, 0.6], labelY: 1.1, wall: true },
  dishwasher: { label: t('Dishwasher'), group: 'appliance', domains: ['switch', 'sensor', 'binary_sensor'], size: [0.6, 0.6], labelY: 1.1, wall: true },
  oven: { label: t('Oven'), group: 'appliance', domains: ['switch', 'sensor', 'climate'], size: [0.6, 0.6], labelY: 1.15, wall: true },
  waterDispenser: { label: t('Water dispenser'), group: 'appliance', domains: ['switch', 'sensor'], size: [0.34, 0.36], labelY: 1.6, wall: true },

  wallFan: { label: t('Wall fan'), group: 'climate', domains: ['fan', 'switch'], size: [0.42, 0.3], labelY: 2.4, wall: true },
  deskFan: { label: t('Desk fan'), group: 'climate', domains: ['fan', 'switch'], size: [0.26, 0.2], labelY: 0.5 },
  homepod: { label: 'HomePod', group: 'media', domains: ['media_player'], size: [0.15, 0.15], labelY: 0.3 },
  deskCamera: { label: t('Desk camera'), group: 'security', domains: ['camera', 'switch'], size: [0.1, 0.1], labelY: 0.3 },
  shower: { label: t('Shower cabin'), group: 'bath', domains: [], size: [0.9, 0.9], labelY: 2.15, wall: true },

  keyboard: { label: t('Keyboard'), group: 'decor', domains: [], size: [0.44, 0.15], labelY: 0.15 },
  mouse: { label: t('Mouse'), group: 'decor', domains: [], size: [0.07, 0.11], labelY: 0.12 },
  mousePad: { label: t('Mouse pad'), group: 'decor', domains: [], size: [0.36, 0.28], labelY: 0.1 },
  monitorV: { label: t('Vertical monitor'), group: 'decor', domains: ['switch'], size: [0.4, 0.22], labelY: 0.85 },
  deskPlant: { label: t('Desk plant'), group: 'decor', domains: [], size: [0.14, 0.14], labelY: 0.32 },
  deskPalm: { label: t('Mini palm'), group: 'decor', domains: [], size: [0.2, 0.2], labelY: 0.5 },
  pegboard: { label: t('Pegboard'), group: 'decor', domains: [], size: [0.76, 0.08], labelY: 1.85, wall: true },
  painting: { label: t('Painting'), group: 'decor', domains: [], size: [0.8, 0.05], labelY: 2.05, wall: true },
  aquarium: { label: t('Aquarium'), group: 'decor', domains: ['light', 'switch', 'sensor', 'button'], size: [1, 0.42], labelY: 1.45 },
  fishbowl: { label: t('Fishbowl'), group: 'decor', domains: ['light', 'switch', 'button'], size: [0.28, 0.28], labelY: 0.38 },
  mirror: { label: t('Mirror'), group: 'decor', domains: [], size: [0.56, 0.05], labelY: 2.05, wall: true },
  soapDispenser: { label: t('Soap dispenser'), group: 'bath', domains: [], size: [0.08, 0.08], labelY: 0.25 },
  // Smart home devices (everything a smart home may have, with its controls); models in kit/smart.tsx
  ceilingLight: { label: t('Ceiling light'), group: 'light', domains: LIGHTISH, size: [0.45, 0.45], labelY: 2.75 },
  trackLight: { label: t('Track light'), group: 'light', domains: LIGHTISH, size: [1.2, 0.1], labelY: 2.75 },
  tableLamp: { label: t('Table lamp'), group: 'light', domains: LIGHTISH, size: [0.3, 0.3], labelY: 0.65 },
  thermostat: { label: t('Thermostat'), group: 'climate', domains: ['climate', 'sensor'], size: [0.12, 0.03], labelY: 1.7, wall: true },
  airPurifier: { label: t('Air purifier'), group: 'climate', domains: ['fan', 'switch', 'sensor'], size: [0.3, 0.3], labelY: 0.85 },
  humidifier: { label: t('Humidifier'), group: 'climate', domains: ['humidifier', 'switch'], size: [0.22, 0.22], labelY: 0.45 },
  dehumidifier: { label: t('Dehumidifier'), group: 'climate', domains: ['humidifier', 'switch'], size: [0.35, 0.25], labelY: 0.8 },
  heater: { label: t('Heater'), group: 'climate', domains: ['climate', 'switch'], size: [0.6, 0.25], labelY: 0.85 },
  waterHeater: { label: t('Water heater'), group: 'climate', domains: ['water_heater', 'switch', 'climate'], size: [0.45, 0.45], labelY: 2.3, wall: true },
  fireplace: { label: t('Electric fireplace'), group: 'climate', domains: ['switch', 'climate', 'light'], size: [1.2, 0.3], labelY: 1.0, wall: true },
  acOutdoor: { label: t('AC outdoor unit'), group: 'climate', domains: ['climate', 'switch'], size: [0.8, 0.3], labelY: 0.8, wall: true },
  towelWarmer: { label: t('Towel warmer'), group: 'bath', domains: ['switch', 'climate'], size: [0.5, 0.08], labelY: 1.6, wall: true },
  speaker: { label: t('Smart speaker'), group: 'media', domains: ['media_player'], size: [0.15, 0.15], labelY: 0.35 },
  soundbar: { label: t('Soundbar'), group: 'media', domains: ['media_player', 'switch'], size: [0.9, 0.1], labelY: 0.3 },
  projector: { label: t('Projector'), group: 'media', domains: ['media_player', 'switch'], size: [0.35, 0.3], labelY: 2.75 },
  projectorScreen: { label: t('Projector screen'), group: 'media', domains: ['cover', 'switch'], size: [2, 0.1], labelY: 2.65, wall: true },
  computer: { label: t('Computer'), group: 'media', domains: ['binary_sensor', 'switch'], size: [0.25, 0.45], labelY: 0.7 },
  doorbell: { label: t('Video doorbell'), group: 'security', domains: ['camera', 'binary_sensor', 'event'], size: [0.06, 0.04], labelY: 1.65, wall: true },
  smokeDetector: { label: t('Smoke / gas detector'), group: 'security', domains: ['binary_sensor', 'sensor'], size: [0.13, 0.13], labelY: 2.75 },
  siren: { label: t('Siren'), group: 'security', domains: ['siren', 'switch'], size: [0.18, 0.1], labelY: 2.55, wall: true },
  leakSensor: { label: t('Leak sensor'), group: 'sensor', domains: ['binary_sensor'], size: [0.07, 0.07], labelY: 0.2 },
  airQuality: { label: t('Air quality sensor'), group: 'sensor', domains: ['sensor'], size: [0.1, 0.1], labelY: 0.3 },
  smartButton: { label: t('Smart button'), group: 'sensor', domains: ['event', 'sensor', 'button', 'binary_sensor'], size: [0.06, 0.06], labelY: 0.2 },
  wallPanel: { label: t('Wall tablet'), group: 'device', domains: ['sensor', 'switch'], size: [0.3, 0.03], labelY: 1.75, wall: true },
  router: { label: t('Modem / router'), group: 'device', domains: ['switch', 'device_tracker', 'sensor'], size: [0.25, 0.15], labelY: 0.4 },
  nas: { label: 'NAS', group: 'device', domains: ['switch', 'sensor'], size: [0.2, 0.25], labelY: 0.42 },
  printer: { label: t('Printer'), group: 'device', domains: ['sensor', 'switch'], size: [0.45, 0.35], labelY: 0.5 },
  // The smart pet feeder is in the Pets tab; when it feeds, the pets run to it (model/pets.ts > feedingNow)
  petFeeder: { label: t('Smart pet feeder'), group: 'pet', domains: ['switch', 'button', 'sensor'], size: [0.25, 0.3], labelY: 0.55 },
  powerMeter: { label: t('Energy meter'), group: 'device', domains: ['sensor'], size: [0.3, 0.1], labelY: 2.1, wall: true },
  coffeeMachine: { label: t('Coffee machine'), group: 'appliance', domains: ['switch'], size: [0.25, 0.35], labelY: 0.55 },
  kettle: { label: t('Kettle'), group: 'appliance', domains: ['switch'], size: [0.2, 0.18], labelY: 0.45 },
  microwave: { label: t('Microwave'), group: 'appliance', domains: ['switch', 'sensor'], size: [0.5, 0.38], labelY: 0.5 },
  airFryer: { label: t('Air fryer'), group: 'appliance', domains: ['switch'], size: [0.3, 0.32], labelY: 0.5 },
  waterValve: { label: t('Main water valve'), group: 'device', domains: ['valve', 'switch'], size: [0.25, 0.12], labelY: 0.8, wall: true },
  homeBattery: { label: t('Home battery'), group: 'device', domains: ['sensor', 'switch', 'binary_sensor'], size: [0.75, 0.15], labelY: 1.35, wall: true },
  // Garden, balcony, garage and structure; models in kit/outdoor.tsx
  tree: { label: t('Tree'), group: 'outdoor', domains: [], size: [1.6, 1.6], labelY: 3.2 },
  bush: { label: t('Bush / hedge'), group: 'outdoor', domains: [], size: [1, 0.7], labelY: 1.3 },
  flowerBed: { label: t('Flower bed'), group: 'outdoor', domains: ['valve', 'switch', 'sensor'], size: [1.5, 0.6], labelY: 0.6 },
  gardenLight: { label: t('Garden light'), group: 'outdoor', domains: LIGHTISH, size: [0.3, 0.3], labelY: 1.25 },
  stringLights: { label: t('String lights'), group: 'outdoor', domains: LIGHTISH, size: [3, 0.1], labelY: 2.5 },
  sprinkler: { label: t('Sprinkler'), group: 'outdoor', domains: ['valve', 'switch'], size: [0.2, 0.2], labelY: 0.45 },
  lawnMower: { label: t('Robot lawn mower'), group: 'outdoor', domains: ['lawn_mower', 'switch', 'sensor'], size: [0.6, 0.45], labelY: 0.5 },
  grill: { label: t('Grill / barbecue'), group: 'outdoor', domains: ['switch', 'sensor', 'climate'], size: [0.9, 0.55], labelY: 1.25 },
  parasol: { label: t('Parasol'), group: 'outdoor', domains: [], size: [0.5, 0.5], labelY: 2.5 },
  lounger: { label: t('Sun lounger'), group: 'outdoor', domains: [], size: [0.7, 1.9], labelY: 0.8 },
  outdoorTable: { label: t('Garden table'), group: 'outdoor', domains: [], size: [1.6, 1.6], labelY: 1.05 },
  pool: { label: t('Pool'), group: 'outdoor', domains: ['switch', 'light', 'climate', 'water_heater', 'sensor'], size: [4, 2.5], labelY: 0.6 },
  hotTub: { label: t('Hot tub'), group: 'outdoor', domains: ['switch', 'climate', 'light', 'water_heater'], size: [2, 2], labelY: 1.2 },
  gate: { label: t('Garden gate'), group: 'outdoor', domains: ['cover', 'lock', 'binary_sensor'], size: [1.2, 0.1], labelY: 1.6 },
  fence: { label: t('Fence'), group: 'outdoor', domains: [], size: [2, 0.08], labelY: 1.2 },
  mailbox: { label: t('Mailbox'), group: 'outdoor', domains: ['binary_sensor', 'sensor'], size: [0.3, 0.25], labelY: 1.35 },
  solarPanel: { label: t('Solar panel'), group: 'outdoor', domains: ['sensor'], size: [1.7, 1.1], labelY: 1.4 },
  weatherStation: { label: t('Weather station'), group: 'outdoor', domains: ['sensor', 'weather'], size: [0.3, 0.3], labelY: 1.85 },
  swing: { label: t('Garden swing'), group: 'outdoor', domains: [], size: [2, 1.2], labelY: 2.2 },
  clothesRack: { label: t('Clothes drying rack'), group: 'outdoor', domains: [], size: [1.4, 0.6], labelY: 1.2 },
  awning: { label: t('Awning'), group: 'outdoor', domains: ['cover', 'switch'], size: [3, 1.5], labelY: 2.7, wall: true },
  car: { label: t('Car'), group: 'garage', domains: ['device_tracker', 'lock', 'sensor', 'binary_sensor', 'climate', 'switch'], size: [1.9, 4.6], labelY: 1.8 },
  evCharger: { label: t('EV charger'), group: 'garage', domains: ['switch', 'sensor', 'binary_sensor'], size: [0.3, 0.15], labelY: 1.75, wall: true },
  bicycle: { label: t('Bicycle'), group: 'garage', domains: ['sensor', 'device_tracker'], size: [0.6, 1.75], labelY: 1.25 },
  motorcycle: { label: t('Motorcycle / scooter'), group: 'garage', domains: ['device_tracker', 'sensor', 'lock'], size: [0.8, 2.1], labelY: 1.45 },
  workbench: { label: t('Workbench'), group: 'garage', domains: [], size: [1.6, 0.65], labelY: 1.2, wall: true },
  toolWall: { label: t('Tool wall'), group: 'garage', domains: [], size: [1.2, 0.06], labelY: 2.1, wall: true },
  storageRack: { label: t('Metal shelf'), group: 'garage', domains: [], size: [1.2, 0.45], labelY: 2.1, wall: true },
  stairs: { label: t('Stairs'), group: 'structure', domains: [], size: [1, 3.2], labelY: 3 },
  garageDoor: { label: t('Garage door'), group: 'structure', domains: ['cover', 'binary_sensor', 'switch'], size: [2.6, 0.2], labelY: 2.6, wall: true },
  // Front of the house and street; models in kit/street.tsx. Floors like road and sidewalk are drawn as rooms
  // (placement.ts > ROOM_PRESETS).
  streetLamp: { label: t('Street lamp'), group: 'outdoor', domains: LIGHTISH, size: [0.4, 0.4], labelY: 4.35 },
  bench: { label: t('Park bench'), group: 'outdoor', domains: [], size: [1.6, 0.6], labelY: 1.05 },
  streetBin: { label: t('Street bin'), group: 'outdoor', domains: [], size: [0.45, 0.45], labelY: 1.25 },
  wheelieBin: { label: t('Wheelie bin'), group: 'outdoor', domains: [], size: [0.62, 0.8], labelY: 1.25 },
  recycleBins: { label: t('Recycling bins'), group: 'outdoor', domains: [], size: [1.5, 0.55], labelY: 1.2 },
  hydrant: { label: t('Fire hydrant'), group: 'outdoor', domains: [], size: [0.4, 0.4], labelY: 0.95 },
  trafficSign: { label: t('Traffic sign'), group: 'outdoor', domains: [], size: [0.6, 0.2], labelY: 2.75 },
  bollard: { label: t('Bollard'), group: 'outdoor', domains: [], size: [0.25, 0.25], labelY: 1.1 },
  bikeRack: { label: t('Bike rack'), group: 'outdoor', domains: [], size: [1.5, 0.65], labelY: 1.0 },
  busStop: { label: t('Bus stop'), group: 'outdoor', domains: [], size: [3.3, 1.5], labelY: 3.0 },
  steppingStones: { label: t('Stepping stones'), group: 'outdoor', domains: [], size: [2.4, 0.5], labelY: 0.3 },
  rock: { label: t('Rock / stone cluster'), group: 'outdoor', domains: [], size: [1.0, 0.8], labelY: 0.8 },
  planter: { label: t('Large planter'), group: 'outdoor', domains: [], size: [1.2, 0.5], labelY: 1.0 },
  pergola: { label: t('Pergola / gazebo'), group: 'outdoor', domains: [], size: [3, 3], labelY: 3.0 },
  fountain: { label: t('Fountain / ornamental pond'), group: 'outdoor', domains: ['switch', 'valve'], size: [1.85, 1.85], labelY: 1.55 },
  birdBath: { label: t('Bird bath'), group: 'outdoor', domains: [], size: [0.5, 0.5], labelY: 1.0 },
  slide: { label: t('Slide'), group: 'outdoor', domains: [], size: [0.8, 2.8], labelY: 2.4 },
  trampoline: { label: t('Trampoline'), group: 'outdoor', domains: [], size: [2.6, 2.6], labelY: 2.6 },
  sandbox: { label: t('Sandbox'), group: 'outdoor', domains: [], size: [1.6, 1.6], labelY: 0.6 },
  streetTree: { label: t('Street tree'), group: 'outdoor', domains: [], size: [1.2, 1.2], labelY: 4.1 },
  utilityPole: { label: t('Utility pole'), group: 'outdoor', domains: [], size: [0.4, 0.4], labelY: 5.6 },
  outdoorShower: { label: t('Outdoor shower'), group: 'outdoor', domains: ['valve', 'switch'], size: [0.8, 0.8], labelY: 2.5 },
  manhole: { label: t('Manhole cover'), group: 'outdoor', domains: [], size: [0.66, 0.66], labelY: 0.25 },
  speedBump: { label: t('Speed bump'), group: 'outdoor', domains: [], size: [3, 0.45], labelY: 0.35 },
  trafficCone: { label: t('Traffic cone'), group: 'outdoor', domains: [], size: [0.34, 0.34], labelY: 0.85 },
  gardenShed: { label: t('Garden shed'), group: 'outdoor', domains: ['binary_sensor', 'lock'], size: [2.2, 1.8], labelY: 2.6 },
  picnicTable: { label: t('Picnic table'), group: 'outdoor', domains: [], size: [1.8, 1.6], labelY: 1.0 },
  // Pets (cats and dogs that move around on their own): the item's spot is the pet's home; in view mode scene/Pets.tsx
  // animates them. Models in kit/pets.tsx.
  cat: { label: t('Cat'), group: 'pet', domains: [], size: [0.3, 0.42], labelY: 0.55 },
  dog: { label: t('Dog'), group: 'pet', domains: [], size: [0.4, 0.75], labelY: 0.85 },
  catBed: { label: t('Cat bed'), group: 'pet', domains: [], size: [0.55, 0.55], labelY: 0.35 },
  dogBed: { label: t('Dog bed'), group: 'pet', domains: [], size: [0.95, 0.7], labelY: 0.4 },
  petBowl: { label: t('Food and water bowl'), group: 'pet', domains: [], size: [0.42, 0.22], labelY: 0.25 },
  litterBox: { label: t('Litter box'), group: 'pet', domains: [], size: [0.54, 0.44], labelY: 0.45 },
  catTree: { label: t('Cat tree'), group: 'pet', domains: [], size: [0.55, 0.55], labelY: 1.45 },
  dogHouse: { label: t('Dog house'), group: 'pet', domains: [], size: [0.9, 1.0], labelY: 1.15 },
  petToy: { label: t('Toy'), group: 'pet', domains: [], size: [0.12, 0.12], labelY: 0.2 },
}

/** Power strip: outlets 7 cm apart; a 2 cm cap on the left, a 6 cm main switch on the right. */
export const STRIP_PITCH = 0.07
export const stripWidth = (n: number) => Math.round((0.08 + n * STRIP_PITCH) * 100) / 100
/** Power strip sizes (number of outlets) */
export const STRIP_SIZES = [2, 3, 4, 5, 6, 8]
/** Height of the center of a wall-mounted power strip above the floor (with Item.y offset 0; same as rules.ts > WALL_SPAN). */
export const STRIP_WALL_Y = 0.3

/** Desk / cabinet top colors (name, hex). Match the 3D palette; kept here because the UI uses them too. */
export const TOP_COLORS: [string, string][] = [
  [t('White'), '#ffffff'],
  [t('Light oak'), '#dcb98c'],
  [t('Walnut'), '#8a5a3b'],
  [t('Birch'), '#ecdcc4'],
  [t('Anthracite'), '#3a3f5c'],
  [t('Black'), '#1f2440'],
]
/** Body colors: drawers, legs, cabinet, panel, frame. */
export const BODY_COLORS: [string, string][] = [
  [t('White'), '#ffffff'],
  [t('Black'), '#1f2440'],
  [t('Gray'), '#c3c8dc'],
  [t('Light oak'), '#dcb98c'],
  [t('Blue'), '#3f56e0'],
  [t('Mint'), '#8fd8bd'],
]

/** Bright accent colors (like the stripes of the gaming chair). */
export const ACCENT_COLORS: [string, string][] = [
  [t('Red'), '#e2564b'],
  [t('Blue'), '#3f56e0'],
  [t('Green'), '#2fbf71'],
  [t('Orange'), '#f0a63a'],
  [t('Purple'), '#8f6cf0'],
  [t('White'), '#ffffff'],
]

/** HomePod colors: the HomePod in white and midnight; the mini also in blue, yellow, orange. */
export const HOMEPOD_COLORS: [string, string][] = [
  [t('White'), '#efeeea'],
  [t('Midnight'), '#2c2f37'],
  [t('Blue'), '#5d7fa8'],
  [t('Yellow'), '#ecd27f'],
  [t('Orange'), '#e2895a'],
]

/**
 * Rug: shape Item.variant, width Item.len, length Item.len2 (a round rug is a circle when they are equal, an oval
 * otherwise; on a hide, the outline of the skin).
 */
export const RUG_SHAPES: [string, string][] = [
  ['rect', t('Rectangle')],
  ['round', t('Round')],
  ['cowhide', t('Cowhide')],
  ['zebra', t('Zebra hide')],
  ['sheep', t('Sheepskin')],
]
/** Doormat types (Item.variant) and colors (Item.body) */
export const DOORMAT_KINDS: [string, string][] = [
  ['coir', t('Coir')],
  ['rubber', t('Rubber')],
  ['welcome', t('Welcome')],
  ['striped', t('Striped')],
]
export const DOORMAT_COLORS: [string, string][] = [
  ['#b08452', t('Natural')],
  ['#4a4f5c', t('Anthracite')],
  ['#2f3f73', t('Navy')],
  ['#7a2f3a', t('Burgundy')],
  ['#3f6a4f', t('Green')],
]

/** Rug colors: the ground of plain and round rugs, the spots of a cowhide, the stripes of a zebra hide, the wool of a sheepskin. */
export const RUG_COLORS: [string, string][] = [
  [t('Lilac'), '#dfe4ff'],
  [t('Cream'), '#eee3cc'],
  [t('Gray'), '#bfc3cf'],
  [t('Anthracite'), '#3b3f4b'],
  [t('Brown'), '#6e4b33'],
  [t('Terracotta'), '#c4714d'],
  [t('Sage'), '#a6bc9d'],
  [t('Navy'), '#34416c'],
]
/** Without a chosen color: plain rugs lilac (the old look), hides in their natural color. */
export const RUG_DEFAULT: Record<string, string> = { rect: '#dfe4ff', round: '#dfe4ff', cowhide: '#2b2421', zebra: '#22201d', sheep: '#f2ede2' }

/** Blade and body colors of the ceiling fan. */
export const FAN_BLADE_COLORS: [string, string][] = [
  [t('Light wood'), '#c9a27a'],
  [t('Walnut'), '#7a5236'],
  [t('White'), '#f4f4f6'],
  [t('Black'), '#2a2c33'],
]
export const FAN_BODY_COLORS: [string, string][] = [
  [t('White'), '#f4f4f6'],
  [t('Black'), '#2a2c33'],
  [t('Nickel'), '#b8bcc8'],
  [t('Bronze'), '#8a6a4a'],
]

/** Pastel colors of pet items (bed, bowl base, litter box, cat tree; kit/pets.tsx). */
export const PET_COLORS: [string, string][] = [
  [t('Lilac'), '#c9c2ee'],
  [t('Blue'), '#9fb0e8'],
  [t('Coral'), '#ff8a7a'],
  [t('Mint'), '#bfe3d4'],
  [t('Cream'), '#efe4cf'],
  [t('Gray'), '#c3c8dc'],
  [t('Pink'), '#f2b8c6'],
]

/** Kinds with color and option settings: which settings are shown. */
export const OPTIONS: Partial<
  Record<
    ItemKind,
    {
      top?: string
      body?: string
      /** Another list for the top colors (default TOP_COLORS) and the colors in effect when none is chosen */
      topList?: [string, string][]
      topDef?: string
      bodyDef?: string
      /** Another list for the body colors (default BODY_COLORS) */
      bodyList?: [string, string][]
      drawers?: boolean
      shape?: boolean
      corner?: boolean
      variants?: [string, string][]
      variantLabel?: string
      /** Variant in effect when none is chosen (else the first) */
      variantDef?: string
      /** Length per variant (Item.len): a power strip's length changes with its outlet count, and so does its footprint */
      variantLen?: Record<string, number>
      /** Short note below the settings section of the card */
      note?: string
      /** LED options (Item.led value, label); the first is "none" */
      led?: [NonNullable<Item['led']>, string][]
      ledLabel?: string
      ledHint?: string
      /** Label of the picker for the entity driving the LED (bound separately on the card) */
      ledEntityLabel?: string
    }
  >
> = {
  kitchenCounter: {
    variantLabel: t('Shape'),
    variants: [
      ['straight', t('Straight')],
      ['lLeft', t('L (left corner)')],
      ['lRight', t('L (right corner)')],
    ],
    led: [
      ['none', t('None')],
      ['under', t('Under wall cabinets')],
      ['plinth', t('Plinth')],
    ],
    ledHint: t('Pick the light or plug that drives the LED below: the LED lights up with it and takes its color.'),
    ledEntityLabel: t('Entity driving the LED'),
    top: t('Counter color'),
    body: t('Cabinet color'),
  },
  tv: {
    variantLabel: t('Placement'),
    variants: [
      ['stand', t('On a unit / table')],
      ['wall', t('On the wall')],
    ],
    variantDef: 'stand',
    ledLabel: t('TV backlight'),
    ledEntityLabel: t('Backlight entity'),
    led: [
      ['none', t('None')],
      ['back', t('Yes')],
    ],
    ledHint: t('The TV follows its own entity (the bindings above), the backlight follows the light chosen here. Without one it glows like Ambilight while the TV is on.'),
  },
  window: {
    variantLabel: t('Curtain'),
    variants: [
      ['curtain', t('Drapes')],
      ['roller', t('Roller blind')],
      ['zebra', t('Zebra blind')],
      ['blinds', t('Venetian blind')],
      ['none', t('None')],
    ],
    variantDef: 'curtain',
    body: t('Curtain color'),
    note: t('Bind the curtain motor (Home Assistant cover) to this window: its open percentage (current_position) opens and closes the curtain; the slat angle of a venetian blind and the stripe alignment of a zebra blind follow current_tilt_position. With a window sensor bound, the sash opens.'),
  },
  bed: {
    ledLabel: t('Headboard light'),
    ledEntityLabel: t('Headboard light entity'),
    led: [
      ['none', t('None')],
      ['strip', t('Strip')],
      ['back', t('From behind')],
    ],
    ledHint: t("Pick the light or plug that drives the headboard light below: it lights up with it and takes the light's color. Strip is a horizontal LED on the front of the headboard; from behind is a hidden light washing the wall."),
  },
  diffuser: {
    body: t('Body'),
    bodyList: [
      [t('Light wood'), '#d9a066'],
      [t('Dark wood'), '#8a5634'],
      [t('White'), '#f4f2ee'],
    ],
    bodyDef: '#d9a066',
    ledLabel: t('Light'),
    ledEntityLabel: t('Light entity'),
    led: [
      ['none', t('None')],
      ['strip', t('Ring strip')],
    ],
    ledHint: t("Pick the diffuser's light (like \"Diffuser Light\") separately: the ring strip around the body lights up with it and takes its color, and so does the mist. Without one, the first light bound to the diffuser."),
  },
  downlight: {
    variantLabel: t('Light spread'),
    variants: [
      ['spot', t('Spot')],
      ['omni', t('All directions')],
    ],
    variantDef: 'spot',
    note: t('Spot casts a cone of light downward (set its angle below); all directions lights the whole room like a pendant light.'),
  },
  console: { note: t("Bind the console's media player or plug: while it is on, the PlayStation's blue light strip or the Xbox logo lights up.") },
  stickVacuum: {
    body: t('Body color'),
    bodyList: [
      [t('Red'), '#c8323c'],
      [t('Purple'), '#7a4fc4'],
      [t('Yellow'), '#e6b52e'],
      [t('Blue'), '#3d6fd6'],
      [t('Nickel'), '#b8bcc8'],
    ],
    bodyDef: '#c8323c',
    note: t("Bind the dock's plug or the vacuum's own entity: the dock's light glows blue while charging. While the vacuum entity is cleaning, the vacuum is not shown on the dock."),
  },
  deskCamera: {
    body: t('Color'),
    bodyList: [
      [t('White'), '#f4f4f6'],
      [t('Black'), '#26282f'],
    ],
    bodyDef: '#f4f4f6',
    note: t('Bind the camera or its plug: when on, its light glows green (red while recording or streaming live) and the head slowly pans left and right. With the privacy mode switch bound too, the lens turns down while it is on.'),
  },
  waterDispenser: { variantLabel: t('Water bottle'), variants: [['top', t('On top')], ['bottom', t('At the bottom (in the cabinet)')]] },
  powerStrip: {
    variantLabel: t('Outlets'),
    variants: [
      ['2', tn(2, '{count} outlet', '{count} outlets')],
      ['3', tn(3, '{count} outlet', '{count} outlets')],
      ['4', tn(4, '{count} outlet', '{count} outlets')],
      ['5', tn(5, '{count} outlet', '{count} outlets')],
      ['6', tn(6, '{count} outlet', '{count} outlets')],
      ['8', tn(8, '{count} outlet', '{count} outlets')],
    ],
    variantDef: '5',
    variantLen: Object.fromEntries(STRIP_SIZES.map((n) => [n, stripWidth(n)])),
    note: t('Bind the switch of each outlet of the smart power strip: they go to outlets 1, 2, 3 in binding order, and the light of an outlet that is on glows. With a single switch bound, all of them light up together.'),
  },
  mirror: { variantLabel: t('Type'), variants: [['tall', t('Full-length mirror')], ['small', t('Small round')]], body: t('Frame color') },
  rug: {
    variantLabel: t('Shape'),
    variants: RUG_SHAPES,
    variantDef: 'rect',
    body: t('Color'),
    bodyList: RUG_COLORS,
    note: t('A round rug is a circle when width and length are equal, an oval otherwise. On hides the color is that of the spots (cow), the stripes (zebra) or the wool (sheep).'),
  },
  doormat: { variantLabel: t('Type'), variants: DOORMAT_KINDS, variantDef: 'coir', body: t('Color'), bodyList: DOORMAT_COLORS, note: t('Set its width and length with the sliders; it can be walked on and placed in front of a door.') },
  ceilingFan: {
    variantLabel: t('Blades'),
    variants: [
      ['3', tn(3, '{count} blade', '{count} blades')],
      ['4', tn(4, '{count} blade', '{count} blades')],
      ['5', tn(5, '{count} blade', '{count} blades')],
    ],
    variantDef: '3',
    top: t('Blade color'),
    topList: FAN_BLADE_COLORS,
    topDef: '#c9a27a',
    body: t('Body color'),
    bodyList: FAN_BODY_COLORS,
    bodyDef: '#f4f4f6',
    ledLabel: t('Light'),
    ledEntityLabel: t('Light entity'),
    led: [
      ['none', t('None')],
      ['under', t('Yes')],
    ],
    ledHint: t("Pick the fan's light separately: the bowl under the blades lights up with it and lights the room like a pendant light. Without one, the first light bound to the fan."),
    note: t("Bind the fan's own entity (fan) or its plug: while it is on the blades spin, faster at a higher percentage."),
  },
  oven: { variantLabel: t('Placement'), variants: [['under', t('Under the counter')], ['tall', t('Tall unit (eye level)')]] },
  desk: { top: t('Top color'), body: t('Leg and drawer color'), drawers: true },
  gamingChair: { body: t('Seat color'), bodyDef: '#1f2440', top: t('Stripe color'), topList: ACCENT_COLORS, topDef: '#e2564b' },
  tvUnit: { top: t('Door color'), body: t('Body color') },
  drawerUnit: { top: t('Top color'), body: t('Body color') },
  wardrobe: { top: t('Door color'), body: t('Body color') },
  wardrobeSingle: { top: t('Door color'), body: t('Body color') },
  dresser: { top: t('Top color'), body: t('Body color') },
  shower: { shape: true, corner: true },
  fishbowl: {},
  homepod: {
    variantLabel: t('Model'),
    variants: [
      ['mini', 'HomePod mini'],
      ['full', 'HomePod'],
    ],
    variantDef: 'mini',
    body: t('Color'),
    bodyList: HOMEPOD_COLORS,
    bodyDef: '#efeeea',
    note: t('Bind the HomePod media player in Home Assistant (Apple TV integration): while playing, music notes rise from it and a colored wave spins on the touch surface, stronger as the volume goes up; it fades when paused.'),
  },
  ceilingLight: { variantLabel: t('Shape'), variants: [['round', t('Round')], ['square', t('Square')]], variantDef: 'round' },
  tableLamp: {
    variantLabel: t('Model'),
    variants: [
      ['classic', t('Classic')],
      ['globe', t('Globe')],
    ],
    variantDef: 'classic',
    top: t('Shade color'),
    topList: [
      [t('Cream'), '#f3e7cf'],
      [t('White'), '#ffffff'],
      [t('Gray'), '#c3c8dc'],
      [t('Mustard'), '#e2b450'],
      [t('Sage'), '#a6bc9d'],
    ],
    topDef: '#f3e7cf',
    body: t('Stand color'),
  },
  speaker: {
    variantLabel: t('Model'),
    variants: [
      ['echo', t('Cylinder (Echo)')],
      ['nest', t('Dome (Nest)')],
      ['sonos', t('Column (Sonos)')],
    ],
    variantDef: 'echo',
    body: t('Color'),
    bodyList: [
      [t('Charcoal'), '#3a3f4b'],
      [t('White'), '#f2f2ee'],
      [t('Blue gray'), '#7d8aa3'],
    ],
    note: t("Bind the speaker's media player: while playing, its light glows and music notes rise."),
  },
  computer: {
    variantLabel: t('Model'),
    variants: [
      ['tower', t('Tower')],
      ['mini', 'Mac mini'],
      ['laptop', t('Laptop')],
      ['imac', 'iMac'],
    ],
    variantDef: 'tower',
    variantLen: { tower: 0.25, mini: 0.2, laptop: 0.34, imac: 0.56 },
    note: t("Bind the computer's Ping sensor (Home Assistant > Ping, e.g. \"Mac\") or its plug: while the computer is on the network, its screen and lights are on. Bind the same sensor as an extra to the monitor on the desk and the monitor turns on with the computer."),
  },
  smokeDetector: {
    variantLabel: t('Type'),
    variants: [
      ['smoke', t('Smoke')],
      ['co', t('Carbon monoxide')],
      ['gas', t('Gas')],
    ],
    variantDef: 'smoke',
    note: t("Bind the detector's binary sensor (smoke, gas, carbon_monoxide): it flashes red when it detects something."),
  },
  printer: {
    variantLabel: t('Type'),
    variants: [
      ['paper', t('Paper printer')],
      ['3d', t('3D printer')],
    ],
    variantDef: 'paper',
    top: t('Filament color'),
    topList: ACCENT_COLORS,
  },
  fireplace: { top: t('Frame color'), topDef: '#dcb98c', note: t("Bind the fireplace's plug, climate or light entity: the flames burn while it is on.") },
  tree: {
    variantLabel: t('Type'),
    variants: [
      ['oak', t('Deciduous')],
      ['pine', t('Pine')],
      ['palm', t('Palm')],
      ['olive', t('Olive')],
    ],
    variantDef: 'oak',
  },
  bush: { variantLabel: t('Form'), variants: [['round', t('Round bush')], ['hedge', t('Hedge')]], variantDef: 'round' },
  flowerBed: { variantLabel: t('Edging'), variants: [['wood', tc('material', 'Wood')], ['stone', t('Stone')]], variantDef: 'wood' },
  lounger: {
    body: t('Cushion color'),
    bodyList: [
      [t('Lilac'), '#dfe4ff'],
      [t('Cream'), '#eee3cc'],
      [t('Navy'), '#34416c'],
      [t('Terracotta'), '#c4714d'],
      [t('Sage'), '#a6bc9d'],
    ],
    bodyDef: '#dfe4ff',
  },
  mailbox: { body: t('Color'), bodyList: ACCENT_COLORS },
  toolWall: { body: t('Board color'), bodyDef: '#e2c08f' },
  gardenLight: {
    variantLabel: t('Model'),
    variants: [
      ['post', t('Post')],
      ['bollard', t('Short post')],
      ['spike', t('Ground spot')],
    ],
    variantDef: 'post',
  },
  grill: { variantLabel: t('Model'), variants: [['kettle', t('Kettle grill')], ['gas', t('Gas grill')]], variantDef: 'kettle' },
  parasol: {
    body: t('Fabric color'),
    bodyList: [
      [t('Cream'), '#f4efe6'],
      [t('Navy'), '#34416c'],
      [t('Terracotta'), '#c4714d'],
      [t('Sage'), '#a6bc9d'],
      [t('White'), '#ffffff'],
    ],
    bodyDef: '#f4efe6',
  },
  gate: { variantLabel: t('Material'), variants: [['wood', tc('material', 'Wood')], ['metal', t('Metal')]], variantDef: 'wood', note: t("Bind the gate's motor (cover), lock or door sensor: the gate swings open while it is open.") },
  fence: {
    variantLabel: t('Type'),
    variants: [
      ['wood', tc('material', 'Wood')],
      ['metal', t('Metal')],
      ['glass', t('Glass railing')],
    ],
    variantDef: 'wood',
  },
  awning: {
    body: t('Stripe color'),
    bodyList: [
      [t('Blue'), '#3f56e0'],
      [t('Terracotta'), '#c4714d'],
      [t('Green'), '#2fbf71'],
      [t('Gray'), '#8d93ae'],
    ],
    bodyDef: '#3f56e0',
    note: t("Bind the awning's motor (cover): it extends as far as it is open."),
  },
  pool: { note: t("Bind the pool pump's plug, the pool light, heater or water temperature sensor: the water ripples while the pump runs, and the light lights the water in its own color.") },
  car: {
    variantLabel: t('Body style'),
    variants: [
      ['sedan', t('Sedan')],
      ['suv', 'SUV'],
      ['hatch', t('Hatchback')],
    ],
    variantDef: 'sedan',
    body: t('Color'),
    bodyList: [
      [t('Red'), '#c8323c'],
      [t('White'), '#f2f2f2'],
      [t('Black'), '#23252b'],
      [t('Silver'), '#b8bcc8'],
      [t('Blue'), '#2f5bd6'],
      [t('Navy'), '#1f2a4d'],
    ],
    bodyDef: '#c8323c',
    note: t("Bind the car's location (device_tracker), lock, battery or charging sensor: it looks see-through while away, the charging port glows green while charging, and the indicators glow yellow while unlocked."),
  },
  bicycle: { variantLabel: t('Type'), variants: [['bike', t('Bicycle')], ['ebike', t('E-bike')]], variantDef: 'bike', body: t('Bike frame color'), bodyList: ACCENT_COLORS },
  motorcycle: { variantLabel: t('Type'), variants: [['motorbike', t('Motorcycle')], ['scooter', t('Scooter')]], variantDef: 'motorbike', body: t('Color'), bodyList: ACCENT_COLORS },
  stairs: { note: t('Put the stairs on the lower level: in first-person walk mode you climb them to the level above. The room with the stairs is drawn without a ceiling.') },
  garageDoor: { note: t("Bind the garage door's motor (cover) or door sensor: the panels slide up as far as it is open.") },
  pegboard: { body: t('Panel color') },
  deskPalm: { body: t('Pot color'), bodyDef: '#ffffff' },
  painting: { body: t('Frame color') },
  aquarium: { body: t('Cabinet color') },
  // Pets: the cat's coat, the dog's breed (scene/petModel.ts > CAT_LOOKS, DOG_LOOKS), item colors
  cat: {
    variantLabel: t('Color'),
    variants: [
      ['tabby', t('Orange tabby')],
      ['black', t('Black')],
      ['white', t('White')],
      ['grey', t('Gray tabby')],
    ],
    variantDef: 'tabby',
    note: t("This is the cat's home. In view mode it wanders on its own: to the food and water bowl, the litter box, its bed, the sofa, the cat tree and the window; it sleeps at night. Click it and it meows and purrs."),
  },
  dog: {
    variantLabel: t('Breed'),
    variants: [
      ['golden', t('Golden retriever')],
      ['labrador', t('Black labrador')],
      ['terrier', t('Small terrier')],
      ['dalmatian', t('Dalmatian')],
    ],
    variantDef: 'golden',
    note: t("This is the dog's home. In view mode it wanders on its own: to its bowl, its bed or its dog house, plays with its toy and follows the people at home; it sleeps at night. Click it and it barks and wags its tail."),
  },
  catBed: { body: t('Color'), bodyList: PET_COLORS, bodyDef: '#c9c2ee' },
  dogBed: { body: t('Color'), bodyList: PET_COLORS, bodyDef: '#9fb0e8' },
  petBowl: {
    variantLabel: t('Bowl'),
    variants: [
      ['double', t('Food and water')],
      ['food', t('Food only')],
      ['water', t('Water only')],
    ],
    variantDef: 'double',
    body: t('Base color'),
    bodyList: PET_COLORS,
    bodyDef: '#ff8a7a',
  },
  petFeeder: { body: t('Body color'), note: t("Bind the smart feeder's switch, button or sensor: when it feeds, the cat and the dog run to the bowl.") },
  litterBox: { variantLabel: t('Type'), variants: [['open', t('Open')], ['covered', t('Covered')]], variantDef: 'open', body: t('Color'), bodyList: PET_COLORS, bodyDef: '#bfe3d4' },
  catTree: { body: t('Carpet color'), bodyList: PET_COLORS, bodyDef: '#efe4cf' },
  dogHouse: { body: t('Wood color'), bodyList: TOP_COLORS, bodyDef: '#dcb98c' },
  petToy: { variantLabel: t('Toy'), variants: [['ball', t('Ball')], ['bone', t('Bone')], ['mouse', t('Plush mouse')]], variantDef: 'ball' },
  // Front of the house and street
  streetLamp: {
    variantLabel: t('Model'),
    variants: [
      ['single', t('Single arm')],
      ['double', t('Double arm')],
      ['classic', t('Classic lantern')],
    ],
    variantDef: 'single',
    note: t("Bind the street lamp's light or switch: at night it lights the road and the sidewalk. The end of the arm is the lamp's front: turn the arm toward the road (R) and the light falls on the area below it."),
  },
  bench: {
    variantLabel: t('Type'),
    variants: [
      ['park', t('With backrest')],
      ['flat', t('Backless')],
    ],
    variantDef: 'park',
    top: t('Slat color'),
    topList: [
      [t('Light wood'), '#c49a6c'],
      [t('Walnut'), '#8a5a3b'],
      [t('Green'), '#4f8a6e'],
      [t('White'), '#f4f2ee'],
      [t('Anthracite'), '#3a3f5c'],
    ],
    topDef: '#c49a6c',
  },
  wheelieBin: {
    body: t('Color'),
    bodyList: [
      [t('Gray'), '#5d6274'],
      [t('Green'), '#3e8e62'],
      [t('Blue (paper)'), '#3d6fd6'],
      [t('Yellow (packaging)'), '#e6b52e'],
      [t('Brown (organic)'), '#7a5236'],
    ],
    bodyDef: '#5d6274',
  },
  trafficSign: {
    variantLabel: t('Sign'),
    variants: [
      ['stop', tc('sign', 'Stop')],
      ['parking', tc('sign', 'Parking')],
      ['crossing', t('Crosswalk')],
      ['speed', t('Speed 30')],
      ['noEntry', t('No entry')],
      ['yield', t('Yield')],
    ],
    variantDef: 'stop',
  },
  bollard: { variantLabel: t('Type'), variants: [['steel', t('Steel')], ['concrete', t('Concrete')]], variantDef: 'steel' },
  rock: { variantLabel: t('Type'), variants: [['cluster', t('Stone cluster')], ['boulder', t('Boulder')]], variantDef: 'cluster' },
  planter: {
    variantLabel: t('Material'),
    variants: [
      ['wood', tc('material', 'Wood')],
      ['concrete', t('Concrete')],
      ['corten', t('Corten steel')],
    ],
    variantDef: 'wood',
  },
  pergola: {
    variantLabel: t('Type'),
    variants: [
      ['pergola', t('Pergola')],
      ['gazebo', t('Gazebo')],
    ],
    variantDef: 'pergola',
    note: t('It stands overhead like a roof: a garden table, picnic table, bench or sun lounger can go under it.'),
  },
  fountain: { note: t("Bind the pump's plug or valve: while it is on, water spouts from the top, spills from the bowl into the basin and ripples spread.") },
  outdoorShower: { note: t("Bind the outdoor shower's valve or switch: water rains from the head while it is on.") },
  slide: { body: t('Slide color'), bodyList: ACCENT_COLORS, bodyDef: '#f0a63a' },
  streetTree: { variantLabel: t('Type'), variants: [['round', t('Round crown')], ['columnar', t('Cypress')]], variantDef: 'round' },
  utilityPole: { variantLabel: t('Material'), variants: [['wood', tc('material', 'Wood')], ['concrete', t('Concrete')]], variantDef: 'wood' },
  gardenShed: {
    body: t('Color'),
    bodyList: [
      [t('Sage'), '#a6bc9d'],
      [tc('material', 'Wood'), '#c49a6c'],
      [t('Gray blue'), '#8a98b8'],
      [t('White'), '#f4f2ee'],
      [t('Terracotta'), '#c4714d'],
    ],
    bodyDef: '#a6bc9d',
    note: t('Bind the door sensor or the lock: the doors swing out while the door (or the lock) is open.'),
  },
}

/** Kinds with adjustable length: length (local x) limits (m); the card shows label when given */
export const RESIZABLE: Partial<Record<ItemKind, { min: number; max: number; label?: string }>> = {
  desk: { min: 0.8, max: 2.6 },
  kitchenCounter: { min: 0.6, max: 4, label: t('Counter length') },
  tvUnit: { min: 0.8, max: 3.2, label: t('Unit length') },
  window: { min: 0.5, max: 3, label: t('Window width') },
  rug: { min: 0.5, max: 5, label: t('Rug width') },
  doormat: { min: 0.4, max: 3, label: t('Doormat width') },
  ceilingFan: { min: 0.8, max: 1.6, label: t('Blade span') },
  trackLight: { min: 0.6, max: 3, label: t('Track length') },
  projectorScreen: { min: 1.2, max: 3.5, label: t('Screen width') },
  bush: { min: 0.6, max: 6, label: t('Length') },
  flowerBed: { min: 0.6, max: 6, label: t('Flower bed length') },
  stringLights: { min: 1, max: 10, label: t('String length') },
  pool: { min: 1.5, max: 12, label: t('Pool length') },
  fence: { min: 0.5, max: 12, label: t('Fence length') },
  awning: { min: 1, max: 6, label: t('Awning width') },
  bench: { min: 0.9, max: 3, label: t('Bench length') },
  bikeRack: { min: 0.9, max: 4, label: t('Bike rack length') },
  steppingStones: { min: 0.8, max: 8, label: t('Path length') },
  planter: { min: 0.6, max: 4, label: t('Planter length') },
  speedBump: { min: 1, max: 10, label: t('Speed bump length') },
}
/** Second size (Item.len2): the arm of an L counter (L shapes only), the height of a window */
export const RESIZABLE2: Partial<Record<ItemKind, { min: number; max: number; label: string; def: number; onlyL?: boolean }>> = {
  kitchenCounter: { min: 1.2, max: 4, label: t('L arm length (from the corner)'), def: 1.8, onlyL: true },
  window: { min: 0.5, max: 2.3, label: t('Window height'), def: 1.2 },
  rug: { min: 0.5, max: 5, label: t('Rug length'), def: 1.8 },
  doormat: { min: 0.3, max: 1.5, label: t('Doormat length'), def: 0.45 },
  pool: { min: 1, max: 8, label: t('Pool width'), def: 2.5 },
}

/**
 * A second, preset card of a kind in the build bar: the same kind, added with these settings when dropped. Full-height
 * window: 2.1 m high, 8 cm above the floor (0.82 m below the default bottom edge at 0.9 m).
 */
export interface ItemPreset {
  id: string
  kind: ItemKind
  label: string
  sub: string
  extra: Partial<Pick<Item, 'len' | 'len2' | 'y' | 'variant' | 'mount'>>
}
export const ITEM_PRESETS: ItemPreset[] = [
  { id: 'windowFull', kind: 'window', label: t('Full-height window'), sub: `${formatNumber(1.2)} × ${formatNumber(2.1)} m`, extra: { len2: 2.1, y: -0.82 } },
  // The power strip can hang on the wall too
  { id: 'powerStripWall', kind: 'powerStrip', label: t('Wall power strip'), sub: t('wall mounted · 2-8 outlets'), extra: { mount: 'wall' } },
  // Rug shapes; all the same kind, the card changes shape and size
  { id: 'rugRound', kind: 'rug', label: t('Round rug'), sub: t('Ø {d} m · can be oval', { d: 1.6 }), extra: { variant: 'round', len: 1.6, len2: 1.6 } },
  { id: 'rugCowhide', kind: 'rug', label: t('Cowhide'), sub: `${formatNumber(1.6)} × ${formatNumber(2)} m`, extra: { variant: 'cowhide', len: 1.6, len2: 2 } },
  { id: 'rugSheep', kind: 'rug', label: t('Sheepskin'), sub: `${formatNumber(0.7)} × ${formatNumber(1)} m`, extra: { variant: 'sheep', len: 0.7, len2: 1 } },
]

/** Window size: width (Item.len), height (Item.len2), bottom edge 0.9 m above the floor (moves with Item.y). */
export const WINDOW_BOTTOM = 0.9
export const windowSize = (it: { len?: number; len2?: number }) => ({ w: it.len ?? 1.2, h: it.len2 ?? 1.2 })

/** The item's real footprint: the adjusted length if there is one. */
export function sizeOf(kind: ItemKind, len?: number, len2?: number): [number, number] {
  const [w, d] = CATALOG[kind].size
  // The second size only for kinds that use it as depth (ceiling strip, rug); the L arm of a counter is computed separately.
  if (kind === 'ceilingStrip' || kind === 'rug' || kind === 'doormat' || kind === 'pool') return [len ?? w, len2 ?? d]
  // A ceiling fan is round: the blade span in both directions
  if (kind === 'ceilingFan') return [len ?? w, len ?? d]
  return [len ?? w, d]
}

/**
 * Game console model and pose (Item.variant `${brand}-${pose}`: PlayStation or Xbox, vertical or horizontal). PlayStation
 * vertical when not given. Length: the footprint width (m).
 */
export const CONSOLE_LEN: Record<string, number> = { 'ps5-v': 0.13, 'ps5-h': 0.37, 'xbox-v': 0.08, 'xbox-h': 0.28 }
export const consoleModel = (variant?: string) => ({ brand: variant?.startsWith('xbox') ? 'xbox' : 'ps5', pose: variant?.endsWith('-h') ? 'h' : 'v' }) as const

/** Beam angle of a downlight (degrees, full cone): limits of the card slider and the default (Item.beam). */
export const BEAM = { min: 20, max: 150, def: 90 }

export const LIGHT_KINDS: ItemKind[] = ['pendant', 'floorLamp', 'deskLamp', 'wallLight', 'ledStrip', 'mirrorLight', 'downlight', 'ceilingStrip', 'ceilingLight', 'trackLight', 'tableLamp', 'gardenLight', 'stringLights', 'streetLamp']

export function isLightKind(kind: ItemKind) {
  return LIGHT_KINDS.includes(kind)
}

export const KINDS_BY_GROUP: Record<KindGroup, ItemKind[]> = (Object.keys(CATALOG) as ItemKind[]).reduce(
  (acc, k) => {
    acc[CATALOG[k].group].push(k)
    return acc
  },
  { light: [], climate: [], media: [], security: [], sensor: [], device: [], appliance: [], bath: [], furniture: [], decor: [], pet: [], outdoor: [], garage: [], structure: [] } as Record<KindGroup, ItemKind[]>,
)
