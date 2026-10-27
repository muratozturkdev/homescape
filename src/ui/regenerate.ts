import { useHa } from '@/ha/store'
import { generateLayout } from '@/model/generate'
import { useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'

/** Rebuilds the plan from the areas of the connected source (demo or live HA); the old plan goes into the undo history */
export function regenerateFromHa() {
  const { registry, entities } = useHa.getState()
  const reg = registry ?? { areas: [], entityArea: {}, skip: [] }
  const { layout, unplaced } = generateLayout(reg, entities)
  useLayout.getState().setLayout(layout, unplaced)
  useView.getState().request({ kind: 'house' })
}
