const STORAGE_KEY = "diszkertek-kassza-v1";
const MANAGER_VIEW_KEY = "diszkertek-kassza-manager-view-v1";
const ACTIVE_CASH_KEY = "diszkertek-kassza-active-cash-v1";
const LEADERS = ["Ági", "Bendegúz", "Marci", "Márk", "Tamás"];
const MANAGERS = ["Ági", "Tamás"];
const CATEGORIES = {
  income: ["Bevétel – ügyféltől", "Pénzátvétel – munkatárstól", "Egyéb"],
  expense: ["Működési költség", "Ügyfélkiadás", "Pénzátadás – munkatársnak", "Egyéb"]
};

const $ = selector => document.querySelector(selector);
const welcomeView = $("#welcomeView"), appView = $("#appView"), form = $("#entryForm");
let session = null;
let rememberedSession = null;
let managerIdentity = null;
let restorePromise = Promise.resolve();
let profileDirectory = [];
let entryCache = [];
let pendingDeleteId = null;
let managerView = "statistics";
let editingId = null;
let showAllOwnEntries = false;
let showAllPeriods = false;
let weekOffset = 0;
let realtimeRefreshTimer = null;

function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } }
function entries() { return entryCache; }
async function refreshEntries() { entryCache=await KasszaDB.list(); render(); }
function scheduleEntriesRefresh() { clearTimeout(realtimeRefreshTimer); realtimeRefreshTimer=setTimeout(()=>refreshEntries().catch(()=>{}),700); }
function today() { const d=new Date(), off=d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,10); }
function money(value) { return new Intl.NumberFormat("hu-HU",{style:"currency",currency:"HUF",maximumFractionDigits:0}).format(Number(value)||0); }
function formatDate(value) { if(!value)return ""; return new Intl.DateTimeFormat("hu-HU").format(new Date(`${value}T12:00:00`)); }
function isoDate(date){const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,"0"),day=String(date.getDate()).padStart(2,"0");return `${year}-${month}-${day}`;}
function selectedWeek(){const base=new Date(),distance=(base.getDay()+2)%7;const start=new Date(base.getFullYear(),base.getMonth(),base.getDate()-distance+weekOffset*7),end=new Date(start.getFullYear(),start.getMonth(),start.getDate()+6);return {start,end,startISO:isoDate(start),endISO:isoDate(end)};}
function escapeHTML(value) { return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function syncManagerTheme(){document.body.classList.toggle("manager-statistics",session?.role==="manager"&&managerView==="statistics");document.body.classList.toggle("manager-own",session?.role==="manager"&&managerView==="own");}

function populateLeaders() {
  $("#profileSelect").insertAdjacentHTML("beforeend",LEADERS.map(n=>`<option>${escapeHTML(n)}</option>`).join(""));
  $("#profileButtons").innerHTML=LEADERS.map(n=>`<button class="profile-button" type="button" data-profile="${escapeHTML(n)}">${escapeHTML(n)}</button>`).join("");
  $("#filterLeader").insertAdjacentHTML("beforeend",LEADERS.map(n=>`<option>${escapeHTML(n)}</option>`).join(""));
}
function updateCategories() {
  const direction=form.elements.direction.value;
  $("#categorySelect").innerHTML=CATEGORIES[direction].map(c=>`<option>${escapeHTML(c)}</option>`).join("");
  updatePartnerField();
}
function updatePartnerField() {
  const direction=form.elements.direction.value;
  const category=$("#categorySelect").value;
  const coworker=category.includes("munkatárstól")||category.includes("munkatársnak");
  const operating=direction==="expense"&&category==="Működési költség";
  const coworkerTransfer=direction==="expense"&&category==="Pénzátadás – munkatársnak";
  const incomeFromCustomer=direction==="income"&&category==="Bevétel – ügyféltől";
  const incomeFromCoworker=direction==="income"&&category==="Pénzátvétel – munkatárstól";
  const otherIncome=direction==="income"&&category==="Egyéb";
  const otherExpense=direction==="expense"&&category==="Egyéb";
  const otherEntry=otherIncome||otherExpense;
  const customerExpense=direction==="expense"&&category==="Ügyfélkiadás";
  $("#categoryLabel").textContent=direction==="income"?"Bevétel típusa":"Kiadás típusa";
  $("#partnerLabel").textContent=coworker?"Munkatárs neve":"Ügyfél neve";
  $("#partnerFieldWrap").hidden=operating||otherIncome||otherExpense;
  $("#partnerField").disabled=operating||otherIncome||otherExpense;
  $("#partnerField").required=!operating&&!otherIncome&&!otherExpense;
  $("#designationFieldWrap").hidden=incomeFromCustomer||incomeFromCoworker||coworkerTransfer;
  $("#designationField").disabled=incomeFromCustomer||incomeFromCoworker||coworkerTransfer;
  $("#designationField").required=!incomeFromCustomer&&!incomeFromCoworker&&!coworkerTransfer;
  $("#addressFieldWrap").hidden=true;
  $("#addressField").disabled=true;
  $("#addressField").required=false;
  $("#receiptFieldWrap").hidden=direction!=="expense"||coworkerTransfer||otherExpense;
  $("#receiptField").disabled=direction!=="expense"||coworkerTransfer||otherExpense;
  $("#receiptField").required=direction==="expense"&&!coworkerTransfer&&!otherExpense;
  $("#transferTypeWrap").hidden=!coworkerTransfer;
  $("#transferTypeField").disabled=!coworkerTransfer;
  $("#transferTypeField").required=coworkerTransfer;
  $("#noteFieldWrap").hidden=customerExpense;
  $("#noteField").disabled=customerExpense;
  $("#noteField").required=otherEntry;
}
async function openApp(nextSession) {
  session=nextSession;rememberedSession=nextSession;
  if(nextSession.role==="manager"&&!nextSession.actingManager){managerIdentity=nextSession;KasszaDB.profiles().then(items=>profileDirectory=items).catch(()=>{});}
  welcomeView.hidden=true; appView.hidden=false;
  const admin=session.role==="admin",manager=session.role==="manager",hasStatistics=admin||manager;
  managerView=manager&&localStorage.getItem(MANAGER_VIEW_KEY)==="own"?"own":"statistics";
  syncManagerTheme();
  $("#managerTabs").hidden=!manager;
  $("#workerPanel").hidden=admin||(manager&&managerView==="statistics"); $("#adminPanel").hidden=!hasStatistics||(manager&&managerView==="own");
  $("#managerStatsTab").classList.toggle("active",manager&&managerView==="statistics");
  $("#managerEntryTab").classList.toggle("active",manager&&managerView==="own");
  $("#balanceLabel").textContent=hasStatistics&&managerView!=="own"?"Teljes kassza":"Kasszámban";
  $("#activeUser").textContent=admin?"Munkáltató":session.name;
  $("#switchUser").textContent=(manager||session.actingManager)?"Kijelentkezés / Név váltás":"Kijelentkezés";
  $("#viewTitle").textContent=admin?"Kassza áttekintő":`Szia, ${session.name}!`;
  await refreshEntries();
}
function switchUser() { resetEntryEditor();showAllOwnEntries=false;showAllPeriods=false;weekOffset=0;localStorage.removeItem(ACTIVE_CASH_KEY);session=null;entryCache=[];document.body.classList.remove("manager-statistics","manager-own");appView.hidden=true;welcomeView.hidden=false;$("#profileSelect").value="";$("#selectedProfileName").textContent="Név kiválasztása";$("#pinField").value="";$("#pinFieldWrap").hidden=true;$("#profileButtons").hidden=true;$("#profileDropdownButton").setAttribute("aria-expanded","false");$("#profileButtons").querySelectorAll(".profile-button").forEach(button=>button.classList.remove("active"));$("#enterButton").disabled=true;}
async function openManagerCash(name){if(!profileDirectory.length)profileDirectory=await KasszaDB.profiles();const target=profileDirectory.find(item=>item.name===name);if(!target)throw new Error("A kassza nem található.");localStorage.setItem(ACTIVE_CASH_KEY,name);if(name===managerIdentity.name)return openApp(managerIdentity);return openApp({...target,actingManager:true,managerName:managerIdentity.name});}
function filteredEntries() {
  let list=entries();
  if(session?.role!=="admin"&&session?.role!=="manager") return list.filter(item=>item.leader===session.name);
  const from=$("#filterFrom").value,to=$("#filterTo").value,leader=$("#filterLeader").value,q=$("#filterText").value.trim().toLocaleLowerCase("hu");
  return list.filter(item=>(!from||item.date>=from)&&(!to||item.date<=to)&&(!leader||item.leader===leader)&&(!q||[item.designation,item.partner,item.address,item.note,item.category,item.receipt,item.transferType].join(" ").toLocaleLowerCase("hu").includes(q)));
}
function totals(list) {
  return list.reduce((acc,item)=>{acc[item.direction]+=Number(item.amount);return acc;},{income:0,expense:0});
}
function renderSummary(list) {
  const sum=totals(list); $("#incomeValue").textContent=money(sum.income); $("#expenseValue").textContent=money(sum.expense); $("#balanceValue").textContent=money(sum.income-sum.expense);
}
function renderRecent(list) {
  const target=$("#recentEntries"),week=selectedWeek(),weekly=list.filter(item=>item.date>=week.startISO&&item.date<=week.endISO),recent=[...weekly].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const ownTotal=totals(list);$("#ownCashValue").textContent=money(ownTotal.income-ownTotal.expense);
  const weekTotal=totals(weekly),hasFutureEntry=list.some(item=>item.date>week.endISO);$("#weekRange").textContent=`${formatDate(week.startISO)} – ${formatDate(week.endISO)}`;$("#weeklyIncome").textContent=money(weekTotal.income);$("#weeklyExpense").textContent=money(weekTotal.expense);$("#weeklyBalance").textContent=money(weekTotal.income-weekTotal.expense);$("#nextWeek").disabled=weekOffset>=0&&!hasFutureEntry;$("#previousWeek").disabled=false;
  target.innerHTML=recent.length?recent.map(item=>`<div class="entry-item"><span class="entry-symbol ${item.direction}">${item.direction==="income"?"+":"−"}</span><span class="entry-info"><b>${escapeHTML(item.designation||item.transferType||item.partner||item.category)}</b><small>${formatDate(item.date)} · ${escapeHTML(item.category)}${item.transferType?` · ${escapeHTML(item.transferType)}`:""}${item.receipt?` · ${escapeHTML(item.receipt)}`:""}</small></span><span class="entry-side"><span class="entry-amount ${item.direction}">${item.direction==="income"?"+":"−"}${money(item.amount)}</span><span class="entry-actions"><button class="entry-action" type="button" data-edit-own="${item.id}" aria-label="Szerkesztés">✎</button><button class="entry-action delete" type="button" data-delete-own="${item.id}" aria-label="Törlés">✕</button></span></span></div>`).join(""):`<div class="empty-list">Nincs bejegyzés</div>`;
}
function renderTable(list) {
  const sorted=[...list].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  $("#entriesTable").innerHTML=sorted.map(item=>`<tr><td>${formatDate(item.date)}</td><td><b>${escapeHTML(item.leader)}</b></td><td><span class="type-pill ${item.direction}">${item.direction==="income"?"Bevétel":"Kiadás"}</span></td><td><b>${escapeHTML(item.designation||item.transferType||item.partner||"–")}</b><br><small>${escapeHTML([item.partner,item.address,item.note].filter(Boolean).join(" · "))}</small></td><td>${escapeHTML(item.category)}${item.transferType?`<br><small>${escapeHTML(item.transferType)}</small>`:""}${item.receipt?`<br><small>${escapeHTML(item.receipt)}</small>`:""}</td><td class="number"><b>${item.direction==="income"?"+":"−"}${money(item.amount)}</b></td><td><button class="delete-row" data-delete="${item.id}" title="Törlés">✕</button></td></tr>`).join("");
  $("#emptyTable").hidden=sorted.length>0;
}
function render() { if(!session)return; const list=filteredEntries(); if(session.role==="admin"){renderSummary(list);renderTable(list);}else if(session.role==="manager"){const own=entries().filter(item=>item.leader===session.name);renderSummary(managerView==="own"?own:list);renderRecent(own);renderTable(list);$("#balanceLabel").textContent=managerView==="own"?"Kasszámban":"Teljes kassza";}else{renderSummary(list);renderRecent(list);$("#balanceLabel").textContent="Kasszámban";} }

function exportCSV() {
  const rows=[["Dátum","Csoportvezető","Típus","Kategória","Pénzátadás típusa","Megnevezés","Bizonylat","Összeg (Ft)","Ügyfél / munkatárs","Ügyfél címe","Megjegyzés"],...filteredEntries().map(x=>[x.date,x.leader,x.direction==="income"?"Bevétel":"Kiadás",x.category,x.transferType,x.designation,x.receipt,x.amount,x.partner,x.address,x.note])];
  const csv="\ufeff"+rows.map(row=>row.map(cell=>`"${String(cell??"").replaceAll('"','""')}"`).join(";")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a"); a.href=url;a.download=`kassza-${today()}.csv`;a.click();URL.revokeObjectURL(url);
}
function exportBackup(){const rows=[["Dátum","Csoportvezető","Típus","Kategória","Pénzátadás típusa","Megnevezés","Bizonylat","Összeg (Ft)","Ügyfél / munkatárs","Ügyfél címe","Megjegyzés","Létrehozva","Módosítva"],...entries().map(x=>[x.date,x.leader,x.direction==="income"?"Bevétel":"Kiadás",x.category,x.transferType,x.designation,x.receipt,x.amount,x.partner,x.address,x.note,x.createdAt,x.updatedAt])];const csv="\ufeff"+rows.map(row=>row.map(cell=>`"${String(cell??"").replaceAll('"','""')}"`).join(";")).join("\r\n"),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=`kassza-biztonsagi-mentes-${today()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function printOwnCash(){const previousShowAll=showAllOwnEntries,oldTitle=document.title;showAllOwnEntries=true;document.body.classList.add("print-own-cash");document.title=`${session.name}-kassza-${selectedWeek().startISO}-${selectedWeek().endISO}`;render();const cleanup=()=>{document.body.classList.remove("print-own-cash");document.title=oldTitle;showAllOwnEntries=previousShowAll;render();};window.addEventListener("afterprint",cleanup,{once:true});window.print();}
function weeklyShareData(){const week=selectedWeek(),own=entries().filter(item=>item.leader===session.name&&item.date>=week.startISO&&item.date<=week.endISO),sum=totals(own);return {subject:`${session.name} kassza – ${week.startISO}–${week.endISO}`,text:[`Kassza – ${session.name}`,`${formatDate(week.startISO)} – ${formatDate(week.endISO)}`,`Bevétel: ${money(sum.income)}`,`Kiadás: ${money(sum.expense)}`,`Különbözet: ${money(sum.income-sum.expense)}`,`Tételek száma: ${own.length}`].join("\n")};}
function showShareThanks(){sessionStorage.setItem("kassza-share-thanks","1");const status=$("#shareStatus");status.textContent="Köszönöm, hogy elküldted a kasszát. 😊 Nagyon cuki vagy ❤️";}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&sessionStorage.getItem("kassza-share-thanks")==="1"){const status=$("#shareStatus");if(status){status.textContent="Köszönöm, hogy elküldted a kasszát. 😊 Nagyon cuki vagy ❤️";setTimeout(()=>{status.textContent="";sessionStorage.removeItem("kassza-share-thanks");},10000);}}});
function shareViber(){const data=weeklyShareData();showShareThanks();location.href=`viber://forward?text=${encodeURIComponent(data.text)}`;}
function shareEmail(){const data=weeklyShareData(),url=`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent("info@diszkertek.hu")}&su=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.text)}`;showShareThanks();window.open(url,"_blank","noopener,noreferrer");}

function resetEntryEditor(direction="income") {
  editingId=null;form.reset();form.elements.direction.value=direction;form.elements.date.value=today();updateCategories();
  form.querySelector(".submit-entry").textContent="Bejegyzés mentése";$("#cancelEdit").hidden=true;
}
function editOwnEntry(id) {
  const item=entries().find(entry=>entry.id===id&&entry.leader===session?.name);if(!item)return;
  editingId=item.id;form.elements.direction.value=item.direction;updateCategories();
  if(![...$("#categorySelect").options].some(option=>option.value===item.category))$("#categorySelect").add(new Option(item.category,item.category));
  $("#categorySelect").value=item.category;updatePartnerField();
  form.elements.date.value=item.date;form.elements.designation.value=item.designation||"";form.elements.amount.value=item.amount;
  $("#partnerField").value=item.partner||"";$("#addressField").value=item.address||"";form.elements.note.value=item.note||"";$("#receiptField").value=item.receipt||"";$("#transferTypeField").value=item.transferType||"";
  form.querySelector(".submit-entry").textContent="Módosítás mentése";$("#cancelEdit").hidden=false;$("#entryForm").scrollIntoView({behavior:"smooth",block:"start"});
}

populateLeaders(); updateCategories(); form.elements.date.value=today();
$("#profileSelect").addEventListener("change",e=>$("#enterButton").disabled=!e.target.value);
$("#profileDropdownButton").addEventListener("click",()=>{const menu=$("#profileButtons"),willOpen=menu.hidden;menu.hidden=!willOpen;$("#profileDropdownButton").setAttribute("aria-expanded",String(willOpen));});
$("#profileButtons").addEventListener("click",async e=>{const button=e.target.closest("[data-profile]");if(!button)return;await restorePromise;const name=button.dataset.profile,remembered=Boolean(managerIdentity)||rememberedSession?.name===name;$("#profileSelect").value=name;$("#selectedProfileName").textContent=name;$("#profileButtons").querySelectorAll(".profile-button").forEach(item=>item.classList.toggle("active",item===button));$("#profileButtons").hidden=true;$("#profileDropdownButton").setAttribute("aria-expanded","false");$("#pinFieldWrap").hidden=remembered;$("#enterButton").disabled=false;if(!remembered)$("#pinField").focus();});
document.addEventListener("click",e=>{if(!e.target.closest(".profile-dropdown")){$("#profileButtons").hidden=true;$("#profileDropdownButton").setAttribute("aria-expanded","false");}});
async function login(){const button=$("#enterButton"),name=$("#profileSelect").value,pin=$("#pinField").value,status=$("#loginStatus");button.disabled=true;button.textContent="Belépés…";status.textContent="";try{await restorePromise;if(managerIdentity){await openManagerCash(name);return;}let next=rememberedSession?.name===name?rememberedSession:null;if(!next){if(!name||pin.length<6){status.textContent="Add meg a legalább 6 számjegyű PIN-kódot.";return;}next=await KasszaDB.login(name,pin);}await openApp(next);KasszaDB.subscribe(scheduleEntriesRefresh);}catch(error){status.textContent=error.message||"A belépés nem sikerült.";}finally{button.disabled=false;button.textContent="Belépés";}}
$("#enterButton").addEventListener("click",login);$("#pinField").addEventListener("keydown",e=>{if(e.key==="Enter")login();});
$("#managerStatsTab").addEventListener("click",()=>{managerView="statistics";localStorage.setItem(MANAGER_VIEW_KEY,managerView);syncManagerTheme();$("#workerPanel").hidden=true;$("#adminPanel").hidden=false;$("#managerStatsTab").classList.add("active");$("#managerEntryTab").classList.remove("active");render();});
$("#managerEntryTab").addEventListener("click",()=>{managerView="own";localStorage.setItem(MANAGER_VIEW_KEY,managerView);syncManagerTheme();$("#adminPanel").hidden=true;$("#workerPanel").hidden=false;$("#managerEntryTab").classList.add("active");$("#managerStatsTab").classList.remove("active");render();});
$("#switchUser").addEventListener("click",switchUser); $("#homeLink").addEventListener("click",e=>{e.preventDefault();switchUser();});
form.addEventListener("change",e=>{if(e.target.name==="direction")updateCategories();if(e.target.name==="category")updatePartnerField();});
form.addEventListener("submit",async e=>{e.preventDefault();if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form)),existing=editingId?entries().find(item=>item.id===editingId&&item.leader===session.name):null,record={leader:session.name,direction:data.direction,category:data.category,transferType:String(data.transferType||"").trim(),designation:String(data.designation||"").trim(),receipt:String(data.receipt||"").trim(),date:data.date,amount:Number(data.amount),partner:String(data.partner||"").trim(),address:String(data.address||"").trim(),note:String(data.note||"").trim()};const submit=form.querySelector(".submit-entry");submit.disabled=true;submit.textContent="Mentés…";try{const saved=existing?await KasszaDB.update(existing.id,record,session.userId):await KasszaDB.create(record,session.userId);if(saved.leader!==session.name||saved.userId!==session.userId)throw new Error("A tétel nem a kiválasztott kasszához került.");if(existing)entryCache=entryCache.map(item=>item.id===saved.id?saved:item);else entryCache=[saved,...entryCache];weekOffset=0;showAllOwnEntries=false;showAllPeriods=false;const direction=data.direction;resetEntryEditor(direction);$("#formStatus").textContent=`✓ ${money(saved.amount)} ${saved.direction==="income"?"bevétel":"kiadás"} elmentve ${saved.leader} kasszájába.`;render();setTimeout(()=>$("#formStatus").textContent="",6000);}catch(error){$("#formStatus").textContent=`Nem sikerült menteni: ${error.message}`;}finally{submit.disabled=false;submit.textContent="Bejegyzés mentése";}});
$("#cancelEdit").addEventListener("click",()=>resetEntryEditor(form.elements.direction.value));
$("#recentEntries").addEventListener("click",e=>{const editButton=e.target.closest("[data-edit-own]"),deleteButton=e.target.closest("[data-delete-own]");if(editButton)editOwnEntry(editButton.dataset.editOwn);if(deleteButton){const item=entries().find(entry=>entry.id===deleteButton.dataset.deleteOwn&&entry.leader===session?.name);if(!item)return;pendingDeleteId=item.id;$("#confirmDialog").showModal();}});
[$("#filterFrom"),$("#filterTo"),$("#filterLeader")].forEach(el=>el.addEventListener("change",render)); $("#filterText").addEventListener("input",render);
$("#clearFilters").addEventListener("click",()=>{$("#filterFrom").value="";$("#filterTo").value="";$("#filterLeader").value="";$("#filterText").value="";render();});
$("#entriesTable").addEventListener("click",e=>{const button=e.target.closest("[data-delete]");if(!button)return;pendingDeleteId=button.dataset.delete;$("#confirmDialog").showModal();});
$("#confirmDelete").addEventListener("click",async()=>{if(!pendingDeleteId)return;const id=pendingDeleteId;pendingDeleteId=null;try{await KasszaDB.remove(id);entryCache=entryCache.filter(item=>item.id!==id);render();}catch(error){alert(`Nem sikerült törölni: ${error.message}`);}});
$("#previousWeek").addEventListener("click",()=>{weekOffset--;showAllOwnEntries=false;showAllPeriods=false;render();});
$("#nextWeek").addEventListener("click",()=>{weekOffset++;showAllOwnEntries=false;showAllPeriods=false;render();});
$("#ownPdfButton").addEventListener("click",printOwnCash);$("#viberShareButton").addEventListener("click",shareViber);$("#emailShareButton").addEventListener("click",shareEmail);$("#pdfButton").addEventListener("click",()=>{const oldTitle=document.title;document.title=`Kassza-${today()}`;window.print();document.title=oldTitle;});$("#exportButton").addEventListener("click",exportCSV);$("#backupButton").addEventListener("click",exportBackup);
const isInstalled=()=>window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
let installPrompt;
function syncInstallButton(){$("#installButton").hidden=isInstalled();}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;syncInstallButton();});
function installMessage(text){const status=$("#installStatus");status.textContent=text;clearTimeout(installMessage.timer);installMessage.timer=setTimeout(()=>status.textContent="",5000);}
window.addEventListener("appinstalled",()=>{installPrompt=null;installMessage("✓ Az alkalmazás telepítve.");syncInstallButton();});
$("#installButton").addEventListener("click",async()=>{if(isInstalled()){installMessage("✓ Az alkalmazás már telepítve van.");syncInstallButton();return;}if(installPrompt){installMessage("Telepítési ablak megnyitva…");await installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice.outcome==="accepted"){installMessage("✓ Az alkalmazás telepítve.");$("#installButton").hidden=true;}else installMessage("A telepítés megszakítva.");installPrompt=null;return;}installMessage("A böngészőből kell telepíteni.");$("#installHelpDialog").showModal();});
async function updateApp(button){button.disabled=true;button.textContent="Frissítés…";let updated=false;try{if("serviceWorker" in navigator){const registration=await navigator.serviceWorker.getRegistration();if(registration){await registration.update();if(registration.waiting){registration.waiting.postMessage({type:"SKIP_WAITING"});updated=true;}}if("caches" in window){const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith("diszkertek-kassza-")).map(key=>caches.delete(key)));}}}catch(_){/* Az újratöltés ettől még biztonságosan elvégezhető. */}button.textContent=updated?"✓ Frissítve":"✓ Naprakész";button.classList.add("update-success");setTimeout(()=>location.reload(),700);}
[$("#updateButton"),$("#updateButtonMobile")].forEach(button=>button.addEventListener("click",()=>updateApp(button)));
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));navigator.serviceWorker.addEventListener("controllerchange",()=>location.reload());}
syncInstallButton();
if(!KasszaDB.configured)$("#loginStatus").textContent="A közös adatbázis beállítása szükséges.";
else restorePromise=KasszaDB.restore().then(async saved=>{if(saved){rememberedSession=saved;await openApp(saved);const activeCash=localStorage.getItem(ACTIVE_CASH_KEY);if(saved.role==="manager"&&activeCash&&activeCash!==saved.name)await openManagerCash(activeCash);KasszaDB.subscribe(scheduleEntriesRefresh);}}).catch(()=>{});
