import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? process.argv[3] ?? 'playwright');
const out = resolve(process.argv[2] ?? '/tmp/tavazon-video');
const fps = Number(process.env.FILM_FPS ?? 20);
const postersOnly = process.argv.includes('--posters') || process.env.POSTERS_ONLY === '1';
const server = createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  const font = /^\/fonts\/(Vazirmatn-(Regular|Medium|SemiBold|Bold)|JetBrainsMono-(Regular|Medium|SemiBold|Bold))\.woff2$/.test(url.pathname);
  if (!font && !['/preview.html','/pwa.html','/web.html'].includes(url.pathname)) {res.writeHead(404).end();return;}
  res.setHeader('Content-Type',font?'font/woff2':'text/html; charset=utf-8');
  res.end(readFileSync(font ? resolve('public', '.'+url.pathname) : resolve(out,'.'+url.pathname)));
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const port=server.address().port;
let browser;
try {
 browser = await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 if (process.argv.includes('--verify')) {
  const { verifyLanding } = await import('./verify.mjs');
  await verifyLanding(browser,out);
 } else {
 const failures=[];
 // Preflight all films before spending time on frame sequences.
 for(const kind of ['preview','pwa','web']) {
  const context=await browser.newContext({viewport:{width:1280,height:1200},deviceScaleFactor:1});
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/${kind}.html`);
  await page.evaluate(()=>document.fonts.ready);
  const meta=await page.evaluate(()=>window.filmMeta);
  await page.setViewportSize({width:meta.width,height:meta.height});
  const measurements=[];
  for (const [step,c] of meta.chapters.entries()) {
   await page.evaluate(t=>window.renderFilm(t),c.at+Math.min(1.8,c.duration-.3));
   await page.screenshot({path:resolve(out,`${kind}-scene-${step}.png`)});
   const metrics=await page.evaluate(()=>{
    const scene=document.querySelector('[data-scene][style*="visible"]');
    const footer=document.querySelector('footer').getBoundingClientRect();
    const critical=[...scene.querySelectorAll('[data-critical]')].filter(e=>e.getClientRects().length && getComputedStyle(e).display!=='none');
    return {overflow:critical.filter(e=>e.getBoundingClientRect().bottom>footer.top || e.scrollWidth>e.clientWidth+2).map(e=>e.textContent), minFont:Math.min(...critical.map(e=>parseFloat(getComputedStyle(e).fontSize)))};
   });
   const effective=metrics.minFont*328/meta.width;
   if(metrics.overflow.length || effective<14) failures.push(`${kind}/${c.scene}: ${JSON.stringify(metrics)}, effective font ${effective.toFixed(1)}px`);
   measurements.push({scene:c.scene,effectiveMinFont:Number(effective.toFixed(1)),overflow:metrics.overflow});
  }
  await page.evaluate(t=>window.renderFilm(t),kind==='preview'?13.8:meta.chapters.find(c=>c.scene==='overview').at+1.8);
  await page.screenshot({path:resolve(out,`${kind}-poster.png`)});
  console.log(`${kind}: measured ${measurements.length} scenes`);
  writeFileSync(resolve(out,`${kind}-qa.json`),JSON.stringify({meta,measurements},null,2));
  await context.close();
 }
 if(failures.length) throw new Error(failures.join('\n'));
 console.log('All readability and bounds checks passed');
 if (!postersOnly) for(const kind of ['preview','pwa','web']) {
  const context=await browser.newContext({deviceScaleFactor:1});
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/${kind}.html`);
  await page.evaluate(()=>document.fonts.ready);
  const meta=await page.evaluate(()=>window.filmMeta);
  await page.setViewportSize({width:meta.width,height:meta.height});
  const frames=resolve(out,`${kind}-frames`);mkdirSync(frames,{recursive:true});
  for(let frame=0;frame<meta.duration*fps;frame++) {
   await page.evaluate(t=>window.renderFilm(t),frame/fps);
   await page.screenshot({path:resolve(frames,`${String(frame).padStart(5,'0')}.png`)});
   if(frame%(fps*5)===0) console.log(`${kind}: ${frame/fps}s / ${meta.duration}s`);
  }
  await context.close();
 }
}
} finally {if(browser) await browser.close();server.close();}
