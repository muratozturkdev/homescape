import { initI18n } from './i18n'

// The dictionary is loaded before any app module is evaluated, so labels computed at module level are translated too
void initI18n().then(() => import('./boot'))
