import type { Object3D } from 'three'

/**
 * Scene groups of the items the quick on/off pill can attach to (ItemNode registers them, scene/QuickAnchor.tsx reads
 * them): the pill is placed by the screen box of the item it is shown for.
 */
export const quickObjects = new Map<string, Object3D>()
