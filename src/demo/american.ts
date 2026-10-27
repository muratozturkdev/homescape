import { t } from '@/i18n'
import { CATALOG, stripWidth } from '@/model/catalog'
import { APERTURE_INSET, isAperture, WALL_IN } from '@/model/geometry'
import type { HassEntity } from '@/ha/types'
import type { Item, ItemKind, Layout, Level, Rect, Room } from '@/model/types'

/*
 * Sample home: an American suburban house and its street, a full demo home for testing. Hand-built plan: every item kind
 * of the app at least once, in a sensible place; devices are bound to demo entities (prefixed us_). Ids are fixed (prefixed
 * "us-"): tests and "rebuild" give the same plan. Opened from the home menu (ui/HomeMenus.tsx); the entities are in the demo
 * source only while this home is open (demo/demoHomes.ts). Regression test tools/demo-check.mjs. Room, level, home and
 * entity names are created in the user's language.
 *
 * Lot (x to the right, z to the front; street in front): backyard z -14..0 (deck, pool, play area), house z 0..10
 * (13 × 10 m, two floors, two-car garage on the right), front yard z 10..17 (porch, front path, driveway), sidewalk,
 * two-lane street, across it a side street with a crosswalk, a parking lot and a neighborhood park. Total floor area
 * ~270 m² (~2900 ft²).
 */

export const AMERICAN_NAME = t('Sample home: American house')
/** Id prefix of the American house's levels: recognizes this plan in the home list (even if renamed) */
export const AMERICAN_LEVEL = 'us-lvl'

export const isAmericanLayout = (l: Layout | null | undefined) => Boolean(l?.levels.some((v) => v.id.startsWith(AMERICAN_LEVEL)))

type Side = 'back' | 'front' | 'left' | 'right'
const ROT: Record<Side, number> = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }
const PI = Math.PI

/** Main and extra entities */
const bind = (main: string, ...extras: string[]): Partial<Item> => ({ entityId: main, ...(extras.length ? { extras } : {}) })

/** Builds the rooms and items of a level with fixed ids. */
function floorKit(prefix: string) {
  const rooms: Room[] = []
  const items: Item[] = []
  const count: Record<string, number> = {}
  const garden = { type: 'garden' as const }
  const room = (key: string, name: string, floor: Room['floor'], x: number, z: number, w: number, d: number, more: Partial<Room> = {}) => {
    const r: Room = { id: `us-${prefix}-${key}`, name, floor, x, z, w, d, areaId: null, ...more }
    rooms.push(r)
    return r
  }
  /** Item: (x, z) center of the base, rot direction (front face is local +z) */
  const put = (kind: ItemKind, x: number, z: number, rot = 0, more: Partial<Item> = {}) => {
    count[kind] = (count[kind] ?? 0) + 1
    const it: Item = { id: `us-${prefix}-${kind}-${count[kind]}`, kind, x, z, rot, entityId: null, ...more }
    items.push(it)
    return it
  }
  /**
   * Wall item: on one side of the room (outdoors, the side facing the house wall), at `along` (world x or z) along the
   * wall. Position computed like geometry.ts > wallSnap: inner face + depth / 2 + 1 cm; doors and windows APERTURE_INSET
   * inside the boundary.
   */
  const wall = (r: Rect, side: Side, along: number, kind: ItemKind, more: Partial<Item> = {}) => {
    const inset = isAperture(kind) ? APERTURE_INSET : WALL_IN + CATALOG[kind].size[1] / 2 + 0.01
    const x = side === 'left' ? r.x + inset : side === 'right' ? r.x + r.w - inset : along
    const z = side === 'back' ? r.z + inset : side === 'front' ? r.z + r.d - inset : along
    return put(kind, x, z, ROT[side], more)
  }
  return { rooms, items, room, put, wall, garden }
}

/* ---------- ground floor, yards and street ---------- */

