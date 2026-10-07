/** Render isolated public examples using the product's own tokens and glyphs. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import FilmScenes from "./Scenes";
import { PRODUCT_FILM_CHAPTERS, PRODUCT_PREVIEW_CHAPTERS, PRODUCT_FILMS, PRODUCT_PREVIEW, type ProductFilmKind } from "../../src/lib/productFilms";

const out = resolve(process.argv[2] ?? "/tmp/tavazon-video");
mkdirSync(out, { recursive: true });
const globals = readFileSync("src/app/globals.css", "utf8");
const tokens = globals.slice(globals.indexOf("@font-face"), globals.indexOf(".dark, .landing-ink")).replace(/@theme\s*\{[^}]*\}/g, "");
const css = readFileSync("scripts/product-films/film.css", "utf8");
const stamp = (s: number) => `00:00:${String(s).padStart(2, "0")}.000`;
for (const kind of ["preview", "pwa", "web"] as ProductFilmKind[]) {
  const chapters = kind === "preview" ? PRODUCT_PREVIEW_CHAPTERS : PRODUCT_FILM_CHAPTERS;
  const film = kind === "preview" ? PRODUCT_PREVIEW : PRODUCT_FILMS[kind];
  const duration = chapters.at(-1)!.at + chapters.at(-1)!.duration;
  const timeline = `
const chapters = ${JSON.stringify(chapters)};
window.filmMeta = ${JSON.stringify({ kind, width: film.width, height: film.height, chapters, duration })};
const fa = value => Math.round(value).toLocaleString('fa-IR');
const numberOf = value => Number(value.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, ''));
window.renderFilm = time => {
 const index = Math.max(0, chapters.findLastIndex(c => time >= c.at));
 const pointer = document.getElementById('${kind === "web" ? "film-cursor" : "film-touch"}');
 pointer.style.opacity = '0';
 document.querySelectorAll('[data-progress]').forEach((el,i) => el.style.transform = 'scaleX(' + Math.max(0,Math.min(1,(time-chapters[i].at)/chapters[i].duration)) + ')');
 document.querySelectorAll('[data-scene]').forEach((el,i) => {
  el.style.visibility = i === index ? 'visible' : 'hidden';
  if (i !== index) return;
  const local = time - chapters[i].at;
  const last = i === chapters.length-1;
  const exit = last ? 1 : Math.max(0,Math.min(1,(chapters[i].duration-local)/.18));
  const launch = el.querySelector('[data-launch]');
  if (launch) { launch.style.opacity = String(Math.max(0,Math.min(1,(1.1-local)/.3))); launch.style.visibility = local<1.1?'visible':'hidden'; }
  const delay = launch ? 1 : 0;
  el.querySelectorAll('[data-reveal]').forEach((item,j) => {
   const p = Math.max(0,Math.min(1,(local-delay-.05-j*.05)/.22));
   item.style.opacity = String(p*exit); item.style.transform = 'translateY(' + ((1-p)*10) + 'px)';
  });
  el.querySelectorAll('[data-type]').forEach(item => {
   const p = Math.max(0,Math.min(1,(local-delay-.3)/.9));
   const value = item.dataset.type;
   item.textContent = value.slice(0,Math.ceil(value.length*p));
   item.closest('.film-field').classList.toggle('typing',p>0 && p<1);
  });
  el.querySelectorAll('[data-from]').forEach(item => {
   const p = Math.max(0,Math.min(1,(local-.55)/.8));
   item.textContent = fa(numberOf(item.dataset.from)+(numberOf(item.dataset.to)-numberOf(item.dataset.from))*p);
   item.closest('.film-money-row').classList.toggle('changed',local>.5);
  });
  el.querySelectorAll('[data-bar]').forEach(item => item.style.transform = 'scaleX(' + Math.max(0,Math.min(1,(local-.4)/1.1)) + ')');
  el.querySelectorAll('.film-action').forEach(item => item.classList.toggle('pressed',local>chapters[i].duration-.7 && local<chapters[i].duration-.4));
  const target = launch && local<1.1 ? launch.querySelector('[data-target]') : el.querySelector('[data-target]');
  const active = launch && local>.35 && local<.85 || local>chapters[i].duration-1 && local<chapters[i].duration-.35;
  if(target && active) {
   const b=target.getBoundingClientRect();
   pointer.style.left=(b.left+b.width*.5)+'px'; pointer.style.top=(b.top+b.height*.55)+'px';
   pointer.style.opacity='1';
   pointer.style.transform='scale('+(local>chapters[i].duration-.7?.8:1)+')';
  }
 });
}; window.renderFilm(0);`;
  writeFileSync(resolve(out, `${kind}.html`), `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>توازن · ${kind}</title><style>${tokens}\n${css}</style><body>${renderToStaticMarkup(<FilmScenes kind={kind} />)}<script>${timeline}</script></body></html>`);
  writeFileSync(`public/videos/tavazon/${kind === "preview" ? "preview.fa.vtt" : "captions.fa.vtt"}`, "WEBVTT\n\n" + chapters.map(c => `${stamp(c.at)} --> ${stamp(c.at+c.duration)}\n${c.caption}`).join("\n\n") + "\n");
}
console.log(`Film stages written to ${out}`);
