const CACHE = 'aesthetic-manager-shell-v130';
const SHELL = ['./','./index.html','./app.js','./sync.js','./domain.js','./style.css','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
 const req = e.request; if(req.method !== 'GET')return;
 const u = new URL(req.url);if(u.origin!==self.location.origin || u.pathname.endsWith('/config.js'))return;
 e.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}return res}).catch(()=>caches.match(req)));
});
