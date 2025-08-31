const CACHE="wcloud-cache-v1";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.json","./logo.png","./icons/icon-180x180.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))) });
self.addEventListener("fetch",e=>{ if(e.request.method!=="GET") return; e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))) });