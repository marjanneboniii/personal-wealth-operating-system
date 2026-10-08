/** Browser integration checks for the 20-second motion preview: lazy loading, looping and topic seeking. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
export async function verifyLanding(browser, out) {
 const results=[];
 for (const standalone of [false,true]) for (const width of [360,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768,isMobile:width<768});
  if (standalone) await context.addInitScript(() => {
   const original = window.matchMedia.bind(window);
   window.matchMedia = query => query === '(display-mode: standalone)' ? Object.defineProperty(original(query),'matches',{value:true}) : original(query);
   Object.defineProperty(navigator,'standalone',{get:()=>true});
  });
  await context.route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const videos=[];page.on('request',r=>{if(r.url().endsWith('.mp4'))videos.push(r.url())});
  await page.goto('http://localhost:3000/',{waitUntil:'networkidle'});
  assert.equal(videos.length,0,'No video download before the preview scrolls into view');
  const tour=page.locator('#product-tour');
  await page.goto('http://localhost:3000/#product-tour',{waitUntil:'networkidle'});
  await tour.scrollIntoViewIfNeeded();
  assert.equal(await tour.locator('video').count(),1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  assert.equal(await tour.locator('video').getAttribute('preload'),'none');
  assert.equal(await tour.getByRole('button',{name:/^(نمای کلی|قسط|سرمایه‌گذاری)$/}).count(),3);
  assert.equal(await tour.locator('.product-films-guide').count(),0);
  assert.equal(await tour.getByText('راهنمای کامل گوشی و وب').count(),0);
  assert.equal(await tour.locator('video').evaluate(v=>v.controls),false);
  assert(await tour.locator('.product-films-topics').evaluate(g=>[...g.querySelectorAll('button')].every(b=>Math.round(b.getBoundingClientRect().height)>=48 && ['flex','inline-flex'].includes(getComputedStyle(b).display) && getComputedStyle(b).borderTopWidth==='1px')),'Styled touch targets at least 48px');
  if(width<768) {
   const positions=await tour.evaluate(t=>Object.fromEntries(['description','cta','note'].map(k=>[k,t.querySelector('.product-films-'+k).getBoundingClientRect().top])));
   assert(positions.description<positions.cta && positions.cta<positions.note,'Signup immediately follows the outcome: '+JSON.stringify(positions));
  }
  await tour.screenshot({path:resolve(out,`landing-${standalone?'standalone':'browser'}-${width}.png`)});
  const preview=tour.locator('video').first();
  // A silent looping motion graphic: no player controls, captions or fullscreen.
  assert.equal(await tour.locator('.product-film-controls, .product-film-caption, track').count(),0);
  assert.deepEqual(await preview.evaluate(v=>({muted:v.muted,loop:v.loop,controls:v.controls})),{muted:true,loop:true,controls:false});
  await page.waitForFunction(()=>!document.querySelector('#product-tour video').paused,null,{timeout:15000});
  const previewMeta=await preview.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}));
  assert.equal(previewMeta.duration,20);assert.equal(previewMeta.width*9,previewMeta.height*16,'16:9 film');assert(previewMeta.width>=1920,'At least 1080p');
  // Every topic seeks into its scene of the same film.
  for (const [topic,at] of [['نمای کلی',0],['قسط',8],['سرمایه‌گذاری',16]]) {
   await tour.getByRole('button',{name:topic,exact:true}).click();
   await page.waitForFunction(at=>{const t=document.querySelector('#product-tour video').currentTime;return t>=at+.3&&t<at+3;},at);
   assert.equal(await tour.getByRole('button',{name:topic,exact:true}).getAttribute('aria-pressed'),'true');
  }
  await preview.evaluate(v=>v.pause());
  for(const [scene,at] of [['overview',3.2],['budget',7.2],['payment',11.2],['paid',15.2],['portfolio',19.2]]) {
   await preview.evaluate((v,t)=>{v.currentTime=t},at);
   await page.waitForFunction(at=>Math.abs(document.querySelector('#product-tour video').currentTime-at)<.1,at);
   await tour.locator('.product-films-player').screenshot({path:resolve(out,`preview-${scene}-${standalone?'standalone':'browser'}-${width}.png`)});
  }
  assert.equal(await tour.locator('video').count(),1);
  assert(videos.every(url=>url.endsWith('/preview.mp4')),'Only the 20-second asset is ever requested');
  const cta=tour.getByRole('link',{name:'شروع رایگان',exact:false});
  assert.equal(await cta.getAttribute('href'),'/register');
  assert.deepEqual(errors,[]);
  const result={mode:standalone?"standalone-emulation":"browser",viewport:width,preview:previewMeta,errors};
  results.push(result);console.log(JSON.stringify(result));
  await context.close();
 }
 writeFileSync(resolve(out,'landing-qa.json'),JSON.stringify(results,null,2));
}
