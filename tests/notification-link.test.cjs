"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const handlers={},opened=[],notifications=[];
let windows=[];
const context={
 URL,
 self:{
  location:{href:"https://agnesgeller.github.io/kassza/service-worker.js?v=105",origin:"https://agnesgeller.github.io"},
  addEventListener:(name,handler)=>handlers[name]=handler,
  registration:{showNotification:async(title,options)=>notifications.push({title,options})}
 },
 clients:{matchAll:async()=>windows,openWindow:async url=>{opened.push(url);return url;}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,"..","service-worker.js"),"utf8"),context);
const expected="https://agnesgeller.github.io/kassza/";
async function click(url,list=[]){
 windows=list;opened.length=0;let promise,closed=false;
 handlers.notificationclick({notification:{data:{url},close(){closed=true;}},waitUntil(value){promise=value;}});
 await promise;assert(closed);return opened.slice();
}
(async()=>{
 for(const url of [undefined,"./","",expected,"https://github.com/AgnesGeller/kassza","/","/diszkertek-munkalap/","javascript:alert(1)","http://["]){
  assert.deepEqual(await click(url),[expected],"Notification must open Kassza: "+url);
 }
 assert.deepEqual(await click("?app-version=105"),[expected+"?app-version=105"]);
 let focused=0,otherFocused=0,navigated=0;
 const other={url:"https://agnesgeller.github.io/diszkertek-munkalap/",focus(){otherFocused++;},navigate(){navigated++;}};
 const own={url:expected+"?app-version=104",async focus(){focused++;return this;},navigate(){navigated++;}};
 assert.deepEqual(await click("./",[other,own]),[]);
 assert.equal(focused,1);assert.equal(otherFocused,0);assert.equal(navigated,0,"Preserve open app and unsaved form");
 assert.deepEqual(await click("./",[other]),[expected]);
 assert.equal(otherFocused,0);assert.equal(navigated,0,"Do not hijack another app");
 assert.deepEqual(await click("./",[{url:expected,async focus(){throw Error("Closed window");}}]),[expected]);
 let promise;
 handlers.push({data:{json:()=>({title:"Kassza",body:"Új tétel",url:"./"})},waitUntil(value){promise=value;}});
 await promise;
 assert.equal(notifications[0].options.data.url,expected,"Store canonical link in new notifications");
 console.log("PASS: existing relative links, canonical app URL, root/external URL fallback, correct window selection, no reload of open forms, closed-window recovery, push payload");
})().catch(error=>{console.error(error);process.exitCode=1;});

