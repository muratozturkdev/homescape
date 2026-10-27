import { Siren } from 'lucide-react'
import { useState } from 'react'
import { alarmAction } from '@/ha/actions'
import { friendlyName } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'

/**
 * Alarm triggered: a red pulse on the screen edges and an "Alarm is sounding" strip at the top; "Disarm alarm" disarms it
 * (with a code field on a panel that asks for a code). In the scene every room flashes red (scene/AlarmFlash.tsx).
 */
export function AlarmBanner() {
  const alarm = useHa((s) => Object.values(s.entities).find((e) => e.entity_id.startsWith('alarm_control_panel.') && e.state === 'triggered'))
  const [code, setCode] = useState('')
  if (!alarm) return null
  const needCode = Boolean(alarm.attributes.code_format)
  return (
    <>
      <div className="alarm-vignette pointer-events-none absolute inset-0 z-40" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-[124px] z-50 flex justify-center px-4 lg:pr-(--panel)">
        <div role="alert" className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-miss py-2 pl-4 pr-2 text-white shadow-lg">
          <Siren size={20} className="animate-pulse" />
          <span className="text-[14px] font-semibold">{t('Alarm is sounding')}</span>
          <span className="hidden text-[12px] opacity-85 sm:inline">{friendlyName(alarm)}</span>
          {needCode && (
            <input
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('Code')}
              className="w-24 rounded-lg bg-white/20 px-2 py-1.5 text-[13px] text-white placeholder:text-white/70 outline-none"
            />
          )}
          <button
            type="button"
            onClick={() => {
              void alarmAction(alarm, 'alarm_disarm', needCode ? code : undefined)
              setCode('')
            }}
            className="rounded-xl bg-white px-3 py-1.5 text-[13px] font-semibold text-miss hover:bg-white/90"
          >
            {t('Disarm alarm')}
          </button>
        </div>
      </div>
    </>
  )
}
