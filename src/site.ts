/*
 * The public demo site (homescape.muratozturk.dev): the same app built with `npm run build:site` (vite --mode site). The
 * sample home opens on every visit, an intro card explains Homescape (ui/SiteIntro.tsx), and the top bar links to GitHub
 * instead of the connection dialog: a public page cannot reach a Home Assistant on someone's home network. In every
 * other build SITE is false and these parts are left out.
 */
export const SITE = import.meta.env.MODE === 'site'

export const REPO_URL = 'https://github.com/muratozturkdev/homescape'

/** My Home Assistant link: opens the visitor's Home Assistant with the app repository ready to add */
export const ADD_TO_HA_URL = `https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=${encodeURIComponent(REPO_URL)}`