function groundFloor(): Level {
  const { rooms, items, room, put, wall, garden } = floorKit('g')

  // Indoors (house body x -7..6, z 0..10; garage x 6..12.5)
  const foyer = room('foyer', t('Foyer'), 'wood', -1.5, 5.5, 3, 4.5)
  const living = room('living', t('Living room'), 'wood', -7, 5.5, 5.5, 4.5)
  const office = room('office', t('Office'), 'wood', 1.5, 7, 4.5, 3)
  const half = room('halfbath', t('Powder room'), 'tile', 1.5, 5.5, 2, 1.5)
  const pantry = room('pantry', t('Pantry'), 'tile', 3.5, 5.5, 2.5, 1.5)
  const family = room('family', t('Family room'), 'wood', -7, 0, 5.5, 5.5)
  const kitchen = room('kitchen', t('Kitchen and dining'), 'tile', -1.5, 0, 7.5, 5.5)
  const laundry = room('laundry', t('Laundry room'), 'tile', 6, 0, 3.5, 3.5)
  const garage = room('garage', t('Garage'), 'concrete', 6, 3.5, 6.5, 6.5, { type: 'garage' })

  // Front yard and driveway
  const porch = room('porch', t('Front porch'), 'deck', -4, 10, 7, 2.2, { type: 'terrace' })
  room('path', t('Front path'), 'paving', -0.75, 12.2, 1.5, 4.8, garden)
  room('lawn-l', t('Front yard'), 'grass', -10, 12.2, 9.25, 4.8, {
    ...garden,
    parts: [
      { x: -10, z: 10, w: 6, d: 2.2 },
      { x: -10, z: 0, w: 3, d: 10 },
    ],
  })
  room('lawn-r', t('Front yard (right)'), 'grass', 0.75, 12.2, 5.25, 4.8, { ...garden, parts: [{ x: 3, z: 10, w: 3, d: 2.2 }] })
  room('drive', t('Driveway'), 'concrete', 6, 10, 6.5, 7, garden)
  const side = room('side', t('Side yard'), 'grass', 12.5, 3.5, 2.5, 13.5, { ...garden, parts: [{ x: 9.5, z: 0, w: 5.5, d: 3.5 }] })
  // Backyard
  const deck = room('deck', t('Back deck'), 'deck', -7, -4, 8, 4, { type: 'terrace' })
  room('pool', t('Pool area'), 'paving', 3, -12, 10, 8, garden)
  room('back', t('Backyard'), 'grass', -10, -12, 13, 8, {
    ...garden,
    parts: [
      { x: -10, z: -14, w: 25, d: 2 },
      { x: 13, z: -12, w: 2, d: 8 },
      { x: -10, z: -4, w: 3, d: 4 },
      { x: 1, z: -4, w: 14, d: 4 },
    ],
  })
  // Street: sidewalk, two-lane street, across it a side street with a crosswalk (T junction), parking lot and neighborhood park
  room('sidewalk', t('Sidewalk'), 'sidewalk', -16, 17, 35, 2.5, garden)
  room('road', t('Street'), 'road', -16, 19.5, 35, 7, garden)
  room('crosswalk', t('Crosswalk'), 'crosswalk', -10, 26.5, 7, 3, garden)
  room('side-road', t('Side street'), 'road', -10, 29.5, 7, 6.5, garden)
  room('sidewalk-far', t('Opposite sidewalk'), 'sidewalk', -3, 26.5, 22, 2.5, { ...garden, parts: [{ x: -3, z: 29, w: 2.5, d: 7 }] })
  room('corner', t('Corner sidewalk'), 'sidewalk', -16, 26.5, 6, 2.5, { ...garden, parts: [{ x: -12.5, z: 29, w: 2.5, d: 7 }] })
  room('parking', t('Parking lot'), 'parking', -0.5, 29, 10, 5.5, garden)
  room('park', t('Neighborhood park'), 'grass', 9.5, 29, 9.5, 7, { ...garden, parts: [{ x: -0.5, z: 34.5, w: 10, d: 1.5 }] })
  // Neighbor lots: the street is longer than the lot, so no gaps are left at the sides
  room('nbr-l', t("Neighbor's yard (left)"), 'grass', -16, -14, 6, 31, garden)
  room('nbr-r', t("Neighbor's yard (right)"), 'grass', 15, -14, 4, 31, garden)
  room('corner-yard', t('Corner yard'), 'grass', -16, 29, 3.5, 7, garden)

  /* --- foyer: front door, stairs, alarm panel, thermostat --- */
  wall(foyer, 'front', 0.5, 'door', bind('lock.us_front_door', 'binary_sensor.us_front_door'))
  put('doormat', 0.5, 9.4, PI, { len: 0.9, len2: 0.55, variant: 'coir', body: '#b08452' })
  // Stairs on the left wall, bottom end at the front (+z), rising toward the back (-z); the upstairs hall covers them
  put('stairs', -0.94, 7.2, 0)
  wall(living, 'right', 9.45, 'door')
  wall(foyer, 'back', 0.45, 'door')
  wall(half, 'left', 6.05, 'door')
  wall(office, 'left', 8, 'door')
  wall(foyer, 'right', 9.1, 'shoeCabinet', { top: '#dcb98c', body: '#ffffff' })
  wall(foyer, 'right', 9.1, 'mirror', { variant: 'small', body: '#dcb98c' })
  wall(foyer, 'front', -0.25, 'alarmPanel', bind('alarm_control_panel.us_alarm'))
  wall(foyer, 'front', 1.2, 'wallSwitch', bind('light.us_foyer_chandelier'))
  wall(foyer, 'back', 1.2, 'thermostat', bind('climate.us_thermostat'))
  wall(foyer, 'front', -0.75, 'motionSensor', bind('binary_sensor.us_foyer_motion'))
  put('pendant', 0.5, 7.6, 0, bind('light.us_foyer_chandelier'))
  put('plant', 1.2, 6.95, 0)

  /* --- living room: home theater corner with a projector --- */
  wall(living, 'back', -5.2, 'projectorScreen', { ...bind('cover.us_living_screen'), len: 2 })
  put('projector', -5.2, 8.1, PI, bind('media_player.us_living_projector'))
  put('rug', -5.2, 7.6, 0, { len: 2.8, len2: 2.2, body: '#eee3cc' })
  put('sofa', -5.2, 8.6, PI)
  put('coffeeTable', -5.2, 7.45, 0)
  put('armchair', -6.4, 7.35, PI / 2)
  put('armchair', -2.95, 7.35, -PI / 2)
  wall(living, 'left', 6.15, 'bookshelf')
  put('speaker', -6.45, 6.05, 0, { ...bind('media_player.us_living_sonos'), variant: 'sonos', body: '#3a3f4b' })
  put('speaker', -3.95, 6.05, 0, { variant: 'sonos', body: '#3a3f4b' })
  put('floorLamp', -3.55, 9.4, 0, bind('light.us_living_floor_lamp'))
  put('roundTable', -6.55, 9.45, 0)
  put('tableLamp', -6.55, 9.45, 0, { ...bind('light.us_living_table_lamp'), y: 0.47 })
  wall(living, 'front', -5.9, 'window', { ...bind('cover.us_living_blinds', 'binary_sensor.us_living_window'), variant: 'blinds', len: 1.2 })
  wall(living, 'front', -4.1, 'window', { ...bind('cover.us_living_blinds'), variant: 'blinds', len: 1.2 })
  wall(living, 'left', 8.5, 'window', { variant: 'curtain', body: '#eee3cc' })
  wall(living, 'right', 7.2, 'painting', { body: '#8a5a3b' })
  wall(living, 'right', 6.2, 'tempSensor', bind('sensor.us_living_temperature', 'sensor.us_living_humidity'))
  put('plant', -2, 6.05, 0)
  for (const [x, z] of [
    [-6, 7],
    [-4, 7],
    [-6, 9],
    [-4, 9],
  ])
    put('downlight', x, z, 0, { ...bind('light.us_living_downlights'), group: 'us-grp-living-spots', variant: 'spot' })
  // The cat's home: cat tree and bed in a corner of the living room
  put('catTree', -2.05, 6.65, 0, { body: '#efe4cf' })
  put('cat', -2.35, 8.55, -PI / 2, { variant: 'tabby', name: 'Whiskers' })
  put('catBed', -3.2, 6.25, 0, { body: '#c9c2ee' })

  /* --- family room: fireplace, TV, ceiling fan, door to the deck --- */
  wall(family, 'right', 4.95, 'door')
  wall(family, 'front', -3.6, 'door')
  wall(family, 'back', -2.6, 'door', { ...bind('binary_sensor.us_patio_door'), hinge: 'right' })
  wall(family, 'front', -5.3, 'tvUnit', { len: 2.2, top: '#8a5a3b', body: '#ffffff' })
  put('tv', -5.3, 5.5 - WALL_IN - 0.1 - 0.01, PI, { ...bind('media_player.us_family_tv', 'light.us_family_tv_backlight'), y: 0.5, variant: 'stand', led: 'back' })
  put('soundbar', -5.3, 5.08, PI, { ...bind('media_player.us_family_soundbar'), y: 0.5 })
  put('console', -6.1, 5.25, PI, { ...bind('media_player.us_family_ps5'), y: 0.5, variant: 'ps5-v', len: 0.13 })
  put('router', -4.45, 5.25, PI, { ...bind('switch.us_router'), y: 0.5 })
  put('rug', -5.3, 3.1, 0, { len: 3, len2: 2.3, variant: 'rect', body: '#a6bc9d' })
  put('sofa', -5.3, 1.95, 0)
  put('coffeeTable', -5.3, 3.25, 0)
  put('armchair', -2.6, 3.1, -PI / 2)
  wall(family, 'left', 3.4, 'fireplace', bind('switch.us_fireplace'))
  wall(family, 'left', 3.4, 'painting', { body: '#1f2440', y: 0.35 })
  put('floorLamp', -6.7, 1.45, 0, bind('light.us_family_floor_lamp'))
  put('ceilingFan', -4.3, 2.8, 0, { ...bind('fan.us_family_ceiling_fan', 'light.us_family_fan_light'), len: 1.3, variant: '5', led: 'under' })
  wall(family, 'back', -5.3, 'window', { variant: 'curtain', len: 1.6, body: '#eee3cc' })
  wall(family, 'left', 1.2, 'window', { variant: 'roller', len: 1.2 })
  wall(family, 'left', 0.6, 'plug', bind('switch.us_family_plug'))
  wall(family, 'front', -6.5, 'motionSensor', bind('binary_sensor.us_family_motion'))
  put('robotVacuum', -6.6, 0.4, PI / 2, bind('vacuum.us_robot'))
  put('plant', -1.9, 0.5, 0)
  // The dog's home: bed and toy in the family room
  put('dogBed', -2.4, 1.85, 0, { body: '#9fb0e8' })
  put('dog', -3.3, 4.05, PI, { variant: 'golden', name: 'Buddy' })
  put('petToy', -3.6, 1.6, 0, { variant: 'ball' })

  /* --- kitchen and dining --- */
  wall(kitchen, 'left', 0.425, 'fridge')
  wall(kitchen, 'left', 1.45, 'stove')
  wall(kitchen, 'left', 2.3, 'oven', { variant: 'tall' })
  wall(kitchen, 'back', 0.5, 'kitchenCounter', { ...bind('light.us_kitchen_counter_led'), len: 2.4, sink: 'center', led: 'under', top: '#ecdcc4', body: '#3a3f5c' })
  wall(kitchen, 'back', 2, 'dishwasher', bind('switch.us_dishwasher', 'sensor.us_dishwasher_power'))
  // The leg of the L counter reaches into the room: island / bar
  wall(kitchen, 'back', 3.3, 'kitchenCounter', { len: 2, variant: 'lRight', len2: 2.4, sink: 'none', top: '#ecdcc4', body: '#3a3f5c' })
  const ON_COUNTER = 0.91
  put('coffeeMachine', -0.4, 0.33, 0, { ...bind('switch.us_coffee_machine'), y: ON_COUNTER })
  put('speaker', -0.05, 0.3, 0, { ...bind('media_player.us_kitchen_echo'), y: ON_COUNTER, variant: 'echo', body: '#f2f2ee' })
  put('kettle', 1.25, 0.32, 0, { ...bind('switch.us_kettle'), y: ON_COUNTER })
  put('microwave', 2.85, 0.35, 0, { ...bind('switch.us_microwave'), y: ON_COUNTER })
  put('airFryer', 3.99, 1.9, -PI / 2, { ...bind('switch.us_air_fryer'), y: ON_COUNTER })
  put('homepod', 3.99, 1.2, -PI / 2, { ...bind('media_player.us_kitchen_homepod'), y: ON_COUNTER, variant: 'mini', body: '#5d7fa8' })
  put('pendant', 3.99, 1.25, 0, { ...bind('light.us_kitchen_island'), group: 'us-grp-island' })
  put('pendant', 3.99, 2.1, 0, { ...bind('light.us_kitchen_island'), group: 'us-grp-island' })
  put('diningTable', 1.6, 3.6, 0)
  put('chair', 1.25, 2.95, 0)
  put('chair', 1.95, 2.95, 0)
  put('chair', 1.25, 4.3, PI)
  put('chair', 1.95, 4.3, PI)
  put('chair', 0.4, 3.6, PI / 2)
  put('chair', 2.8, 3.6, -PI / 2)
  put('pendant', 1.6, 3.6, 0, bind('light.us_kitchen_dining'))
  for (const x of [-0.2, 1.2, 2.6]) put('downlight', x, 1.15, 0, { ...bind('light.us_kitchen_downlights'), group: 'us-grp-kitchen-spots', beam: 70 })
  put('smokeDetector', -0.6, 2.2, 0, { ...bind('binary_sensor.us_kitchen_gas'), variant: 'gas' })
  wall(kitchen, 'back', 5.35, 'window', { variant: 'roller', len: 1.2 })
  wall(kitchen, 'front', 2.5, 'wallPanel', bind('sensor.us_kitchen_tablet_battery'))
  wall(kitchen, 'front', 1.15, 'wallSwitch', bind('light.us_kitchen_downlights'))
  wall(kitchen, 'front', -0.5, 'motionSensor', bind('binary_sensor.us_kitchen_motion'))
  put('petFeeder', 5.72, 4.75, -PI / 2, bind('switch.us_pet_feeder', 'sensor.us_pet_feeder_food'))
  put('petBowl', 5.78, 4.15, -PI / 2, { variant: 'double', body: '#ff8a7a' })

  /* --- powder room and pantry --- */
  wall(half, 'back', 3, 'toilet')
  wall(half, 'front', 3.15, 'washbasin')
  wall(half, 'front', 3.17, 'mirror', { variant: 'small', body: '#ffffff' })
  put('soapDispenser', 3.3, 6.65, PI, { y: 0.8 })
  put('ceilingLight', 2.5, 6.25, 0, { ...bind('light.us_half_bath'), variant: 'round' })
  wall(pantry, 'back', 4.75, 'door')
  wall(pantry, 'left', 6.15, 'bookshelf')
  wall(pantry, 'right', 6.6, 'waterDispenser', { ...bind('switch.us_water_dispenser'), variant: 'top' })
  put('trashBin', 5.7, 5.85, 0)
  put('ceilingLight', 4.75, 6.25, 0, { ...bind('light.us_pantry'), variant: 'square' })

  /* --- office --- */
  wall(office, 'back', 4.3, 'desk', { len: 1.8, drawers: 'none', top: '#dcb98c', body: '#1f2440' })
  put('gamingChair', 4.3, 8.1, PI, { body: '#1f2440', top: '#3f56e0' })
  put('drawerUnit', 3.65, 7.36, 0, { top: '#dcb98c', body: '#ffffff' })
  const DESK = 0.75
  put('monitor', 4.05, 7.3, 0, { ...bind('switch.us_office_monitor', 'binary_sensor.us_office_pc'), y: DESK })
  put('monitorV', 4.8, 7.32, -0.35, { ...bind('switch.us_office_monitor', 'binary_sensor.us_office_pc'), y: DESK })
  put('keyboard', 4.05, 7.58, 0, { y: DESK })
  put('mousePad', 4.55, 7.58, 0, { y: DESK })
  put('mouse', 4.55, 7.58, 0, { y: DESK })
  put('deskLamp', 3.55, 7.25, 0, { ...bind('light.us_office_desk_lamp'), y: DESK })
  put('deskPalm', 5.0, 7.62, 0, { y: DESK, body: '#ffffff' })
  put('airQuality', 3.75, 7.62, 0, { ...bind('sensor.us_office_co2'), y: DESK })
  put('computer', 5.42, 7.4, 0, { ...bind('binary_sensor.us_office_pc', 'switch.us_office_power_strip'), variant: 'tower', len: 0.25 })
  put('powerStrip', 4.6, 7.42, 0, { ...bind('switch.us_office_power_strip'), variant: '5', len: stripWidth(5) })
  put('drawerUnit', 2.9, 7.36, 0, { top: '#dcb98c', body: '#ffffff' })
  put('printer', 2.9, 7.36, 0, { ...bind('switch.us_printer'), y: 0.72, variant: 'paper' })
  wall(office, 'back', 2.9, 'pegboard', { body: '#ffffff' })
  wall(office, 'right', 8.9, 'bookshelf')
  put('nas', 5.8, 9.62, 0, bind('switch.us_nas'))
  wall(office, 'right', 8.1, 'acUnit', bind('climate.us_office_ac', 'sensor.us_office_temperature'))
  wall(office, 'front', 3.75, 'window', { variant: 'zebra', len: 1.6, body: '#ffffff' })
  put('trackLight', 3.75, 8.6, 0, { ...bind('light.us_office_track'), len: 1.8 })
  put('plant', 2, 9.55, 0)
  wall(office, 'front', 5.3, 'motionSensor', bind('binary_sensor.us_office_motion'))

  /* --- laundry room (mudroom): opens to the garage, the kitchen and the backyard --- */
  wall(laundry, 'left', 2.95, 'door')
  wall(laundry, 'front', 8.95, 'door', bind('binary_sensor.us_garage_entry'))
  wall(laundry, 'back', 7.6, 'door', bind('lock.us_back_door', 'binary_sensor.us_back_door'))
  put('doormat', 7.6, 0.6, 0, { len: 0.8, len2: 0.5, variant: 'rubber', body: '#4a4f5c' })
  wall(laundry, 'right', 1.6, 'washer', bind('switch.us_washer', 'sensor.us_washer_power'))
  put('dryer', laundry.x + laundry.w - WALL_IN - 0.3 - 0.01, 1.6, -PI / 2, { ...bind('switch.us_dryer', 'sensor.us_dryer_power'), y: 0.86 })
  put('vibrationSensor', 9.1, 1.6, -PI / 2, { ...bind('binary_sensor.us_washer_vibration'), y: 1.72 })
  wall(laundry, 'right', 0.55, 'sink')
  wall(laundry, 'right', 0.45, 'window', { variant: 'none', len: 0.8 })
  wall(laundry, 'left', 0.35, 'wardrobeSingle', { top: '#a6bc9d', body: '#ffffff' })
  wall(laundry, 'left', 1.45, 'shoeCabinet', { top: '#dcb98c', body: '#ffffff' })
  wall(laundry, 'left', 2.2, 'stickVacuum', { ...bind('vacuum.us_stick_vacuum'), body: '#7a4fc4' })
  put('laundryBasket', 8.55, 2.1, 0)
  put('litterBox', 6.78, 2.05, PI / 2, { variant: 'covered', body: '#bfe3d4' })
  put('dehumidifier', 8.4, 0.3, 0, bind('humidifier.us_laundry_dehumidifier'))
  wall(laundry, 'back', 8.6, 'waterValve', bind('valve.us_main_water'))
  put('leakSensor', 8.75, 1.5, 0, bind('binary_sensor.us_laundry_leak'))
  put('ceilingLight', 7.75, 1.75, 0, { ...bind('light.us_laundry'), variant: 'round' })

  /* --- garage: SUV, motorcycle, bikes, EV charger, workbench, boiler and water heater --- */
  wall(garage, 'front', 7.35, 'garageDoor', bind('cover.us_garage_door_left'))
  wall(garage, 'front', 11.15, 'garageDoor', bind('cover.us_garage_door_right'))
  put('doormat', 8.95, 3.75, PI, { len: 0.9, len2: 0.45, variant: 'striped', body: '#2f3f73' })
  put('car', 7.5, 6.9, PI, { ...bind('device_tracker.us_suv', 'sensor.us_suv_battery', 'binary_sensor.us_suv_charging', 'lock.us_suv'), variant: 'suv', body: '#1f2a4d', name: t('SUV') })
  wall(garage, 'left', 5, 'evCharger', bind('switch.us_ev_charger', 'sensor.us_ev_charger_power'))
  put('motorcycle', 11.15, 6.6, PI, { ...bind('device_tracker.us_motorcycle'), variant: 'motorbike', body: '#e2564b' })
  put('bicycle', 12.05, 7.85, 0, { variant: 'bike', body: '#2fbf71' })
  put('bicycle', 12.05, 5.55, 0, { ...bind('device_tracker.us_ebike', 'sensor.us_ebike_battery'), variant: 'ebike', body: '#3f56e0' })
  wall(garage, 'back', 11.15, 'workbench')
  wall(garage, 'back', 11.15, 'toolWall', { body: '#e2c08f' })
  wall(garage, 'back', 10.3, 'powerStrip', { ...bind('switch.us_garage_outlet_1', 'switch.us_garage_outlet_2'), mount: 'wall', variant: '4', len: stripWidth(4), y: 0.75 })
  wall(garage, 'left', 8.6, 'storageRack')
  wall(garage, 'back', 6.5, 'waterHeater', bind('water_heater.us_water_heater'))
  wall(garage, 'left', 4.4, 'boiler', bind('climate.us_boiler'))
  wall(garage, 'back', 7.4, 'homeBattery', bind('sensor.us_home_battery', 'switch.us_home_battery_backup'))
  wall(garage, 'back', 8.1, 'powerMeter', bind('sensor.us_home_power'))
  wall(garage, 'back', 7.4, 'siren', bind('siren.us_garage_siren'))
  wall(garage, 'right', 9.2, 'camera', bind('camera.us_garage'))
  wall(garage, 'right', 4.4, 'wallFan', bind('fan.us_garage_exhaust'))
  wall(garage, 'right', 7, 'window', { variant: 'none', len: 1 })
  put('heater', 10, 4, 0, bind('switch.us_garage_heater'))
  put('fan', 9.6, 5.1, PI, bind('fan.us_garage_fan'))
  put('leakSensor', 6.45, 4.15, 0, bind('binary_sensor.us_garage_leak'))
  wall(garage, 'left', 6.2, 'motionSensor', bind('binary_sensor.us_garage_motion'))
  put('ceilingLight', 7.6, 6.7, 0, { ...bind('light.us_garage'), group: 'us-grp-garage', variant: 'square' })
  put('ceilingLight', 10.9, 6.7, 0, { ...bind('light.us_garage'), group: 'us-grp-garage', variant: 'square' })

  /* --- front porch: doorbell, wall lights, seating corner --- */
  put('doormat', 0.5, 10.55, 0, { len: 1, len2: 0.6, variant: 'welcome', body: '#7a2f3a' })
  wall(porch, 'back', 1.25, 'doorbell', bind('camera.us_doorbell'))
  wall(porch, 'back', -0.2, 'wallLight', { ...bind('light.us_porch'), group: 'us-grp-porch' })
  wall(porch, 'back', 1.5, 'wallLight', { ...bind('light.us_porch'), group: 'us-grp-porch' })
  wall(porch, 'back', -3.1, 'camera', bind('camera.us_porch'))
  put('bench', -2.7, 10.5, 0, { variant: 'park', len: 1.6, top: '#f4f2ee' })
  put('roundTable', 2.3, 10.75, 0)
  put('chair', 1.7, 10.75, PI / 2)
  put('chair', 2.3, 11.45, PI)
  put('plant', -0.95, 11.8, 0)
  put('plant', 1.95, 11.85, 0)

  /* --- front yard: lawn, trees, flower beds, garden lights, fence and gate, sprinkler --- */
  put('tree', -6.5, 14.4, 0, { variant: 'oak' })
  put('flowerBed', -6.2, 10.45, 0, { ...bind('valve.us_flower_bed_drip'), len: 3, variant: 'wood' })
  put('bush', -8.6, 11.2, PI / 2, { variant: 'round', len: 1.2 })
  put('bush', -8.5, 5, PI / 2, { variant: 'hedge', len: 6 })
  put('gardenLight', -1.2, 13.4, 0, { ...bind('light.us_garden_path'), group: 'us-grp-path', variant: 'bollard' })
  put('gardenLight', -1.2, 15.8, 0, { ...bind('light.us_garden_path'), group: 'us-grp-path', variant: 'bollard' })
  put('gardenLight', 1.2, 13.4, 0, { ...bind('light.us_garden_path'), group: 'us-grp-path', variant: 'bollard' })
  put('gardenLight', 1.2, 15.8, 0, { ...bind('light.us_garden_path'), group: 'us-grp-path', variant: 'bollard' })
  put('sprinkler', -4, 15, 0, bind('valve.us_front_sprinkler'))
  put('birdBath', -3, 13.4, 0)
  put('rock', -8.6, 15.6, 0, { variant: 'boulder' })
  put('fence', -5.35, 16.9, 0, { variant: 'wood', len: 9 })
  put('fence', 3.4, 16.9, 0, { variant: 'wood', len: 5.1 })
  put('gate', 0, 16.85, 0, { ...bind('binary_sensor.us_front_gate'), variant: 'wood' })
  put('steppingStones', 4.45, 11.2, 0, { len: 2.6 })
  put('flowerBed', 4.5, 10.45, 0, { len: 2.4, variant: 'stone' })
  put('tree', 4.6, 14.9, 0, { variant: 'pine' })
  put('bush', 2.4, 12.85, 0, { variant: 'round', len: 0.9 })
  put('planter', 2.3, 16.3, 0, { variant: 'corten', len: 1.2 })

  /* --- driveway: second car, bins out for trash day --- */
  put('car', 11.15, 13.1, PI, { ...bind('device_tracker.us_sedan'), variant: 'sedan', body: '#c8323c', name: t('Sedan') })
  put('wheelieBin', 6.6, 16.35, 0, { body: '#5d6274' })
  put('recycleBins', 7.95, 16.45, 0)
  put('trafficCone', 9.2, 16.5, 0)

  /* --- side yard: AC outdoor unit, drying rack, side gate --- */
  wall(side, 'left', 5, 'acOutdoor', bind('climate.us_thermostat'))
  put('clothesRack', 13.75, 1.75, PI / 2)
  put('gate', 13.75, 10.05, 0, { ...bind('lock.us_side_gate'), variant: 'metal' })
  put('fence', 12.85, 10.05, 0, { variant: 'metal', len: 0.6 })
  put('fence', 14.65, 10.05, 0, { variant: 'metal', len: 0.6 })
  put('bush', 14.6, 13.5, PI / 2, { variant: 'hedge', len: 6 })

  /* --- back deck: dining table under a pergola, string lights, grill, awning --- */
  put('doormat', -2.6, -0.45, PI, { len: 1, len2: 0.5, variant: 'coir', body: '#b08452' })
  put('pergola', -5, -2, 0, { variant: 'pergola' })
  put('outdoorTable', -5, -2, 0)
  put('stringLights', -2.3, -3.85, 0, { ...bind('light.us_deck_string_lights'), len: 5.5 })
  put('grill', 0.35, -2.4, -PI / 2, { ...bind('switch.us_grill'), variant: 'gas' })
  wall(deck, 'front', -0.25, 'awning', { ...bind('cover.us_deck_awning'), len: 2.4, body: '#3f56e0' })
  wall(deck, 'front', -4.4, 'wallLight', bind('light.us_deck_light'))
  wall(deck, 'front', -6.4, 'camera', bind('camera.us_backyard'))
  put('planter', -6.3, -3.55, 0, { variant: 'wood', len: 1 })
  put('gardenLight', 0.65, -3.65, 0, { ...bind('light.us_deck_light'), variant: 'spike' })

  /* --- pool area: pool, hot tub, loungers, parasol, outdoor shower, weather station --- */
  put('pool', 8, -8.2, 0, { ...bind('switch.us_pool_pump', 'light.us_pool_light', 'sensor.us_pool_temperature'), len: 7, len2: 3.5 })
  put('hotTub', 11.8, -5.3, 0, bind('switch.us_hot_tub', 'sensor.us_hot_tub_temperature'))
  put('lounger', 5, -5.05, PI, { body: '#c4714d' })
  put('lounger', 6.2, -5.05, PI, { body: '#c4714d' })
  put('parasol', 5.6, -4.6, 0, { body: '#f4efe6' })
  put('outdoorShower', 3.6, -11.4, 0, bind('valve.us_outdoor_shower'))
  put('weatherStation', 12.6, -11.6, 0, bind('weather.us_home', 'sensor.us_outdoor_temperature', 'sensor.us_wind_speed'))
  put('gardenLight', 3.4, -4.4, 0, { ...bind('light.us_pool_path'), variant: 'post' })

  /* --- backyard: play area, shed, dog house, mower, solar panels, wooden fence --- */
  put('gardenShed', -8.7, -12.85, 0, { ...bind('binary_sensor.us_shed_door'), body: '#a6bc9d' })
  put('trampoline', -6, -8.6, 0)
  put('swing', -2.2, -10.6, 0)
  put('slide', -8.8, -7.9, 0, { body: '#f0a63a' })
  put('sandbox', -3.6, -7.1, 0)
  put('picnicTable', 0.6, -6.6, 0)
  put('fountain', 0.2, -9.3, 0, bind('switch.us_fountain'))
  put('birdBath', 1.9, -11, 0)
  put('tree', -8.5, -2, 0, { variant: 'oak' })
  put('tree', 14, -13, 0, { variant: 'pine' })
  put('tree', 2, -13.1, 0, { variant: 'olive' })
  put('dogHouse', 14.2, -3, -PI / 2, { body: '#dcb98c' })
  put('lawnMower', 2.1, -4.55, 0, bind('lawn_mower.us_mower'))
  put('sprinkler', -5, -11, 0, bind('valve.us_back_sprinkler'))
  put('solarPanel', 11, -1.5, PI, bind('sensor.us_solar_power'))
  put('solarPanel', 12.8, -1.5, PI, bind('sensor.us_solar_power'))
  put('bush', 6, -13.5, 0, { variant: 'hedge', len: 5 })
  put('flowerBed', -4.6, -12.9, 0, { len: 2.4, variant: 'stone' })
  put('rock', -0.6, -12.9, 0, { variant: 'cluster' })
  // Wooden privacy fence of the backyard: back boundary and both sides
  put('fence', -5.75, -13.92, 0, { variant: 'wood', len: 8.3 })
  put('fence', 2.55, -13.92, 0, { variant: 'wood', len: 8.3 })
  put('fence', 10.85, -13.92, 0, { variant: 'wood', len: 8.3 })
  put('fence', -9.92, -10.4, PI / 2, { variant: 'wood', len: 6.9 })
  put('fence', -9.92, -3.5, PI / 2, { variant: 'wood', len: 6.9 })
  put('fence', 14.92, -10.4, PI / 2, { variant: 'wood', len: 6.9 })
  put('fence', 14.92, -3.5, PI / 2, { variant: 'wood', len: 6.9 })

  /* --- street: sidewalk, street, crosswalk, opposite sidewalk, parking lot, park --- */
  // Street lamps: one bound to HA, the others unbound (they light up by themselves at night). The arm faces the road.
  put('streetLamp', -9, 19.15, 0, { ...bind('light.us_street_lamp'), variant: 'single' })
  put('streetLamp', 4, 19.15, 0, { variant: 'single' })
  put('streetLamp', 16.5, 19.15, 0, { variant: 'classic' })
  put('streetLamp', -1.5, 26.85, PI, { variant: 'double' })
  put('streetLamp', 12, 26.85, PI, { variant: 'single' })
  put('streetTree', -13, 18.65, 0, { variant: 'round' })
  put('streetTree', -4.6, 18.65, 0, { variant: 'round' })
  put('streetTree', 14.4, 18.65, 0, { variant: 'columnar' })
  put('streetTree', 5, 27.65, 0, { variant: 'round' })
  put('hydrant', -2.5, 19.1, 0)
  put('mailbox', 5.5, 19.05, 0, { ...bind('binary_sensor.us_mailbox'), body: '#3f56e0' })
  put('trafficSign', -14.5, 19.15, 0, { variant: 'speed' })
  put('trafficSign', -10.5, 27.1, PI / 2, { variant: 'stop' })
  put('trafficSign', -2.6, 27.1, PI, { variant: 'crossing' })
  put('bollard', -3.3 + 0.5, 28.6, 0, { variant: 'steel' })
  put('bollard', -10.45, 28.6, 0, { variant: 'concrete' })
  put('busStop', 8, 27.75, PI)
  put('streetBin', 10.2, 27.05, 0)
  put('bikeRack', 1.6, 28.4, 0, { len: 1.8 })
  put('utilityPole', 17.5, 28.6, 0, { variant: 'wood' })
  put('manhole', 3, 23)
  put('manhole', -6.5, 21.2)
  put('speedBump', 13.5, 23, PI / 2, { len: 6.4 })
  put('trafficCone', -13.4, 20.1, 0)
  put('trafficCone', -12.8, 20.3, 0)
  put('car', 3.25, 31.75, PI, { variant: 'hatch', body: '#f2f2f2' })
  put('bench', 14, 30.2, PI, { variant: 'park', len: 1.8 })
  put('bench', 16.6, 33.5, -PI / 2, { variant: 'flat', len: 1.6 })
  put('streetTree', 12, 33.2, 0, { variant: 'round' })
  put('tree', 17.4, 30.6, 0, { variant: 'oak' })
  put('streetBin', 15.6, 30.2, 0)
  put('planter', 11.5, 30.1, 0, { variant: 'concrete', len: 1.4 })
  // neighbors
  put('tree', -13, 12.5, 0, { variant: 'oak' })
  put('tree', -13.2, -7.5, 0, { variant: 'pine' })
  put('bush', -12.6, 6.5, 0, { variant: 'round', len: 1.2 })
  put('rock', -14.2, 2.5, 0, { variant: 'boulder' })
  put('tree', 17.2, 6, 0, { variant: 'pine' })
  put('tree', 17, -8.5, 0, { variant: 'oak' })
  put('bush', 17, 13.5, 0, { variant: 'round', len: 1.4 })
  put('tree', -14.25, 32.5, 0, { variant: 'olive' })

  return { id: `${AMERICAN_LEVEL}-0`, name: t('Ground floor'), elevation: 0, rooms, items }
}

