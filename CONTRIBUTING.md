# Contributing to Homescape

Thanks for helping! Bug reports, translations, new item models and fixes are all welcome.

## Getting started

```bash
npm install
cp .env.example .env.local   # set HA_URL to your Home Assistant address (optional)
npm run dev                  # http://localhost:5190
```

Without `HA_URL` the app opens with demo homes, so you can work on most things without a Home Assistant instance.

Before you open a pull request:

```bash
npm run typecheck
npm run lint
npm run i18n:check   # every t() text has a translation entry
npm run check        # browser regression tests (needs the dev server running and Chrome installed)
```

`npm run check` runs every suite; the single suites are listed in `package.json` (`check:world`, `check:home` ...).

## Code

- Architecture, folder layout and the rules for the 3D scene are in [CLAUDE.md](CLAUDE.md); the visual language is in
  [DESIGN.md](DESIGN.md). Read the relevant part before larger changes.
- Style: TypeScript, no semicolons, single quotes, lines up to about 200 characters. There is no formatter config; please
  do not reformat files you did not change.
- Comments explain why, briefly. Everything in the repository is in English.
- No em dash or en dash characters in code, text or docs.

## Translations

User-facing text is written in English and wrapped in `t()` (or `tn()` for counted phrases); the English text is the key.

```ts
import { t, tn } from '@/i18n'
t('Lights on')
t('{name} turned off', { name })
tn(count, '{count} light', '{count} lights')
```

- One sentence per `t()` call; never glue translated pieces together.
- Names that come from Home Assistant or from the user's plan are data and are never translated.
- Translations live in `src/i18n/locales/<code>.json` (English text to translated text). To improve a language, edit its
  file. To add a language, add it to `LANGUAGES` in `src/i18n/index.ts` and add a locale file with every key; run
  `npm run i18n:check` to see missing keys.

## Commits and pull requests

- Keep pull requests focused; describe what changed and how you tested it (a screenshot helps for visual changes).
- Write commit messages in English, in the imperative ("Add weather effects"), without AI attribution lines.
