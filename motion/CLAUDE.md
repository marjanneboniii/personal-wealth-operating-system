# Motion Studio — instructions for agents

When the user says “Make me a video about [topic]” (or «یک ویدیو دربارهٔ … بساز»):

1. **Do not rebuild anything.** `src/design/`, `src/components/`, `src/engine/` and `src/scenes/` are the fixed identity. Read them, don't rewrite them.
2. Create `src/videos/<slug>.ts` with `defineVideo({...})`. Use `src/videos/tavazon-preview.ts` as the model, and register the spec in `src/videos/index.ts`.
3. Tell the story with the existing templates (`logo`, `statement`, `stat`, `meter`, `action`, `delta`, `mix`, `cta`). Default length is 15–30s. Scenes are 3–5s each, in whole half-seconds. A standalone video usually opens with `logo` or `statement` and closes with `cta`.
4. Write the copy in natural Persian: half-spaces (می‌, ‌ها), Persian digits in strings, « » quotes, ، and ؟. Keep figures fictional and internally consistent (assets − debts = net worth, and so on). Say “داده‌های فرضی” in `footnote`.
5. Only add a new template (component + registry entry) when no existing one can carry the beat. Build it from existing components and the tokens and timings in `src/design/`.
6. Verify with `npx tsc --noEmit`, then render review stills (`node scripts/render.mjs <id> --stills …`), check them, and render the MP4. Rendering uses the installed Chrome offline; the user runs it in their own terminal.

Do not change `canvas` (1920×1080, 30fps), the palette, the curves or the camera unless the user asks to change the brand itself.