/* ---------- upper floor ---------- */

function upperFloor(): Level {
  const { rooms, items, room, put, wall } = floorKit('u')
  const hall = room('hall', t('Upstairs hall'), 'wood', -1.5, 3, 3, 7)
  const master = room('master', t('Master bedroom'), 'carpet', -7, 4, 5.5, 6)
  const ensuite = room('ensuite', t('Master bath'), 'tile', -7, 0, 3.5, 4)
  const closet = room('closet', t('Walk-in closet'), 'wood', -3.5, 0, 2, 4)
  const bath = room('bath', t('Hall bath'), 'tile', -1.5, 0, 3, 3)
  const mia = room('mia', t("Mia's room"), 'carpet', 1.5, 0, 4.5, 5)
  const ethan = room('ethan', t("Ethan's room"), 'carpet', 1.5, 5, 4.5, 5)

  /* --- hall: top of the stairs (opening x -1.44..-0.44, z 5.6..8.8), reading nook --- */
  wall(master, 'right', 5.4, 'door')
  wall(bath, 'front', 0.5, 'door')
  wall(mia, 'left', 4, 'door')
  wall(ethan, 'left', 6, 'door')
  wall(hall, 'front', 0, 'window', { variant: 'curtain', len: 1.2, body: '#dfe4ff' })
  put('armchair', 0.1, 9.45, PI)
  put('floorLamp', 1.05, 9.55, 0, bind('light.us_reading_lamp'))
  wall(hall, 'right', 8.2, 'bookshelf')
  wall(hall, 'right', 7, 'wallLight', bind('light.us_hall_sconce'))
  wall(hall, 'left', 7, 'painting', { body: '#ffffff' })
  wall(hall, 'back', -0.8, 'siren', bind('siren.us_upstairs_siren'))
  wall(hall, 'right', 4.9, 'motionSensor', bind('binary_sensor.us_upstairs_motion'))
  put('smokeDetector', 0.5, 6.3, 0, { ...bind('binary_sensor.us_hall_smoke'), variant: 'smoke' })
  for (const z of [4, 6.9, 8.6]) put('downlight', 0.6, z, 0, { ...bind('light.us_upstairs_hall'), group: 'us-grp-hall', variant: 'omni' })
  put('plant', -1.1, 9.55, 0)
  // Linen closet in the back corner of the hall
  wall(hall, 'back', -1.15, 'wardrobeSingle', { top: '#ffffff', body: '#ffffff' })

  /* --- master bedroom --- */
  put('bed', -7 + WALL_IN + 1.05 + 0.02, 7, PI / 2, { ...bind('light.us_master_headboard'), led: 'back' })
  put('nightstand', -6.74, 5.65, PI / 2)
  put('nightstand', -6.74, 8.35, PI / 2)
  put('tableLamp', -6.74, 5.65, PI / 2, { ...bind('light.us_master_bedside_left'), y: 0.48, variant: 'classic' })
  put('tableLamp', -6.74, 8.35, PI / 2, { ...bind('light.us_master_bedside_right'), y: 0.48, variant: 'globe' })
  put('smartButton', -6.62, 8.5, PI / 2, { ...bind('event.us_bedside_button'), y: 0.48 })
  put('rug', -5.4, 7, PI / 2, { len: 2.8, len2: 2.6, variant: 'rect', body: '#bfc3cf' })
  wall(master, 'right', 7.1, 'tv', { ...bind('media_player.us_master_tv'), variant: 'wall', y: 0.15 })
  wall(master, 'back', -5.6, 'dresser', { ...bind('light.us_master_dresser'), top: '#ffffff', body: '#8a5a3b' })
  put('diffuser', -5.25, 4.3, 0, { ...bind('humidifier.us_master_diffuser', 'light.us_master_diffuser_light'), y: 0.81, led: 'strip' })
  put('armchair', -2.5, 9.3, PI)
  put('floorLamp', -3.35, 9.6, 0, bind('light.us_master_floor_lamp'))
  put('airPurifier', -6.6, 4.45, 0, bind('fan.us_master_air_purifier', 'sensor.us_master_pm25'))
  put('ceilingFan', -4.3, 7, 0, { ...bind('fan.us_master_ceiling_fan', 'light.us_master_fan_light'), len: 1.4, variant: '4', led: 'under', top: '#7a5236', body: '#2a2c33' })
  wall(master, 'left', 7, 'painting', { body: '#dcb98c', y: 0.3 })
  wall(master, 'front', -5.9, 'window', { ...bind('cover.us_master_shades'), variant: 'roller', len: 1.2, body: '#eee3cc' })
  wall(master, 'front', -3.6, 'window', { ...bind('cover.us_master_shades'), variant: 'roller', len: 1.2, body: '#eee3cc' })
  wall(master, 'left', 9.35, 'window', { variant: 'curtain', len: 1.2, body: '#eee3cc' })
  wall(master, 'back', -3.3, 'tempSensor', bind('sensor.us_master_temperature', 'sensor.us_master_humidity'))
  wall(master, 'right', 9.4, 'motionSensor', bind('binary_sensor.us_master_motion'))

  /* --- master bath: bathtub, shower cabin, double vanity, medicine cabinet, toilet, towel warmer --- */
  wall(ensuite, 'front', -4.4, 'door')
  wall(ensuite, 'back', -6.15, 'bathtub')
  wall(ensuite, 'back', -6.05, 'window', { variant: 'zebra', len: 1, body: '#ffffff' })
  wall(ensuite, 'back', -4, 'shower', { shape: 'square', hinge: 'right' })
  wall(ensuite, 'left', 2, 'washbasin')
  wall(ensuite, 'left', 2.8, 'washbasin')
  wall(ensuite, 'left', 2, 'mirrorCabinet', bind('light.us_ensuite_cabinet'))
  wall(ensuite, 'left', 2.8, 'mirrorLight', bind('light.us_ensuite_mirror'))
  put('soapDispenser', -6.66, 2.2, PI / 2, { y: 0.8 })
  put('soapDispenser', -6.66, 3, PI / 2, { y: 0.8 })
  wall(ensuite, 'right', 2, 'toilet')
  wall(ensuite, 'right', 1.3, 'towelWarmer', bind('switch.us_ensuite_towel_warmer'))
  wall(ensuite, 'back', -4.9, 'wallFan', bind('fan.us_ensuite_exhaust'))
  put('rug', -5.3, 1.35, 0, { len: 0.9, len2: 0.55, body: '#dfe4ff' })
  put('leakSensor', -6.5, 2.4, 0, bind('binary_sensor.us_ensuite_leak'))
  put('ceilingLight', -5.25, 2.2, 0, { ...bind('light.us_ensuite'), variant: 'round' })

  /* --- walk-in closet --- */
  wall(closet, 'front', -2.5, 'door')
  wall(closet, 'left', 1.1, 'wardrobe', { top: '#ffffff', body: '#dcb98c' })
  wall(closet, 'right', 1.1, 'wardrobe', { top: '#ffffff', body: '#dcb98c' })
  wall(closet, 'back', -2.5, 'window', { variant: 'roller', len: 0.6, len2: 0.9, y: 0.4, body: '#ffffff' })
  wall(closet, 'left', 2.45, 'mirror', { variant: 'tall', body: '#ffffff' })
  put('laundryBasket', -3.15, 2.35, PI / 2)
  put('ceilingLight', -2.5, 2, 0, { ...bind('light.us_closet'), variant: 'square' })

  /* --- hall bath: bathtub, toilet, washbasin, radiator, towel warmer --- */
  wall(bath, 'back', -0.65, 'bathtub')
  wall(bath, 'back', 0.7, 'window', { variant: 'none', len: 0.8 })
  wall(bath, 'left', 1.6, 'toilet')
  wall(bath, 'right', 1.2, 'washbasin')
  wall(bath, 'right', 1.2, 'mirror', { variant: 'small', body: '#3a3f5c' })
  put('soapDispenser', 1.3, 1.35, -PI / 2, { y: 0.8 })
  wall(bath, 'right', 2.45, 'radiator', bind('switch.us_bath_radiator'))
  wall(bath, 'left', 2.7, 'towelWarmer', bind('switch.us_bath_towel_warmer'))
  put('ceilingLight', 0, 1.6, 0, { ...bind('light.us_hall_bath'), variant: 'round' })

  /* --- Ethan's room (gamer): desk, gaming chair, RGB lights, Xbox --- */
  put('bed', 4.6, 5 + WALL_IN + 1.05 + 0.02, 0, { led: 'none' })
  put('nightstand', 5.72, 5.27, 0)
  put('humidifier', 5.72, 5.27, 0, { y: 0.48 })
  wall(ethan, 'front', 3.3, 'desk', { len: 1.6, drawers: 'right', top: '#1f2440', body: '#1f2440' })
  put('gamingChair', 3.3, 8.6, 0, { body: '#1f2440', top: '#e2564b' })
  put('monitor', 3.3, 9.72, PI, { ...bind('switch.us_ethan_monitor', 'binary_sensor.us_ethan_pc'), y: 0.75 })
  put('keyboard', 3.3, 9.45, PI, { y: 0.75 })
  put('mousePad', 3.78, 9.45, PI, { y: 0.75 })
  put('mouse', 3.78, 9.45, PI, { y: 0.75 })
  put('deskLamp', 2.65, 9.72, PI, { ...bind('light.us_ethan_desk_lamp'), y: 0.75 })
  put('deskFan', 3.95, 9.72, PI, { ...bind('fan.us_ethan_desk_fan'), y: 0.75 })
  put('computer', 4.35, 9.6, PI, { ...bind('binary_sensor.us_ethan_pc'), variant: 'tower', len: 0.25 })
  wall(ethan, 'right', 7.6, 'tvUnit', { len: 1.6, top: '#1f2440', body: '#3a3f5c' })
  put('tv', 6 - WALL_IN - 0.1 - 0.01, 7.6, -PI / 2, { ...bind('media_player.us_ethan_tv'), y: 0.5, variant: 'stand' })
  put('console', 5.75, 8.2, -PI / 2, { ...bind('media_player.us_ethan_xbox'), y: 0.5, variant: 'xbox-h', len: 0.28 })
  wall(ethan, 'left', 8, 'wardrobe', { top: '#3f56e0', body: '#ffffff' })
  wall(ethan, 'back', 4.6, 'ledStrip', bind('light.us_ethan_led'))
  put('ceilingStrip', 3.75, 7.5, 0, { ...bind('light.us_ethan_rgb'), len: 4.2, len2: 4.7 })
  put('rug', 3.6, 7.55, 0, { variant: 'round', len: 1.6, len2: 1.6, body: '#34416c' })
  wall(ethan, 'front', 3.3, 'window', { variant: 'blinds', len: 1.2 })
  wall(ethan, 'right', 9.1, 'window', { variant: 'curtain', len: 1, body: '#34416c' })
  wall(ethan, 'back', 1.95, 'painting', { body: '#e2564b' })
  wall(ethan, 'front', 5.5, 'motionSensor', bind('binary_sensor.us_ethan_motion'))

  /* --- Mia's room: bed, desk, aquarium, cat bed, baby camera --- */
  put('bed', 6 - WALL_IN - 1.05 - 0.02, 1.6, -PI / 2, { ...bind('light.us_mia_headboard'), led: 'strip' })
  put('nightstand', 5.74, 2.85, -PI / 2)
  put('fishbowl', 5.74, 2.85, -PI / 2, { ...bind('light.us_mia_fishbowl'), y: 0.48 })
  wall(mia, 'front', 3.3, 'desk', { len: 1.2, drawers: 'left', top: '#ffffff', body: '#8fd8bd' })
  put('chair', 3.3, 3.9, 0)
  put('deskPlant', 2.85, 4.72, PI, { y: 0.75 })
  put('airQuality', 3.75, 4.72, PI, { ...bind('sensor.us_mia_pm25'), y: 0.75 })
  wall(mia, 'back', 1.85, 'wardrobeSingle', { top: '#f2b8c6', body: '#ffffff' })
  put('drawerUnit', 2.6, 0.33, 0, { top: '#ffffff', body: '#f2b8c6' })
  put('deskCamera', 2.6, 0.33, 0, { ...bind('camera.us_mia_camera'), y: 0.72, body: '#f4f4f6' })
  wall(mia, 'front', 5.1, 'aquarium', { ...bind('light.us_mia_aquarium', 'sensor.us_aquarium_temperature'), body: '#ffffff' })
  put('catTree', 2, 1.45, 0, { body: '#f2b8c6' })
  put('catBed', 3.15, 0.65, 0, { body: '#f2b8c6' })
  put('petToy', 3.6, 2.4, 0, { variant: 'mouse' })
  put('rug', 3.2, 2.3, 0, { variant: 'sheep', len: 0.9, len2: 1.2 })
  put('ceilingLight', 3.75, 2.5, 0, { ...bind('light.us_mia_ceiling'), variant: 'round' })
  wall(mia, 'back', 4.1, 'window', { variant: 'curtain', len: 1.2, body: '#f2b8c6' })
  wall(mia, 'right', 3.9, 'window', { variant: 'roller', len: 1, body: '#ffffff' })
  wall(mia, 'back', 3, 'wallSwitch', bind('light.us_mia_ceiling'))

  return { id: `${AMERICAN_LEVEL}-1`, name: t('Floor 1'), elevation: 1, rooms, items }
}

