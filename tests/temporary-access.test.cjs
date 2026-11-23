"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","supabase-data.js"),"utf8");
const deadline=Date.parse("2026-12-22T23:00:00Z");
function fixture(email,metadata,now=deadline-1000){
  let clock=now,timer=null,signouts=0,reloads=0;
  const storage=new Map(),user={id:email==="ferenc@kassza.diszkertek.hu"?"7a44a4a3-19cd-4bba-a3a2-c8a0b9b9709a":"other-test-id",email,app_metadata:metadata},client={auth:{
    signInWithPassword:async()=>({data:{user}}),getSession:async()=>({data:{session:{user}}}),
    signOut:async()=>{signouts++;}
  }};
  const context={window:{KASSZA_SUPABASE:{url:"https://example.test",publishableKey:"test"},supabase:{createClient:()=>client}},
    localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    Date:{now:()=>clock,parse:Date.parse},clearTimeout:()=>{timer=null;},setTimeout:(fn,delay)=>{timer={fn,delay};return 1;},
    location:{reload:()=>{reloads++;}}
  };
  vm.runInNewContext(source,context);
  return {db:context.window.KasszaDB,storage,user,get timer(){return timer;},get signouts(){return signouts;},get reloads(){return reloads;},setClock:value=>{clock=value;}};
}
(async()=>{
  const f=fixture("ferenc@kassza.diszkertek.hu",{cash_access_until:new Date(deadline).toISOString()});
  assert.equal((await f.db.login("Ferenc","test")).role,"manager");assert.equal(f.timer.delay,1000);
  assert.equal((await f.db.restore()).name,"Ferenc");
  f.setClock(deadline);await assert.rejects(f.db.restore(),/lejárt/);
  f.user.email="changed@example.test";await assert.rejects(f.db.restore(),/lejárt/);
  for(const now of [deadline,deadline+1]){
    const expired=fixture("ferenc@kassza.diszkertek.hu",{cash_access_until:new Date(deadline).toISOString()},now);
    await assert.rejects(expired.db.login("Ferenc","test"),/lejárt/);
  }
  for(const metadata of [{},{cash_access_until:"invalid"}])await assert.rejects(fixture("ferenc@kassza.diszkertek.hu",metadata).db.login("Ferenc","test"),/lejárt/);
  const open=fixture("ferenc@kassza.diszkertek.hu",{cash_access_until:new Date(deadline).toISOString()});
  await open.db.login("Ferenc","test");const callback=open.timer.fn;open.setClock(deadline);callback();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(open.signouts,1);assert.equal(open.reloads,1);
  const month=fixture("ferenc@kassza.diszkertek.hu",{cash_access_until:new Date(deadline).toISOString()},deadline-30*86400000);
  await month.db.login("Ferenc","test");assert.equal(month.timer.delay,86400000);
  for(const [name,email,role] of [["Ági","agi@kassza.diszkertek.hu","manager"],["Tamás","tamas@kassza.diszkertek.hu","manager"],["Ádám","adam@kassza.diszkertek.hu","worker"]]){
    const other=fixture(email,{cash_access_until:"2000-01-01"},deadline+1);
    assert.equal((await other.db.login(name,"test")).role,role);assert.equal(other.timer,null);
  }
  const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8"),body=app.match(/function populateLeaders\(\) \{([\s\S]*?)\n\}/)[1];
  for(const now of [deadline-1,deadline,deadline+1]){
    const fields={};vm.runInNewContext(body,{LEADERS:["Ági","Ferenc","Tamás"],Date:{now:()=>now,parse:Date.parse},escapeHTML:x=>x,$:key=>fields[key]??(fields[key]={insertAdjacentHTML:(_,html)=>fields[key].html=html})});
    assert.equal(fields["#profileButtons"].innerHTML.includes("Ferenc"),now<deadline);
    assert.equal(fields["#filterLeader"].html.includes("Ferenc"),true);
  }
  console.log("PASS: expiry boundary, saved session, open-tab logout, monthly timer, missing expiry denial, other users unchanged, historical filters retained");
})().catch(error=>{console.error(error);process.exitCode=1;});
