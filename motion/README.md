# Tavazon Motion Studio

Remotion + React + TypeScript studio for Tavazon's motion graphics.
1920 × 1080, 30 fps, Persian RTL, premium tech style. One fixed identity: every
video is a short spec file. The design system, components and engine are reused
as they are.

```
motion/
  src/design/      Fixed design system: tokens, motion language, fonts, Persian helpers
  src/components/  Reusable pieces: Backdrop, Brand, Text, Counter, Card, Data, Feedback, Chrome, Icon
  src/scenes/      Scene templates (stat, meter, action, delta, mix, logo, statement, cta) + registry
  src/engine/      Scene Engine: VideoSpec types, timeline, one-camera Film renderer
  src/videos/      One file per video (the only thing a new video adds)
  scripts/render.mjs
```

## Commands

```sh
cd motion
npm install
npm run studio                                   # live preview in the browser
node scripts/render.mjs tavazon-preview --stills 2.6,6.8,10.9,14.8,18.9   # review frames → out/stills
node scripts/render.mjs <video-id> --out out/<video-id>.mp4 --poster 15.4
```

Fonts come from the app's `../public/fonts`, so the studio and the product
always use the same Vazirmatn files.

Rendering runs only under these conditions:

- It uses the installed, Google-signed Google Chrome. Set `CHROME_PATH` to use
  a different Chrome. It never downloads a browser.
- Chrome runs with a throwaway temporary profile and with extensions disabled.
  Your own profile, cookies and wallet extensions are never loaded.
- The script refuses to start while the internet is connected. Turn Wi-Fi off
  first, or pass `--allow-online` to skip this check.

The landing preview is published like this:

```sh
node scripts/render.mjs tavazon-preview --out ../public/videos/tavazon/preview.mp4 --poster 15.4 --scale 1.3333 --allow-online
```

That writes `preview.mp4` (2560 × 1440, the 1920 × 1080 layout at retina density) and
`preview-poster.webp` next to each other. Its scene
timings must match `PRODUCT_PREVIEW_CHAPTERS` in `src/lib/productFilms.ts`.

## Making a new video

1. Copy `src/videos/tavazon-preview.ts` to `src/videos/<slug>.ts` and set `id`.
2. Write the story as scenes. Each scene picks a template from
   `src/scenes/registry.ts`, gets a `seconds` value and its props. TypeScript
   checks the props for each template.
3. Add the spec to `src/videos/index.ts`.
4. Render stills, review them, then render the video.

Scene templates:

| template | use for | key props |
|---|---|---|
| `logo` | brand open/close; the scale draws itself | `tagline` |
| `statement` | one big line | `eyebrow`, `headline`, `body` |
| `stat` | one hero figure and the parts that make it | `copy`, `hero`, `rows`, `note` |
| `meter` | progress toward a limit or goal | `copy`, `title`, `used`, `limit`, `remaining` |
| `action` | a short form that gets submitted (touch + press) | `copy`, `title`, `fields`, `button`, `note` |
| `delta` | what changed after an action and what stayed the same | `copy`, `badge`, `rows[from→to]`, `steady` |
| `mix` | how a total is split (donut + legend) | `copy`, `total`, `segments`, `highlight` |
| `cta` | closing call to action | `headline`, `button`, `note` |

`copy` is `{ eyebrow, headline, body? }`. Wrap words in `*asterisks*` in a
headline to give them the mint accent.

## Identity and motion rules

- **Palette**: ink surfaces (`#0d1726`), paper text, mint `#31f2bf` as the one
  accent, the product's money colours for meaning, asset-class colours for mixes.
- **One camera**: scenes sit on one strip and the camera whip-pans between them
  with horizontal motion blur. In RTL the next scene is to the left. There are
  no scene-to-scene fades. While a scene holds, only the camera breathes
  (1.00 → 1.04).
- **Curves**: entrances `bezier(.16,1,.3,1)` over ~20 frames, exits
  `bezier(.7,0,.84,0)` over ~8 frames. Text springs never overshoot. UI springs
  overshoot by about 1.5% (`stiffness 100 / damping 16`).
- **Rhythm**: 120 BPM grid (beat = 15 frames, bar = 60). Scenes last whole
  beats, and cuts land on scene boundaries. Within a group, one element leads
  and the rest follow 2–4 frames behind, on a curve.
- **Persian**: `dir="rtl" lang="fa"` on the stage. Animate whole words, never
  letters. No `letter-spacing`. Masks get 0.5em of vertical slack. Use Persian
  digits and the ٬ separator, the half-space (ZWNJ), and Persian ی/ک.
  Staggers start on the right and meters fill from the right.
- **Seamless loops**: the backdrop completes whole cycles over the video's
  length.

The motion rules follow the MIT-licensed
[persian-motion-director](https://github.com/atmirrr/persian-motion-director).
Its `scripts/lint_persian.py` works well for checking new copy before a render.

Remotion is free for individuals and companies with up to 3 employees. Larger
companies need a company license (see remotion.dev/license).