/** Plan of the American house (two floors, yards and street). A new object on every call. */
export function americanLayout(): Layout {
  return { version: 1, levels: [groundFloor(), upperFloor()], up: 0 }
}

/* ---------- Home Assistant demo entities ---------- */

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

/** Demo entity: id, state, name and attributes; changed min minutes ago. */
function ent(entity_id: string, state: string, name: string, attrs: Record<string, unknown> = {}, min = 120): HassEntity {
  return { entity_id, state, attributes: { friendly_name: name, ...attrs }, last_changed: ago(min) }
}

const warm = (b: number, k = 2700) => ({ brightness: b, color_mode: 'color_temp', color_temp_kelvin: k, supported_color_modes: ['color_temp', 'rgb'] })
const rgb = (b: number, c: [number, number, number]) => ({ brightness: b, color_mode: 'rgb', rgb_color: c, supported_color_modes: ['color_temp', 'rgb'] })
const light = (id: string, name: string, on: boolean, attrs: Record<string, unknown> = warm(200), min = 120) => ent(`light.${id}`, on ? 'on' : 'off', name, on ? attrs : { supported_color_modes: ['color_temp', 'rgb'] }, min)
const sw = (id: string, name: string, on: boolean, attrs: Record<string, unknown> = {}) => ent(`switch.${id}`, on ? 'on' : 'off', name, attrs)
const bin = (id: string, name: string, on: boolean, device_class: string, min = 120) => ent(`binary_sensor.${id}`, on ? 'on' : 'off', name, { device_class }, min)
const sensor = (id: string, name: string, value: number | string, device_class: string | null, unit: string) => ent(`sensor.${id}`, String(value), name, { ...(device_class ? { device_class } : {}), unit_of_measurement: unit, state_class: 'measurement' })
const media = (id: string, name: string, state: string, attrs: Record<string, unknown> = {}) => ent(`media_player.${id}`, state, name, { supported_features: 152463, ...attrs })
const cover = (id: string, name: string, pos: number, device_class: string, attrs: Record<string, unknown> = {}) =>
  ent(`cover.${id}`, pos > 0 ? 'open' : 'closed', name, { device_class, current_position: pos, supported_features: 15, ...attrs })
