import { DoorOpen, Lightbulb, type LucideIcon, Plug, ShieldHalf, Thermometer } from 'lucide-react'
import { useState } from 'react'
import { stateLabel } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'
import { AlarmControl, alarmTone } from './AlarmControl'
import { fmt, type HomeTotals } from './useHome'
import { WeatherTile } from './WeatherTile'

function Tile({ icon: Icon, label, value, sub, hot }: { icon: LucideIcon; label: string; value: string; sub: string; hot?: boolean }) {
  return (
    <div className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-3 xl:gap-3 xl:py-2.5 xl:pl-2.5 xl:pr-4">
      <div className={`grid size-9 place-items-center rounded-xl xl:size-11 ${hot ? 'bg-sun-50 text-sun' : 'icon-tile'}`}>
        <Icon className="size-[18px] xl:size-5" strokeWidth={2.2} />
      </div>
      <div className="leading-tight">
        <p className="text-[12px] font-medium text-ink-2">{label}</p>
        <p className="font-mono text-[16px] font-semibold tabular-nums xl:text-[19px]">{value}</p>
        <p className="hidden text-[11px] text-ink-3 xl:block">{sub}</p>
      </div>
    </div>
  )
}

/** Security tile: the mode of the Home Assistant alarm; clicking opens the mode buttons below (AlarmControl). Hidden without an alarm. */
function SecurityTile() {
  const alarm = useHa((s) => Object.values(s.entities).find((e) => e.entity_id.startsWith('alarm_control_panel.')))
  const [open, setOpen] = useState(false)
  if (!alarm) return null
  const tone = alarmTone(alarm.state)
  return (
    <div className="relative">
      <button type="button" id="kpi-security" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-3 text-left xl:gap-3 xl:py-2.5 xl:pl-2.5 xl:pr-4">
        <div className={`grid size-9 place-items-center rounded-xl xl:size-11 ${alarm.state === 'disarmed' ? 'icon-tile' : tone}`}>
          <ShieldHalf className="size-[18px] xl:size-5" strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <p className="text-[12px] font-medium text-ink-2">{t('Security')}</p>
          <p className="font-mono text-[16px] font-semibold xl:text-[19px]">{stateLabel(alarm)}</p>
          <p className="hidden text-[11px] text-ink-3 xl:block">{open ? t('click to close') : t('change mode')}</p>
        </div>
      </button>
      {open && (
        <div className="glass absolute left-0 top-[calc(100%+8px)] w-[300px] rounded-2xl p-3" role="dialog" aria-label={t('Security mode')}>
          <AlarmControl e={alarm} />
        </div>
      )}
    </div>
  )
}

export default function KpiTiles({ totals }: { totals: HomeTotals }) {
  return (
    // Also shown at laptop widths (1024-1280): smaller tiles that wrap without running into the right panel and the controls.
    // When the right panel narrows or closes (ui/panelState.ts, --panel) the tiles widen; the quick pill avoids them (#kpi-tiles).
    // Only the tiles take the pointer: when they wrap, the empty end of the second row lets the scene below be hovered
    <div id="kpi-tiles" className="pointer-events-none absolute left-4 top-4 z-30 hidden max-w-[calc(100%-var(--panel)-76px)] flex-wrap gap-2 *:pointer-events-auto lg:flex xl:gap-3">
      <Tile icon={Lightbulb} label={t('Lights on')} value={`${totals.lightsOn}/${totals.lights}`} sub={t('lights in the plan')} hot={totals.lightsOn > 0} />
      <Tile icon={Thermometer} label={t('Average temperature')} value={`${fmt(totals.avgTemp)}°`} sub={t('rooms with sensors')} />
      <WeatherTile />
      <Tile icon={DoorOpen} label={t('Doors / windows')} value={totals.openings ? t('{count} open', { count: totals.openings }) : t('Closed')} sub={t('the ones with sensors')} hot={totals.openings > 0} />
      <Tile icon={Plug} label={t('Devices running')} value={String(totals.devicesOn)} sub={t('plugs, TVs, climate')} />
      <SecurityTile />
    </div>
  )
}
