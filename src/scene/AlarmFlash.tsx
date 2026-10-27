import { useFrame } from '@react-three/fiber'
import { useHa } from '@/ha/store'
import { useAmbient } from './kit/effects'
import { alarmTriggered, pulseAlarmLights } from './roomLights'

/**
 * While the alarm is triggered, the red alarm light in every room (roomLights.ts) blinks, so the alarm is visible all over
 * the house. Requests frames only while triggered.
 */
export function AlarmFlash() {
  const triggered = useHa((s) => alarmTriggered(s.entities))
  useAmbient(triggered)
  useFrame(({ clock }) => {
    if (triggered) pulseAlarmLights(0.2 + 0.8 * Math.pow(Math.abs(Math.sin(clock.elapsedTime * 3.2)), 1.4))
  })
  return null
}
