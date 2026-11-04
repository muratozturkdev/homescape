import type { HaSnapshot } from '@/ha/types'
import { msg, t } from '@/i18n'
import sample from './sample-snapshot.json'

/*
 * Data of the demo source: a local snapshot (not in git) when there is one, else the bundled sample home (always the
 * sample in automated browsers).
 * local-snapshot.json is a read-only copy of the developer's own HA and is real data: never translated, and only read on
 * the development server, so a production build can never contain it. The sample is
 * English source text; its area names, entity names and media titles are shown in the user's language.
 */
const local = import.meta.env.DEV ? import.meta.glob<{ default: HaSnapshot }>('./local-snapshot.json', { eager: true }) : {}

/** Texts of sample-snapshot.json (registered here for the key extractor; keep in sync with the JSON) */
const SAMPLE_TEXTS = new Set([
  msg('Living Room'),
  msg('Kitchen'),
  msg('Bedroom'),
  msg('Bathroom'),
  msg('Entrance'),
  msg('Office'),
  msg('Living Room Chandelier'),
  msg('Floor Lamp'),
  msg('TV Backlight LED'),
  msg('Living Room TV'),
  msg('Documentary'),
  msg('Living Room AC'),
  msg('Diffuser'),
  msg('Living Room Temperature'),
  msg('Living Room Humidity'),
  msg('Living Room Occupancy'),
  msg('Robot Vacuum'),
  msg('Kitchen Ceiling Lamp'),
  msg('Counter LED'),
  msg('Kitchen Window'),
  msg('Kitchen Temperature'),
  msg('Bedroom Chandelier'),
  msg('Headboard Light'),
  msg('Bedroom Outlet'),
  msg('Curtain'),
  msg('Mirror Light'),
  msg('Bathroom Motion'),
  msg('Bathroom Humidity'),
  msg('Entrance Wall Light'),
  msg('Front Door'),
  msg('Home Alarm'),
  msg('Desk Lamp'),
  msg('Monitors'),
  msg('Fan'),
  msg('Office Camera'),
  msg('Sun'),
])

const tr = (v: unknown) => (typeof v === 'string' && SAMPLE_TEXTS.has(v) ? t(v) : v)

/** The bundled sample in the user's language */
function localized(s: HaSnapshot): HaSnapshot {
  return {
    ...s,
    areas: s.areas.map((a) => ({ ...a, name: tr(a.name) as string })),
    entities: s.entities.map((e) => {
      const attributes: Record<string, unknown> = { ...e.attributes, friendly_name: tr(e.attributes.friendly_name) }
      if (attributes.media_title != null) attributes.media_title = tr(attributes.media_title)
      return { ...e, attributes }
    }),
  }
}

/** Automated browsers (the regression tests) always get the bundled sample, so results do not depend on a local snapshot */
const own = typeof navigator !== 'undefined' && navigator.webdriver ? undefined : Object.values(local)[0]?.default

export const DEMO_SNAPSHOT: HaSnapshot = own ?? localized(sample as HaSnapshot)
export const DEMO_IS_LOCAL = Boolean(own)
