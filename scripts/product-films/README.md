# Tavazon product films

The landing page starts with a silent, 20-second square preview (`preview.mp4`,
900 × 900). Three topic buttons (overview, repayment and investments) seek to their scenes.
A hero link reaches this section. The signup action follows the outcome on mobile.
The poster shows a repayment result, distinct from the hero dashboard.
The optional guide contains two 40-second films: phone/PWA (`pwa.mp4`, 900 ×
1200) and web (`web.mp4`, 1280 × 800). Detailed chapter controls are collapsed.

These are animated illustrations with fictional data, using the actual
Vazirmatn font, light-theme tokens, BrandMark and Icon components. Closeups keep
financial labels readable on narrow players. Typing, touch cues (phone/preview),
a cursor (web), budget fill and changing balances show action and result.
The complete guides include setup, accounts, holdings, debt, review, overview,
monthly income/spending and budget, repayment recording and portfolio.
Repayment reduces cash and debt equally: it neither increases net worth nor
transfers money. Portfolio value equals cost plus sample unrealized profit.

`src/lib/productFilms.ts` shares timings and Persian captions with the player.
Full guides have ten chapters; the short preview has five. Keep duration and
encoder frame count synchronized when changing the story.

## Rebuild (macOS)

Use an available Playwright installation and Google Chrome. No authenticated
account, database or external network is needed. A temporary loopback server
serves only stage HTML and bundled fonts.

```sh
node --import tsx scripts/product-films/build.tsx /tmp/tavazon-video-v2
node scripts/product-films/render.mjs /tmp/tavazon-video-v2 /absolute/path/to/playwright
swift -module-cache-path /tmp/tavazon-video/swift-cache scripts/product-films/encode.swift /tmp/tavazon-video-v2/preview-frames public/videos/tavazon/preview.mp4 900 900 20 20
swift -module-cache-path /tmp/tavazon-video/swift-cache scripts/product-films/encode.swift /tmp/tavazon-video-v2/pwa-frames public/videos/tavazon/pwa.mp4 900 1200 20 40
swift -module-cache-path /tmp/tavazon-video/swift-cache scripts/product-films/encode.swift /tmp/tavazon-video-v2/web-frames public/videos/tavazon/web.mp4 1280 800 20 40
```

Playwright can also resolve from local dependencies or `PLAYWRIGHT_MODULE`.
Override Chrome with `CHROME_PATH`. Pass `--posters` for quick preflight only.
The renderer checks all 25 scenes for overflow and a minimum equivalent critical
font size of 14px at a 328px player width before capturing frames at 20fps.
It writes screenshots, posters and JSON measurements to the temporary directory.
Convert the three `*-poster.png` files to WebP at quality 88 in
`public/videos/tavazon/`. Keep frame sequences and encoder scratch files outside
public assets; remove any native `.mp4.sb-*` scratch files after encoding.

With the local app running on port 3000, verify playback and interaction:

```sh
node scripts/product-films/render.mjs /tmp/tavazon-video-v2 /absolute/path/to/playwright --verify
```

This tests widths 360, 390 and 1440 in browser and simulated standalone modes: no MP4 request before user interaction,
closed optional guides, three topics, keyboard opening, responsive variant
selection, native media dimensions/duration, chapter seeking, Persian cues,
mutual playback pausing, signup placement and absence of horizontal overflow/errors.
Controls and Persian captions are rendered outside the video rectangle, including
in fullscreen, so financial content stays visible. The native controls and VTT
track remain as a no-JavaScript fallback. Custom captions use the same timeline
that generates the VTT; seeking while paused updates the caption immediately.
Standalone mode selects the phone guide even on wide windows. This checks mode
logic through browser emulation; it does not certify physical iOS/Android installs.
This is browser QA, not a real-user comprehension or conversion study.
