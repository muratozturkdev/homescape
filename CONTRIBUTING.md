# Contributing to Homescape

Homescape aims to stay a browser-only app: no server, no account, every object drawn in code, and careful with the home
plans people spend hours on. Contributions are welcome and are accepted under the GNU General Public License v3.0 or
later ([LICENSE](LICENSE)).

## Ways to help

- **Bug reports:** open an issue with your Home Assistant version, how you run Homescape (app, files in `/config/www` or
  standalone), the browser and device, the steps that show the problem, and a screenshot or console errors if you have
  them.
- **Fixes, new device models and item kinds, translations and docs:** open a pull request.
- **Larger ideas:** open an issue first, so we can agree on the direction before you spend time on it.

## Getting started

You need Node.js 20 or newer (CI uses 22) and Google Chrome for the browser tests. A Home Assistant instance is optional.

```bash
git clone https://github.com/muratozturkdev/homescape.git
cd homescape
npm install
npm run dev                  # http://localhost:5190
```

Without a connection the app opens with demo homes. The sample home (home menu > **Example homes**) contains every item
kind, so most work needs no Home Assistant at all. To work against your own instance, copy `.env.example` to `.env.local`
and set `HA_URL`; the dev server then proxies Home Assistant and you sign in with its own login page. `.env.local` holds
the address only: never put a token there or anywhere in the repository.

The regression suites drive the system Chrome through Playwright. Without Chrome, run `npx playwright install chromium`.
`npm run promo:x` (the README video) also needs ffmpeg (`brew install ffmpeg` on macOS).

## How the code is organized

| Folder | What lives there |
| --- | --- |
| `src/ha/` | The Home Assistant side: connection, entity store, service calls, plan sync, weather |
| `src/model/` | The plan (homes, floors, rooms, items, bindings) and its rules; never imports from `ui/` or `scene/` |
| `src/scene/` | The 3D scene with React Three Fiber; `kit/` holds every generated model |
| `src/ui/` | Panels, cards, menus and the Dashboard (React, Tailwind) |
| `src/audio/`, `src/i18n/` | Sound engine; translations and the `t()` helpers |
| `src/demo/`, `src/dev/` | Sample data and homes; developer labs and test helpers |
| `tools/` | Regression suites (`*-check.mjs`), screenshots, performance and media scripts |
| `homescape/`, `docs/` | The Home Assistant app package; user guides |

The full architecture, the rules of the 3D scene and the test hook are described in [CLAUDE.md](CLAUDE.md), the visual
language in [DESIGN.md](DESIGN.md). Read the part you are about to change first.

## Scope and implementation

- One focused change per pull request. Prefer the existing building blocks (the `kit/` primitives, the catalog in
  `src/model/catalog.ts`, the placement rules) over a new subsystem.
- **Everything is made in code:** no external 3D models, textures, images or icon packs. Icons come from Lucide only.
  Sounds are generated (`tools/sfx/`) or synthesized in the browser.
