'use strict';
const CACHE='subscription-tracker-5c3dc677ce7ffb6f';
const PREFIX='subscription-tracker-';
const ASSETS=['./','./index.html','./app.js','./updates.js','./styles.css','./themes.js','./manifest.webmanifest','./icon.svg','./fonts/manrope-variable.ttf','./fonts/lora-variable.ttf'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(
    ASSETS.map(url=>new Request(url,{cache:'reload'}))
  )));
  // A replacement waits until the user chooses Update now.
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  // Serve one consistent installed release, including when offline.
  // Shell changes produce a new revision; update checks bypass HTTP caches.
  if(!ASSETS.some(asset=>new URL(asset,self.registration.scope).href===url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    return await cache.match(event.request)||fetch(new Request(event.request,{cache:'no-store'}));
  })());
});
