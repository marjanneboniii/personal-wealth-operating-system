/** Browser integration checks for media loading, guides, keyboard and seeking. */
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
  const tour=page.locator('#product-tour');
  await page.getByRole('link',{name:'دیدن توازن در ۲۰ ثانیه'}).click();
  await page.waitForFunction(()=>location.hash==='#product-tour');
  await tour.scrollIntoViewIfNeeded();
  assert.equal(await tour.locator('video').count(),1);
  assert.equal(videos.length,0,'No video downloads before user action');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  assert.equal(await tour.locator('video').getAttribute('preload'),'none');
  assert.equal(await tour.getByRole('button',{name:/^(نمای کلی|قسط|سرمایه‌گذاری)$/}).count(),3);
  assert.equal(await tour.locator('.product-films-guide[open]').count(),0);
  assert.equal(await tour.locator('video').evaluate(v=>v.controls),false);
  if(width<768) {
   const positions=await tour.evaluate(t=>Object.fromEntries(['description','cta','everyday'].map(k=>[k,t.querySelector('.product-films-'+k).getBoundingClientRect().top])));
   assert(positions.description<positions.cta && positions.cta<positions.everyday,'Signup immediately follows the outcome: '+JSON.stringify(positions));
  }
  await tour.screenshot({path:resolve(out,`landing-${standalone?'standalone':'browser'}-${width}.png`)});
  await tour.getByRole('button',{name:'قسط',exact:true}).click();
  const preview=tour.locator('video').first();
  await page.waitForFunction(()=>document.querySelector('#product-tour video').currentTime>=8.9 && document.querySelector('#product-tour video').readyState>=2);
  await tour.locator('.product-films-layout>.product-films-player').getByRole('button',{name:'توقف ویدیو',exact:true}).click();
  const previewMeta=await preview.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime}));
  assert.equal(previewMeta.duration,20);assert.equal(previewMeta.width,900);assert.equal(previewMeta.height,900);
  assert.equal(await tour.getByRole('button',{name:'قسط',exact:true}).getAttribute('aria-pressed'),'true');
  // Load the Persian track and verify parsed cue timing.
  const previewPlayer=tour.locator('.product-films-layout>.product-films-player');
  await previewPlayer.getByRole('button',{name:'زیرنویس فارسی',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#product-tour video').textTracks[0].cues?.length===5);
  await page.waitForFunction(()=>document.querySelector('.product-films-layout .product-film-caption')?.textContent.includes('قسط'));
  assert(await previewPlayer.evaluate(p=>p.querySelector('.product-film-caption').getBoundingClientRect().top>=p.querySelector('video').getBoundingClientRect().bottom),'Captions outside the financial frame');
  assert(await previewPlayer.evaluate(p=>p.querySelector('.product-film-controls').getBoundingClientRect().top>=p.querySelector('video').getBoundingClientRect().bottom),'Controls outside the financial frame');
  await previewPlayer.getByRole('slider',{name:'زمان ویدیو'}).focus();
  const beforeSeek=Number(await previewPlayer.getByRole('slider',{name:'زمان ویدیو'}).inputValue());
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(before=>document.querySelector('#product-tour video').currentTime>before,beforeSeek);
  await previewPlayer.getByRole('button',{name:'نمایش تمام‌صفحه'}).click();
  await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('product-films-player'));
  await page.evaluate(()=>document.exitFullscreen());
  await tour.locator('.product-films-guide>summary').focus();
  await page.keyboard.press('Enter');
  await tour.locator('.product-films-guide[open]').waitFor();
  await tour.locator('.product-films-guide video').waitFor();
  assert.equal(await tour.locator('video').count(),2);
  assert.equal(await tour.locator('.product-films-guide source').getAttribute('src'),!standalone && width>=768?'/videos/tavazon/web.mp4':'/videos/tavazon/pwa.mp4');
  assert.equal(await tour.locator('.product-films-chapter-disclosure[open]').count(),0);
  // Check both variants on every viewport.
  const guideMetadata=[];
  for(const [label,w,h] of [['وب',1280,800],['گوشی',900,1200]]) {
   await tour.getByRole('button',{name:label,exact:true}).click();
   const disclosure=tour.locator('.product-films-chapter-disclosure');
   if(await disclosure.getAttribute('open')===null) await disclosure.locator('summary').click();
   await disclosure.getByRole('button',{name:/سبد سرمایه‌گذاری/}).click();
   await page.waitForFunction(()=>document.querySelector('.product-films-guide video').currentTime>=36.9 && document.querySelector('.product-films-guide video').readyState>=2);
   const guide=tour.locator('.product-films-guide video');
   await guide.evaluate(v=>v.pause());
   const meta=await guide.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,error:v.error?.message}));
   assert.equal(meta.duration,40);assert.equal(meta.width,w);assert.equal(meta.height,h);assert(!meta.error);
   const player=tour.locator('.product-films-guide .product-films-player');
   await player.getByRole('button',{name:'زیرنویس فارسی',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.product-films-guide video').textTracks[0].cues?.length===10);
   assert(await preview.evaluate(v=>v.paused),'The short film pauses when full guide plays');
   await page.waitForFunction(()=>document.querySelector('.product-films-guide .product-film-caption')?.textContent.includes('سبد'));
   assert(await player.evaluate(p=>p.querySelector('.product-film-controls').getBoundingClientRect().top>=p.querySelector('video').getBoundingClientRect().bottom));
   await player.screenshot({path:resolve(out,`${label==='وب'?'web':'pwa'}-playback-${standalone?'standalone':'browser'}-${width}.png`)});
   guideMetadata.push({variant:label,...meta});
  }
  await tour.locator('.product-films-guide>summary').click();
  await tour.locator('.product-films-guide video').waitFor({state:'detached'});
  assert.equal(await tour.locator('video').count(),1);
  const cta=tour.getByRole('link',{name:'شروع رایگان',exact:false});
  assert.equal(await cta.getAttribute('href'),'/register');
  assert.deepEqual(errors,[]);
  const result={mode:standalone?"standalone-emulation":"browser",viewport:width,preview:previewMeta,guides:guideMetadata,errors};
  results.push(result);console.log(JSON.stringify(result));
  await context.close();
 }
 writeFileSync(resolve(out,'landing-qa.json'),JSON.stringify(results,null,2));
}