- **Every text is translated:** write it in English inside `t()` and add it to every file in `src/i18n/locales/`
  (see [Translations](#translations)). Names that come from Home Assistant or from the user's plan are never translated.
- **Touch counts:** every interaction must work with a finger on a tablet and on a phone (390 x 844), not only with a
  mouse.
- **Mind the frame rate:** the scene renders on demand and runs on tablets. Avoid work and allocations in every frame;
  for scene changes compare `npm run perf` before and after.
- **New interactions get a hook:** extend `window.__homescape` (`src/App.tsx`) so the suites can drive them, and add
  checks to the matching suite.
- Code style: TypeScript without semicolons, single quotes, lines up to about 200 characters. There is no formatter
  config, so do not reformat code you did not change. Everything in the repository is in English; comments say why,
  briefly. No em dash or en dash characters anywhere.

## People's plans come first

A user's home plan is the one thing this project must never lose. Changes that touch it follow these rules:

- If you change the plan format, raise `STORE_VERSION` and add a step to `migrateLayout` in `src/model/layoutStore.ts`.
  Plans from the browser, from Home Assistant and from backups all pass through it, so a step must never throw.
- Keep the rules at the top of `src/ha/planSync.ts`: never write without reading first, a failed read is not "no plan",
  never overwrite data this version cannot read, and only write hand edits.
- Test sync and storage changes on a dev server that is not connected to your real Home Assistant, for example
  `HA_URL= npm run dev -- --port 5191 --strictPort` and then `HOMESCAPE_URL=http://localhost:5191/ npm run check:data`.
  A browser tab connected to your own instance would run half-finished code against your real plan.
- Prove a data-loss bug with a failing check before you fix it.

## Validation

Every change runs `npm run typecheck`, `npm run lint` and `npm run i18n:check` (CI runs them and `npm run build` on every
pull request). Then run the browser suites for what you changed, with the dev server running:

| You changed | Run |
| --- | --- |
| The plan format, sync or storage | `check:data`, `check:sync`, `check:home` |
| Editing, placing, the camera | `check:controls`, `check:home` |
| The Dashboard | `check:dashboard`, `check:world` |
| Floors, roofs, stairs, the walk | `check:building`, `check:world` |
| People, pets, interiors | `check:interior`, `check:pets` |
| The yard and the street | `check:outdoor`, `check:street` |
| Sound, weather, the sample home | `check:sound`, `check:weather`, `check:demo` |

`npm run check` runs every suite. The suites use the bundled sample data, never your Home Assistant, and accept
`HOMESCAPE_URL` for a server on another port.

- A new check should fail without your change and pass with it.
- A visual change is done when a screenshot confirms it (`npm run shot`): the day and night overview, a room in Edit
  mode and a phone. Add before and after images to the pull request.
- Say what you actually verified: browser, device, Home Assistant version and how Homescape ran (app, `/config/www` or
  standalone), and what you could not test.

## Pull requests

- Describe the behavior before and after, why it changes and how you tested it. Open unfinished work as a draft and say
  what is missing.
- Commit messages and titles are in English, in the imperative ("Add weather effects"), and say what changes for the
  user rather than how. No AI attribution lines (`Co-Authored-By` and similar).
- Link the issue with `Fixes #123`, or `Refs #123` when the pull request covers only part of it (and say which part).
- Leave version numbers and `homescape/CHANGELOG.md` to the maintainer; describe the user-visible effect so it can
  become a release note.
- Working with an AI agent is fine. [CLAUDE.md](CLAUDE.md) is written to guide one through this codebase. You remain
  responsible for every line: read the diff, run the checks yourself and describe what you verified.

## Translations

User-facing text is written in English and wrapped in `t()` (or `tn()` for counted phrases); the English text is the key.

```ts
import { t, tn } from '@/i18n'
t('Lights on')
t('{name} turned off', { name })
tn(count, '{count} light', '{count} lights')
```

- One sentence per `t()` call; never glue translated pieces together.
- Translations live in `src/i18n/locales/<code>.json` (English text to translated text, sorted). To improve a language,
  edit its file. To add one, add it to `LANGUAGES` in `src/i18n/index.ts` and add a locale file with every key;
  `npm run i18n:check` lists missing, unused and mismatched entries.

## Security

Please report vulnerabilities privately to [hello@muratozturk.dev](mailto:hello@muratozturk.dev), not in a public issue.
Homescape talks to people's Home Assistant instances, so anything that could leak a token or send a command without the
user's action matters.

## Releases (maintainers)

- The Home Assistant app builds from `main` when it is installed or updated, so `main` must always be releasable.
- Before a release: CI is green on `main` and `npm run check` passes against the dev server.
- Raise the version in `package.json` and `homescape/config.yaml` (Home Assistant offers an update only when this
  version changes) and add the notes to `homescape/CHANGELOG.md`.
- Tag `vX.Y.Z` (annotated) on that commit, push it, and publish a GitHub release with the notes and
  `homescape-X.Y.Z-www.zip`: the contents of `dist/` built from the tag, for installs without apps.
- Never move a published tag or replace a published asset; fix forward with a new version.
