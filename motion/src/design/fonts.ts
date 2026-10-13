import { continueRender, delayRender, staticFile } from "remotion";

/** The product's own Vazirmatn files, served from the app's public/ folder. */
const faces = [
  ["Vazirmatn-Regular.woff2", 400],
  ["Vazirmatn-Medium.woff2", 500],
  ["Vazirmatn-SemiBold.woff2", 600],
  ["Vazirmatn-Bold.woff2", 700],
] as const;

let loaded = false;

export function loadBrandFonts() {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("Loading Vazirmatn");
  Promise.all(
    faces.map(([file, weight]) => {
      const face = new FontFace("Vazirmatn", `url(${staticFile(`fonts/${file}`)}) format("woff2")`, { weight: String(weight) });
      document.fonts.add(face);
      return face.load();
    }),
  )
    .then(() => continueRender(handle))
    .catch((error) => {
      console.error(error);
      continueRender(handle);
    });
}
