const CACHE="diszkertek-kassza-v107";
const CASH_APP_URL=new URL("./",self.location.href);
function cashNotificationUrl(value){try{const url=new URL(value||"./",CASH_APP_URL);if(url.origin===CASH_APP_URL.origin&&url.pathname.startsWith(CASH_APP_URL.pathname))return url.href;}catch(_){}return CASH_APP_URL.href;}
function isCashWindow(client){try{const url=new URL(client.url);return url.origin===CASH_APP_URL.origin&&url.pathname.startsWith(CASH_APP_URL.pathname);}catch(_){return false;}}
const ASSETS=["./","index.html","styles.css","app.js","hungarian-dates.js","amount-inputs.js","supabase-config.js","supabase-data.js","icon.svg","manifest.webmanifest","assets/diszkertek-logo.png","assets/diszkertek-emblem.png","assets/icon-192.png","assets/icon-512.png","assets/apple-touch-icon.png"];

self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("push",event=>{let data={};try{data=event.data?.json()||{};}catch(_){data={body:event.data?.text()||"Új Kassza-értesítés érkezett."};}event.waitUntil(self.registration.showNotification(data.title||"Díszkertek Kassza",{body:data.body||"Változás történt a kasszádban.",icon:"assets/icon-192.png",badge:"assets/icon-192.png",tag:data.tag||"kassza-alert",data:{url:cashNotificationUrl(data.url)}}));});
self.addEventListener("notificationclick",event=>{event.notification.close();const target=cashNotificationUrl(event.notification.data?.url);event.waitUntil((async()=>{const list=await clients.matchAll({type:"window",includeUncontrolled:true});const open=list.find(isCashWindow);if(open)try{return await open.focus();}catch(_){}return clients.openWindow(target);})());});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request)));
});
