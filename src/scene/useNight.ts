import { useHa } from '@/ha/store'
import { useLayout } from '@/model/layoutStore'

/** Night mode: the user's choice; in "auto" it is night while sun.sun in HA is below the horizon. */
export function useNight() {
  const theme = useLayout((s) => s.theme)
  const sunDown = useHa((s) => s.entities['sun.sun']?.state === 'below_horizon')
  return theme === 'night' || (theme === 'auto' && sunDown)
}
