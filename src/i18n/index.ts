/*
 * Internationalization.
 *
 * Strings in the code are written in English and wrapped in t(); the English text itself is the key, so the code reads
 * naturally and English needs no dictionary. Translations live in ./locales/<code>.json, mapping the English text to the
 * translated text. A value is either a string or, for counted phrases (tn), an object of plural forms keyed by
 * Intl.PluralRules categories (zero, one, two, few, many, other).
 *
 * The language is chosen once at startup: the saved choice (language menu), else the Home Assistant user's language when
 * Homescape runs inside Home Assistant, else the first supported device language (navigator.languages), else English.
 * main.tsx loads the dictionary before it imports the app, so module-level t() calls are translated too. Changing the
 * language saves the choice and reloads the page.
 */

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
] as const

export type Lang = (typeof LANGUAGES)[number]['code']
type Plural = Partial<Record<Intl.LDMLPluralRule, string>>
type Entry = string | Plural

const SAVED_KEY = 'homescape-lang'
const CODES = new Set<string>(LANGUAGES.map((l) => l.code))

let lang: Lang = 'en'
let dict: Record<string, Entry> = {}
let rules = new Intl.PluralRules('en')

/** Base language of a BCP 47 tag if Homescape supports it ("pt-BR" -> "pt", "zh-Hant-TW" -> "zh") */
export function supported(tag: string | null | undefined): Lang | null {
  if (!tag) return null
  const base = tag.toLowerCase().split(/[-_]/)[0]
  return CODES.has(base) ? (base as Lang) : null
}

/** Saved choice from the language menu (null: automatic) */
export function savedLang(): Lang | null {
  try {
    return supported(localStorage.getItem(SAVED_KEY))
  } catch {
    return null
  }
}

/** Language of the Home Assistant user when Homescape is shown inside Home Assistant (same origin iframe) */
function hostLang(): Lang | null {
  try {
    if (window.parent === window) return null
    const ha = window.parent.document.querySelector('home-assistant') as (Element & { hass?: { language?: string } }) | null
    return supported(ha?.hass?.language)
  } catch {
    return null
  }
}

/** First supported device language, else English */
export function deviceLang(): Lang {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    const l = supported(tag)
    if (l) return l
  }
  return 'en'
}

const loaders = import.meta.glob<{ default: Record<string, Entry> }>('./locales/*.json')

/** Picks the language and loads its dictionary; main.tsx awaits this before importing the app */
export async function initI18n() {
  lang = savedLang() ?? hostLang() ?? deviceLang()
  rules = new Intl.PluralRules(lang)
  document.documentElement.lang = lang
  const load = loaders[`./locales/${lang}.json`]
  if (load) {
    try {
      dict = (await load()).default
    } catch {
      dict = {}
    }
  }
}

/**
 * Runs `fn` with another language's dictionary, so the texts it makes come out in that language. For the few places that
 * need the same default text in two languages, like the sample home's names (demo/demoHomes.ts). `fn` must be synchronous.
 * Null if that dictionary cannot be loaded.
 */
export async function inLanguage<T>(code: Lang, fn: () => T): Promise<T | null> {
  let other: Record<string, Entry> = {}
  if (code !== 'en') {
    const load = loaders[`./locales/${code}.json`]
    if (!load) return null
    try {
      other = (await load()).default
    } catch {
      return null
    }
  }
  const saved = { dict, lang, rules }
  dict = other
  lang = code
  rules = new Intl.PluralRules(code)
  try {
    return fn()
  } finally {
    ;({ dict, lang, rules } = saved)
  }
}

/** Current language code (also a valid BCP 47 locale for Intl and toLocaleString) */
export const currentLang = () => lang

/** Saves the language choice (null: automatic) and reloads the page */
export function setLang(code: Lang | null) {
  try {
    if (code) localStorage.setItem(SAVED_KEY, code)
    else localStorage.removeItem(SAVED_KEY)
  } catch {
    /* storage unavailable: the choice lasts until the reload */
  }
  location.reload()
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (typeof vars[k] === 'number' ? formatNumber(vars[k] as number) : String(vars[k])) : m)) : s

/**
 * Translates an English text. Placeholders like {name} are filled from vars (numbers are formatted for the language).
 * Unknown texts fall back to the English text.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const e = dict[text]
  const s = typeof e === 'string' ? e : e ? (e.other ?? text) : text
  return fill(s, vars)
}

/**
 * Text with a context, for an English text that needs different translations in different places: `tc('action', 'Open')`
 * (the verb on a button, Turkish "Aç") next to `t('Open')` (the state, Turkish "Açık"). The dictionary key is
 * "context|text"; English shows the text.
 */
export function tc(context: string, text: string, vars?: Record<string, string | number>): string {
  const e = dict[`${context}|${text}`]
  const s = typeof e === 'string' ? e : e ? (e.other ?? text) : text
  return fill(s, vars)
}

/**
 * Counted phrase: `one` and `other` are the English singular and plural forms (other is the dictionary key). {count} is
 * filled with the formatted count. Translations give one form per plural category of their language.
 */
export function tn(count: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const all = { count, ...vars }
  const e = dict[other]
  if (typeof e === 'string') return fill(e, all)
  if (e) return fill(e[rules.select(count)] ?? e.other ?? other, all)
  return fill(count === 1 ? one : other, all)
}

/**
 * Marks a text for translation without translating it yet, for texts kept in tables and translated where they are shown
 * (`const LABEL = { a: msg('Clear') }` ... `t(LABEL[k])`). Returns the text unchanged; scripts/i18n-check.mjs collects it.
 */
export const msg = (text: string) => text

/** Languages that count the ground floor as the first floor (1階, 1층, 一楼, первый этаж) */
const GROUND_IS_FIRST = new Set<string>(['ja', 'ko', 'zh', 'ru'])

/** Display number of a floor (0 = ground floor): from 1 above the ground floor, or the ground floor is 1 where the language counts it so */
export const floorNumber = (aboveGround: number) => aboveGround + (GROUND_IS_FIRST.has(lang) ? 1 : 0)

/** Number for display in the current language (decimal separator, grouping); null shows "-" */
export function formatNumber(n: number | null | undefined, maxDigits = 1, minDigits = 0): string {
  if (n == null || Number.isNaN(n)) return '-'
  return n.toLocaleString(lang, { maximumFractionDigits: maxDigits, minimumFractionDigits: minDigits })
}

/** Lower case for search and matching in the current language */
export const lower = (s: string) => s.toLocaleLowerCase(lang)
