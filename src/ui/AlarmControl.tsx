import { House, Luggage, Moon, Shield, ShieldOff, Siren, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { alarmAction, type AlarmService } from '@/ha/actions'
import { isUnavailable, num, stateLabel } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { t } from '@/i18n'

/*
 * Security system (alarm_control_panel): every mode the panel has can be set. The modes come from the entity's
 * supported_features bits, so a mode Home Assistant would not accept is not shown (e.g. a manual alarm whose arming_states
 * are only away and night). Without that info (old integrations): home, away, night. A panel that asks for a code
 * (code_format) gets a code field; the code is sent when arming too if that needs it (code_arm_required). Trigger (TRIGGER
 * bit): when triggered the home shows a visual alarm (scene/AlarmFlash.tsx, ui/AlarmBanner).
 */

/** Whether it supports triggering (AlarmControlPanelEntityFeature.TRIGGER) */
export const canTrigger = (e: HassEntity) => ((num(e.attributes.supported_features) ?? 0) & 8) !== 0

export interface AlarmMode {
  feature: number
  state: string
  service: AlarmService
  label: string
  Icon: LucideIcon
}
const MODES: AlarmMode[] = [
  { feature: 1, state: 'armed_home', service: 'alarm_arm_home', label: t('Home'), Icon: House },
  { feature: 2, state: 'armed_away', service: 'alarm_arm_away', label: t('Away'), Icon: Shield },
  { feature: 4, state: 'armed_night', service: 'alarm_arm_night', label: t('Night'), Icon: Moon },
  { feature: 32, state: 'armed_vacation', service: 'alarm_arm_vacation', label: t('Vacation'), Icon: Luggage },
  { feature: 16, state: 'armed_custom_bypass', service: 'alarm_arm_custom_bypass', label: t('Custom'), Icon: SlidersHorizontal },
]

/** Arming modes the entity supports (HA AlarmControlPanelEntityFeature) */
export function alarmModes(e: HassEntity): AlarmMode[] {
  const f = num(e.attributes.supported_features)
  return MODES.filter((m) => (f == null ? m.feature <= 4 : (f & m.feature) !== 0))
}

/** Color of the state: triggered red, arming / pending orange, armed brand color, disarmed gray */
export function alarmTone(state: string) {
  if (state === 'triggered') return 'bg-miss text-white'
  if (state === 'arming' || state === 'pending') return 'bg-warn-50 text-warn'
  if (state.startsWith('armed')) return 'bg-brand-50 text-brand'
  return 'bg-surface-2 text-ink-2'
}

export function AlarmControl({ e }: { e: HassEntity }) {
  const [code, setCode] = useState('')
  const dead = isUnavailable(e)
  const needCode = Boolean(e.attributes.code_format)
  const armCode = needCode && e.attributes.code_arm_required !== false
  const run = (service: AlarmService) => {
    const withCode = service === 'alarm_disarm' ? needCode : armCode
    void alarmAction(e, service, withCode ? code : undefined)
    setCode('')
  }
  const btn = (key: string, label: string, Icon: LucideIcon, active: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      disabled={dead}
      data-alarm={key}
      onClick={onClick}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[12px] font-semibold transition-colors disabled:opacity-50 ${active ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
    >
      <Icon size={18} />
      {label}
    </button>
  )
  return (
    <div className="grid gap-3">
      <p className={`flex items-center justify-between rounded-xl px-3 py-2 text-[13px] font-semibold ${alarmTone(e.state)}`}>
        <span>{stateLabel(e)}</span>
        {typeof e.attributes.changed_by === 'string' && e.attributes.changed_by && <span className="text-[11px] font-medium opacity-80">{e.attributes.changed_by}</span>}
      </p>
      {needCode && (
        <input
          type="password"
          inputMode={e.attributes.code_format === 'number' ? 'numeric' : 'text'}
          autoComplete="off"
          value={code}
          onChange={(ev) => setCode(ev.target.value)}
          placeholder={armCode ? t('Alarm code (to arm and disarm)') : t('Alarm code (to disarm)')}
          className="min-h-11 rounded-xl border border-line bg-surface px-3 font-mono text-[15px] tracking-widest outline-none focus:border-brand"
        />
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {btn('disarmed', t('Disarmed'), ShieldOff, e.state === 'disarmed', () => run('alarm_disarm'))}
        {alarmModes(e).map((m) => btn(m.state, m.label, m.Icon, e.state === m.state, () => run(m.service)))}
        {canTrigger(e) && (
          <button
            type="button"
            disabled={dead}
            data-alarm="triggered"
            onClick={() => run('alarm_trigger')}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[12px] font-semibold transition-colors disabled:opacity-50 ${e.state === 'triggered' ? 'bg-miss text-white' : 'bg-miss-50 text-miss hover:brightness-95'}`}
          >
            <Siren size={18} />
            {t('Trigger')}
          </button>
        )}
      </div>
    </div>
  )
}