const bulbs = (b = 200) => warm(b)

/**
 * Demo entities of the American house (prefixed us_), with friendly names in the user's language. The house looks alive:
 * some lights on, the TV playing in the family room, the washer running (412 W), robot vacuum and mower at work, pool pump
 * on, one garage door open, mail in the mailbox. Motion in the kitchen and the family room (people go there), the office
 * PC on (someone sits at it).
 */
export function americanEntities(): HassEntity[] {
  return [
    // security and weather (first in the list, so the first alarm and weather are this home's)
    ent('alarm_control_panel.us_alarm', 'disarmed', t('Home Alarm'), { supported_features: 15, code_arm_required: false, code_format: null }),
    ent('weather.us_home', 'sunny', t('Home Weather'), { temperature: 21, humidity: 48, wind_speed: 9, temperature_unit: '°C', wind_speed_unit: 'km/h' }),
    // lights
    light('us_foyer_chandelier', t('Foyer Chandelier'), true, bulbs(190), 15),
    light('us_living_floor_lamp', t('Living Room Floor Lamp'), true, warm(170, 2400)),
    light('us_living_table_lamp', t('Living Room Table Lamp'), true, warm(120, 2400)),
    light('us_living_downlights', t('Living Room Downlights'), false),
    light('us_family_tv_backlight', t('Family Room TV Backlight'), true, rgb(220, [90, 120, 255])),
    light('us_family_fan_light', t('Family Room Fan Light'), true, bulbs(160), 8),
    light('us_family_floor_lamp', t('Family Room Floor Lamp'), false),
    light('us_kitchen_island', t('Kitchen Island Pendants'), true, warm(230, 3000), 6),
    light('us_kitchen_dining', t('Dining Pendant'), true, warm(180, 2700), 6),
    light('us_kitchen_downlights', t('Kitchen Downlights'), true, warm(255, 4000), 6),
    light('us_kitchen_counter_led', t('Under Cabinet LED'), true, warm(200, 3500), 6),
    light('us_office_track', t('Office Track Light'), true, warm(220, 4000), 40),
    light('us_office_desk_lamp', t('Office Desk Lamp'), true, warm(200, 4000), 40),
    light('us_half_bath', t('Powder Room Light'), false),
    light('us_pantry', t('Pantry Light'), false),
    light('us_laundry', t('Laundry Room Light'), true, warm(255, 4000), 30),
    light('us_garage', t('Garage Lights'), true, warm(255, 5000), 25),
    light('us_porch', t('Porch Lights'), true, warm(180, 2700)),
    light('us_garden_path', t('Garden Path Lights'), true, warm(150, 2700)),
    light('us_deck_string_lights', t('Deck String Lights'), true, warm(200, 2200)),
    light('us_deck_light', t('Deck Lights'), false),
    light('us_pool_light', t('Pool Light'), true, rgb(255, [40, 160, 255])),
    light('us_pool_path', t('Pool Path Light'), false),
    light('us_street_lamp', t('Street Lamp'), true, warm(255, 3000)),
    light('us_reading_lamp', t('Reading Nook Lamp'), false),
    light('us_hall_sconce', t('Upstairs Hall Sconce'), true, warm(140, 2700)),
    light('us_upstairs_hall', t('Upstairs Hall Downlights'), false),
    light('us_master_headboard', t('Master Headboard'), true, warm(120, 2400)),
    light('us_master_bedside_left', t('Bedside Lamp Left'), true, warm(130, 2400)),
    light('us_master_bedside_right', t('Bedside Lamp Right'), false),
    light('us_master_dresser', t('Dresser Mirror Light'), false),
    light('us_master_diffuser_light', t('Diffuser Light'), true, rgb(160, [255, 170, 90])),
    light('us_master_fan_light', t('Master Fan Light'), false),
    light('us_master_floor_lamp', t('Master Floor Lamp'), false),
    light('us_ensuite', t('Master Bath Light'), false),
    light('us_ensuite_cabinet', t('Medicine Cabinet Light'), false),
    light('us_ensuite_mirror', t('Vanity Mirror Light'), true, warm(220, 4000)),
    light('us_closet', t('Walk-in Closet Light'), false),
    light('us_hall_bath', t('Hall Bath Light'), false),
    light('us_ethan_rgb', t('Ethan Ceiling RGB'), true, rgb(200, [150, 60, 255])),
    light('us_ethan_led', t('Ethan LED Strip'), true, rgb(230, [255, 40, 160])),
    light('us_ethan_desk_lamp', t('Ethan Desk Lamp'), false),
    light('us_mia_ceiling', t('Mia Ceiling Light'), false),
    light('us_mia_headboard', t('Mia Headboard Light'), true, rgb(120, [255, 150, 200])),
    light('us_mia_fishbowl', t('Mia Fishbowl Light'), true, rgb(180, [120, 220, 255])),
    light('us_mia_aquarium', t('Mia Aquarium Light'), true, rgb(200, [80, 200, 255])),
    // switches and plugs
    sw('us_family_plug', t('Family Room Smart Plug'), true),
    sw('us_fireplace', t('Fireplace'), true),
    sw('us_router', t('Router'), true),
    sw('us_washer', t('Washer'), true),
    sw('us_dryer', t('Dryer'), false),
    sw('us_dishwasher', t('Dishwasher'), false),
    sw('us_coffee_machine', t('Coffee Maker'), true),
    sw('us_kettle', t('Electric Kettle'), false),
    sw('us_microwave', t('Microwave'), false),
    sw('us_air_fryer', t('Air Fryer'), false),
    sw('us_pet_feeder', t('Smart Pet Feeder'), false),
    sw('us_water_dispenser', t('Water Dispenser'), true),
    sw('us_office_monitor', t('Office Monitors'), true),
    sw('us_office_power_strip', t('Office Power Strip'), true, { device_class: 'outlet' }),
    sw('us_printer', t('Printer'), false),
    sw('us_nas', 'NAS', true),
    sw('us_ev_charger', t('EV Charger'), true),
    sw('us_garage_outlet_1', t('Garage Outlet 1'), true, { device_class: 'outlet' }),
    sw('us_garage_outlet_2', t('Garage Outlet 2'), false, { device_class: 'outlet' }),
    sw('us_home_battery_backup', t('Battery Storm Watch'), false),
    sw('us_garage_heater', t('Garage Heater'), false),
    sw('us_grill', t('Gas Grill'), false),
    sw('us_pool_pump', t('Pool Pump'), true),
    sw('us_hot_tub', t('Hot Tub'), true),
    sw('us_fountain', t('Garden Fountain'), true),
    sw('us_ensuite_towel_warmer', t('Master Bath Towel Warmer'), true),
    sw('us_bath_towel_warmer', t('Hall Bath Towel Warmer'), false),
    sw('us_bath_radiator', t('Hall Bath Radiator'), false),
    sw('us_ethan_monitor', t('Ethan Monitor'), true),
    // media
    media('us_family_tv', t('Family Room TV'), 'playing', { volume_level: 0.32, source: 'Netflix', media_title: 'Saturday Night Football', app_name: 'Netflix', source_list: ['Netflix', 'YouTube', 'Live TV'] }),
    media('us_family_soundbar', t('Family Room Soundbar'), 'playing', { volume_level: 0.4, source: 'TV' }),
    media('us_family_ps5', 'PlayStation 5', 'off'),
    media('us_living_projector', t('Living Room Projector'), 'off'),
    media('us_living_sonos', t('Living Room Sonos'), 'paused', { volume_level: 0.25, media_title: 'Fly Me to the Moon', media_artist: 'Frank Sinatra' }),
    media('us_kitchen_homepod', t('Kitchen HomePod'), 'playing', { volume_level: 0.3, media_title: 'Sweet Home Alabama', media_artist: 'Lynyrd Skynyrd' }),
    media('us_kitchen_echo', t('Kitchen Echo'), 'idle', { volume_level: 0.4 }),
    media('us_master_tv', t('Master Bedroom TV'), 'off'),
    media('us_ethan_tv', t('Ethan TV'), 'on', { volume_level: 0.2, source: 'Xbox' }),
    media('us_ethan_xbox', 'Xbox Series S', 'on'),
    // climate
    ent('climate.us_thermostat', 'cool', t('Central Air'), {
      hvac_modes: ['off', 'heat', 'cool', 'heat_cool', 'fan_only'],
      hvac_action: 'cooling',
      current_temperature: 24.1,
      temperature: 23,
      min_temp: 16,
      max_temp: 30,
      target_temp_step: 0.5,
      fan_modes: ['auto', 'low', 'high'],
      fan_mode: 'auto',
      supported_features: 9,
    }),
    ent('climate.us_office_ac', 'off', t('Office Mini Split'), { hvac_modes: ['off', 'cool', 'heat', 'dry', 'fan_only'], hvac_action: 'off', current_temperature: 23.4, temperature: 22, supported_features: 1 }),
    ent('climate.us_boiler', 'heat', t('Gas Boiler'), { hvac_modes: ['off', 'heat'], hvac_action: 'idle', current_temperature: 21.2, temperature: 21, target_temp_step: 0.5, supported_features: 1 }),
    ent('water_heater.us_water_heater', 'eco', t('Water Heater'), { operation_list: ['eco', 'electric', 'performance', 'off'], operation_mode: 'eco', temperature: 50, current_temperature: 48, min_temp: 35, max_temp: 65, supported_features: 3 }),
    ent('fan.us_family_ceiling_fan', 'on', t('Family Room Ceiling Fan'), { percentage: 40, percentage_step: 20, supported_features: 1 }, 8),
    ent('fan.us_master_ceiling_fan', 'off', t('Master Ceiling Fan'), { percentage: 0, percentage_step: 25, supported_features: 1 }),
    ent('fan.us_master_air_purifier', 'on', t('Master Air Purifier'), { percentage: 30, preset_modes: ['auto', 'sleep', 'turbo'], preset_mode: 'auto', supported_features: 9 }),
    ent('fan.us_garage_fan', 'off', t('Garage Floor Fan'), { percentage: 0, supported_features: 1 }),
    ent('fan.us_garage_exhaust', 'off', t('Garage Exhaust Fan'), { percentage: 0, supported_features: 1 }),
    ent('fan.us_ensuite_exhaust', 'off', t('Master Bath Exhaust'), { percentage: 0, supported_features: 1 }),
    ent('fan.us_ethan_desk_fan', 'on', t('Ethan Desk Fan'), { percentage: 50, oscillating: true, supported_features: 3 }),
    ent('humidifier.us_master_diffuser', 'on', t('Master Diffuser'), { humidity: 50, mode: 'normal', available_modes: ['normal', 'eco'] }),
    ent('humidifier.us_laundry_dehumidifier', 'on', t('Laundry Dehumidifier'), { device_class: 'dehumidifier', humidity: 45, current_humidity: 55 }),
    // cleaning and garden
    ent('vacuum.us_robot', 'cleaning', 'Roomba', { battery_level: 72, fan_speed: 'Standard', supported_features: 14204 }, 4),
    ent('vacuum.us_stick_vacuum', 'docked', t('Dyson Stick Vacuum'), { battery_level: 100, supported_features: 12 }),
    ent('lawn_mower.us_mower', 'mowing', t('Robot Mower'), { supported_features: 7 }, 10),
    ent('valve.us_main_water', 'open', t('Main Water Valve'), { current_position: 100, reports_position: false, supported_features: 3 }),
    ent('valve.us_front_sprinkler', 'open', t('Front Lawn Sprinklers'), { current_position: 100, reports_position: false, supported_features: 3 }, 12),
    ent('valve.us_back_sprinkler', 'closed', t('Backyard Sprinklers'), { current_position: 0, reports_position: false, supported_features: 3 }),
    ent('valve.us_flower_bed_drip', 'closed', t('Flower Bed Drip'), { current_position: 0, reports_position: false, supported_features: 3 }),
    ent('valve.us_outdoor_shower', 'closed', t('Pool Shower'), { current_position: 0, reports_position: false, supported_features: 3 }),
    // covers and locks
    cover('us_garage_door_left', t('Garage Door Left'), 100, 'garage', { supported_features: 3 }),
    cover('us_garage_door_right', t('Garage Door Right'), 0, 'garage', { supported_features: 3 }),
    cover('us_deck_awning', t('Deck Awning'), 80, 'awning'),
    cover('us_living_blinds', t('Living Room Blinds'), 70, 'blind', { current_tilt_position: 60, supported_features: 255 }),
    cover('us_master_shades', t('Master Bedroom Shades'), 100, 'shade'),
    cover('us_living_screen', t('Projector Screen'), 0, 'shade'),
    ent('lock.us_front_door', 'locked', t('Front Door Lock')),
    ent('lock.us_back_door', 'locked', t('Back Door Lock')),
    ent('lock.us_side_gate', 'locked', t('Side Gate Lock')),
    ent('lock.us_suv', 'locked', t('SUV Doors')),
    // binary sensors
    bin('us_front_door', t('Front Door'), false, 'door'),
    bin('us_patio_door', t('Patio Door'), false, 'door'),
    bin('us_back_door', t('Back Door'), false, 'door'),
    bin('us_garage_entry', t('Garage Entry Door'), false, 'door'),
    bin('us_front_gate', t('Front Gate'), false, 'door'),
    bin('us_shed_door', t('Shed Door'), false, 'door'),
    bin('us_living_window', t('Living Room Window'), false, 'window'),
    bin('us_foyer_motion', t('Foyer Motion'), false, 'motion'),
    bin('us_kitchen_motion', t('Kitchen Motion'), true, 'motion', 1),
    bin('us_family_motion', t('Family Room Motion'), true, 'motion', 2),
    bin('us_office_motion', t('Office Motion'), false, 'motion'),
    bin('us_garage_motion', t('Garage Motion'), false, 'motion'),
    bin('us_upstairs_motion', t('Upstairs Hall Motion'), false, 'motion'),
    bin('us_master_motion', t('Master Bedroom Motion'), false, 'motion'),
    bin('us_ethan_motion', t('Ethan Room Motion'), false, 'occupancy'),
    bin('us_office_pc', t('Office PC'), true, 'connectivity', 50),
    bin('us_ethan_pc', t('Ethan PC'), false, 'connectivity'),
    bin('us_laundry_leak', t('Laundry Leak Sensor'), false, 'moisture'),
    bin('us_garage_leak', t('Water Heater Leak Sensor'), false, 'moisture'),
    bin('us_ensuite_leak', t('Master Bath Leak Sensor'), false, 'moisture'),
    bin('us_kitchen_gas', t('Kitchen Gas Detector'), false, 'gas'),
    bin('us_hall_smoke', t('Upstairs Smoke Detector'), false, 'smoke'),
    bin('us_washer_vibration', t('Washer Vibration'), true, 'vibration', 20),
    // Mailbox: no device_class (the demo source toggles door/opening sensors now and then; the mail must not vanish)
    ent('binary_sensor.us_mailbox', 'on', t('Mailbox'), {}, 45),
    bin('us_suv_charging', t('SUV Charging'), true, 'battery_charging', 60),
    // measurements
    sensor('us_washer_power', t('Washer Power'), 412, 'power', 'W'),
    sensor('us_dryer_power', t('Dryer Power'), 0, 'power', 'W'),
    sensor('us_dishwasher_power', t('Dishwasher Power'), 0, 'power', 'W'),
    sensor('us_ev_charger_power', t('EV Charger Power'), 7200, 'power', 'W'),
    sensor('us_home_power', t('Home Power'), 3950, 'power', 'W'),
    sensor('us_solar_power', t('Solar Production'), 4100, 'power', 'W'),
    sensor('us_home_battery', 'Powerwall', 76, 'battery', '%'),
    sensor('us_suv_battery', t('SUV Battery'), 64, 'battery', '%'),
    sensor('us_ebike_battery', t('E-Bike Battery'), 88, 'battery', '%'),
    sensor('us_kitchen_tablet_battery', t('Kitchen Dashboard Tablet'), 91, 'battery', '%'),
    sensor('us_pet_feeder_food', t('Pet Feeder Food Level'), 68, null, '%'),
    sensor('us_living_temperature', t('Living Room Temperature'), 22.8, 'temperature', '°C'),
    sensor('us_living_humidity', t('Living Room Humidity'), 46, 'humidity', '%'),
    sensor('us_master_temperature', t('Master Bedroom Temperature'), 21.9, 'temperature', '°C'),
    sensor('us_master_humidity', t('Master Bedroom Humidity'), 48, 'humidity', '%'),
    sensor('us_office_temperature', t('Office Temperature'), 23.4, 'temperature', '°C'),
    sensor('us_outdoor_temperature', t('Outdoor Temperature'), 21, 'temperature', '°C'),
    sensor('us_wind_speed', t('Wind Speed'), 9, 'wind_speed', 'km/h'),
    sensor('us_pool_temperature', t('Pool Water Temperature'), 27.5, 'temperature', '°C'),
    sensor('us_hot_tub_temperature', t('Hot Tub Temperature'), 38.5, 'temperature', '°C'),
    sensor('us_aquarium_temperature', t('Aquarium Temperature'), 25.2, 'temperature', '°C'),
    sensor('us_office_co2', t('Office CO2'), 612, 'carbon_dioxide', 'ppm'),
    sensor('us_mia_pm25', t('Mia Room PM2.5'), 6, 'pm25', 'µg/m³'),
    sensor('us_master_pm25', t('Master Bedroom PM2.5'), 4, 'pm25', 'µg/m³'),
    // locations, cameras, sirens, button
    ent('device_tracker.us_suv', 'home', t('SUV'), { source_type: 'gps' }),
    ent('device_tracker.us_sedan', 'home', t('Sedan'), { source_type: 'gps' }),
    ent('device_tracker.us_motorcycle', 'home', t('Motorcycle'), { source_type: 'gps' }),
    ent('device_tracker.us_ebike', 'home', t('E-Bike'), { source_type: 'gps' }),
    ent('camera.us_doorbell', 'idle', t('Front Doorbell'), { brand: 'Ring' }),
    ent('camera.us_porch', 'streaming', t('Porch Camera'), {}),
    ent('camera.us_garage', 'idle', t('Garage Camera'), {}),
    ent('camera.us_backyard', 'recording', t('Backyard Camera'), {}),
    ent('camera.us_mia_camera', 'streaming', t('Mia Baby Camera'), {}),
    ent('siren.us_garage_siren', 'off', t('Garage Siren'), {}),
    ent('siren.us_upstairs_siren', 'off', t('Upstairs Siren'), {}),
    ent('event.us_bedside_button', ago(300), t('Bedside Button'), { event_type: 'single', event_types: ['single', 'double', 'long'] }),
  ]
}
