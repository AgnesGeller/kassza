const CACHE="diszkertek-kassza-v93";
const ASSETS=["./","index.html","styles.css","app.js","supabase-config.js","supabase-data.js","icon.svg","manifest.webmanifest","assets/diszkertek-logo.png","assets/diszkertek-emblem.png","assets/icon-192.png","assets/icon-512.png","assets/apple-touch-icon.png"];

self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener("activate",event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("push",event=>{let data={};try{data=event.data?.json()||{};}catch(_){data={body:event.data?.text()||"Új Kassza-értesítés érkezett."};}event.waitUntil(self.registration.showNotification(data.title||"Díszkertek Kassza",{body:data.body||"Védett dátumú mentési kísérlet történt.",icon:"assets/icon-192.png",badge:"assets/icon-192.png",tag:data.tag||"kassza-alert",data:{url:data.url||"./"}}));});
self.addEventListener("notificationclick",event=>{event.notification.close();const target=new URL(event.notification.data?.url||"./",self.location.origin).href;event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{const open=list.find(client=>client.url.startsWith(self.location.origin));if(open){open.navigate(target);return open.focus();}return clients.openWindow(target);}));});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request)));
});
