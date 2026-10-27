# Third-party notices

Homescape is built on the following open-source software and assets. Their licenses apply to the respective parts.

## Runtime libraries

| Package | License |
| --- | --- |
| [React](https://github.com/facebook/react), React DOM | MIT |
| [three.js](https://github.com/mrdoob/three.js) | MIT |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber), [@react-three/drei](https://github.com/pmndrs/drei) | MIT |
| [zustand](https://github.com/pmndrs/zustand) | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) (`lucide-react`), all user interface icons | ISC |
| [home-assistant-js-websocket](https://github.com/home-assistant/home-assistant-js-websocket) | Apache-2.0 |

## Fonts

| Font | License |
| --- | --- |
| [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (`@fontsource-variable/plus-jakarta-sans`) | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (`@fontsource/jetbrains-mono`) | SIL Open Font License 1.1 |

## Sounds

The recorded sounds in `public/sounds/` were generated for this project with
[Stable Audio 3](https://github.com/Stability-AI/stable-audio-3) (Small-SFX and Small-Music models, open weights by
Stability AI, used under the Stability AI Community License) and processed with `tools/sfx/build.py`. Other sounds are
synthesized in the browser at run time (`src/audio/`).

## 3D models

There are no external 3D models: every object in the scene is generated in code (`src/scene/kit/`).

## Development tools

Vite, TypeScript, Tailwind CSS, oxlint and Playwright are used for development only and are not part of the built app.
