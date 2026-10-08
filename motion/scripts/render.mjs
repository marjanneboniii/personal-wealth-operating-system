// Render a video from the studio.
//
//   node scripts/render.mjs <video-id> [--out file.mp4] [--poster seconds] [--poster-only] [--scale 1.3333] [--stills 1.5,5.5,...]
//
// Bundles once, then renders the MP4 (h264, 30fps) and an optional WebP poster.
// The layout is always 1920x1080; --scale renders it at a higher pixel density
// (1.3333 → 2560x1440) so text stays crisp on retina screens.
//
// Quality: frames are captured lossless (PNG) and encoded at CRF 17 with the
// slow preset. Motion graphics are mostly thin text on dark gradients, which
// fall apart (ringing, banding, soft coloured text) at low bitrates.
//
// With --stills, renders review frames to out/stills instead.
//
// Safety: renders with the installed, Google-signed Chrome (never a downloaded
// browser), in a throwaway profile with extensions disabled (Remotion's
// defaults), and refuses to start while the machine is online. Pass
// --allow-online to skip the offline check.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith("--")) {
  console.error("usage: node scripts/render.mjs <video-id> [--out file.mp4] [--poster seconds] [--stills s1,s2]");
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
};

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) {
  console.error(`Google Chrome not found at ${CHROME}. Set CHROME_PATH.`);
  process.exit(1);
}
if (!args.includes("--allow-online")) {
  const online = await Promise.race([
    lookup("google.com").then(() => true, () => false),
    new Promise((done) => setTimeout(() => done(false), 3000)),
  ]);
  if (online) {
    console.error("Internet is connected. Turn Wi-Fi off and run again (or pass --allow-online).");
    process.exit(1);
  }
}
// Installed Chrome needs the new headless mode, which Remotion uses for this chromeMode.
const browser = { browserExecutable: CHROME, chromeMode: "chrome-for-testing" };

const root = path.resolve(import.meta.dirname, "..");
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "../public") });
const composition = await selectComposition({ serveUrl, id, ...browser });
const scale = Number(flag("--scale") ?? 1);
const frameAt = (s) => Math.min(composition.durationInFrames - 1, Math.round(Number(s) * composition.fps));

const stills = flag("--stills");
if (stills) {
  const dir = path.join(root, "out/stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of stills.split(",")) {
    const output = path.join(dir, `${id}-${Number(s).toFixed(2)}.png`);
    await renderStill({ ...browser, composition, serveUrl, frame: frameAt(s), output, imageFormat: "png", scale: 0.5 });
    console.log("still", output);
  }
  process.exit(0);
}

const out = path.resolve(flag("--out") ?? path.join(root, "out", `${id}.mp4`));
fs.mkdirSync(path.dirname(out), { recursive: true });
let last = -1;
// --poster-only re-renders just the poster next to an existing video.
if (!args.includes("--poster-only")) await renderMedia({
  ...browser,
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: out,
  scale,
  crf: 17,
  x264Preset: "slow",
  pixelFormat: "yuv420p",
  colorSpace: "bt709",
  imageFormat: "png",
  muted: true,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 10);
    if (p !== last) console.log(`${id} ${(last = p) * 10}%`);
  },
});
if (fs.existsSync(out)) console.log("video", out, `${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);

const poster = flag("--poster");
if (poster) {
  const output = out.replace(/\.mp4$/, "-poster.webp");
  await renderStill({ ...browser, composition, serveUrl, frame: frameAt(poster), output, imageFormat: "webp", scale });
  console.log("poster", output);
}
