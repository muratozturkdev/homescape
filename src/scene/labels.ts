/**
 * DOM labels anchored to 3D positions. drei Html is not used because it opens a separate React root per label
 * (problematic in React 19); labels are drawn in a single DOM layer (ui/PinLayer) and LabelProjector writes their
 * positions every frame.
 */
import { kick } from './frame'

const elements = new Map<string, HTMLElement>()

export function registerLabel(id: string, el: HTMLElement | null) {
  if (el) {
    elements.set(id, el)
    kick() // with on-demand rendering a new label requests a frame too, so it gets positioned
  } else elements.delete(id)
}

export function labelEntries() {
  return elements
}
