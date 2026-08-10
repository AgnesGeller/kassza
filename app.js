const STORAGE_KEY = "diszkertek-kassza-v1";
const SESSION_KEY = "diszkertek-kassza-session-v1";
const LEADERS = ["Ági", "Bendegúz", "Marci", "Márk", "Tamás"];
const MANAGERS = ["Ági", "Tamás"];
const CATEGORIES = {
  income: ["Bevétel – ügyféltől", "Pénzátvétel – munkatárstól"],
  expense: ["Működési költség", "Ügyfélkiadás", "Pénzátadás – munkatársnak"]
};

const $ = selector => document.querySelector(selector);
const welcomeView = $("#welcomeView"), appView = $("#appView"), form = $("#entryForm");
let session = readJSON(SESSION_KEY, null);
let pendingDeleteId = null;
let managerView = "statistics";

function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } }
function entries() { return readJSON(STORAGE_KEY, []); }
function saveEntries(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
function today() { const d=new Date(), off=d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,10); }
function money(value) { return new Intl.NumberFormat("hu-HU",{style:"currency",currency:"HUF",maximumFractionDigits:0}).format(Number(value)||0); }
function formatDate(value) { if(!value)return ""; return new Intl.DateTimeFormat("hu-HU").format(new Date(`${value}T12:00:00`)); }
function escapeHTML(value) { return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }

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
  const customer=!coworker&&!operating;
  $("#categoryLabel").textContent=direction==="income"?"Bevétel típusa":"Kategória";
  $("#partnerLabel").textContent=coworker?"Munkatárs neve":"Ügyfél neve";
  $("#partnerFieldWrap").hidden=operating;
  $("#partnerField").disabled=operating;
  $("#partnerField").required=!operating;
  $("#addressFieldWrap").hidden=!customer;
  $("#addressField").disabled=!customer;
  $("#addressField").required=customer;
  $("#receiptFieldWrap").hidden=direction!=="expense";
  $("#receiptField").disabled=direction!=="expense";
  $("#receiptField").required=direction==="expense";
}
function openApp(nextSession) {
  session=nextSession; localStorage.setItem(SESSION_KEY,JSON.stringify(session));
  welcomeView.hidden=true; appView.hidden=false;
  const admin=session.role==="admin",manager=session.role==="manager",hasStatistics=admin||manager;
  managerView="statistics";
  $("#managerTabs").hidden=!manager;
  $("#workerPanel").hidden=admin||manager; $("#adminPanel").hidden=!hasStatistics;
  $("#managerStatsTab").classList.toggle("active",manager);
  $("#managerEntryTab").classList.remove("active");
  $("#balanceLabel").textContent=hasStatistics?"Teljes kassza":"Kasszámban";
  $("#activeUser").textContent=admin?"Munkáltató":manager?`${session.name} · teljes nézet`:session.name;
  $("#viewEyebrow").textContent=hasStatistics?"TELJES ÁTTEKINTÉS":"MAI KASSZA";
  $("#viewTitle").textContent=admin?"Kassza áttekintő":manager?`Szia, ${session.name}!`:`Szia, ${session.name}!`;
  render();
}
function switchUser() { localStorage.removeItem(SESSION_KEY); session=null; appView.hidden=true; welcomeView.hidden=false; $("#profileSelect").value=""; $("#selectedProfileName").textContent="Név kiválasztása"; $("#profileButtons").hidden=true; $("#profileDropdownButton").setAttribute("aria-expanded","false"); $("#profileButtons").querySelectorAll(".profile-button").forEach(button=>button.classList.remove("active")); $("#enterButton").disabled=true; }
function filteredEntries() {
  let list=entries();
  if(session?.role!=="admin"&&session?.role!=="manager") return list.filter(item=>item.leader===session.name);
  const from=$("#filterFrom").value,to=$("#filterTo").value,leader=$("#filterLeader").value,q=$("#filterText").value.trim().toLocaleLowerCase("hu");
  return list.filter(item=>(!from||item.date>=from)&&(!to||item.date<=to)&&(!leader||item.leader===leader)&&(!q||[item.designation,item.partner,item.address,item.note,item.category,item.receipt].join(" ").toLocaleLowerCase("hu").includes(q)));
}
function totals(list) {
  return list.reduce((acc,item)=>{acc[item.direction]+=Number(item.amount);return acc;},{income:0,expense:0});
}
function renderSummary(list) {
  const sum=totals(list); $("#incomeValue").textContent=money(sum.income); $("#expenseValue").textContent=money(sum.expense); $("#balanceValue").textContent=money(sum.income-sum.expense);
}
function renderRecent(list) {
  const target=$("#recentEntries"),recent=[...list].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,6);
  const ownTotal=totals(list);$("#ownCashValue").textContent=money(ownTotal.income-ownTotal.expense);
  target.innerHTML=recent.length?recent.map(item=>`<div class="entry-item"><span class="entry-symbol ${item.direction}">${item.direction==="income"?"+":"−"}</span><span class="entry-info"><b>${escapeHTML(item.designation||item.partner||item.category)}</b><small>${formatDate(item.date)} · ${escapeHTML(item.category)}${item.receipt?` · ${escapeHTML(item.receipt)}`:""}</small></span><span class="entry-amount ${item.direction}">${item.direction==="income"?"+":"−"}${money(item.amount)}</span></div>`).join(""):`<div class="empty-list">Nincs bejegyzés</div>`;
}
function renderTable(list) {
  const sorted=[...list].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  $("#entriesTable").innerHTML=sorted.map(item=>`<tr><td>${formatDate(item.date)}</td><td><b>${escapeHTML(item.leader)}</b></td><td><span class="type-pill ${item.direction}">${item.direction==="income"?"Bevétel":"Kiadás"}</span></td><td><b>${escapeHTML(item.designation||item.partner||"–")}</b><br><small>${escapeHTML([item.partner,item.address,item.note].filter(Boolean).join(" · "))}</small></td><td>${escapeHTML(item.category)}${item.receipt?`<br><small>${escapeHTML(item.receipt)}</small>`:""}</td><td class="number"><b>${item.direction==="income"?"+":"−"}${money(item.amount)}</b></td><td><button class="delete-row" data-delete="${item.id}" title="Törlés">✕</button></td></tr>`).join("");
  $("#emptyTable").hidden=sorted.length>0;
}
function render() { if(!session)return; const list=filteredEntries(); if(session.role==="admin"){renderSummary(list);renderTable(list);}else if(session.role==="manager"){const own=entries().filter(item=>item.leader===session.name);renderSummary(managerView==="own"?own:list);renderRecent(own);renderTable(list);$("#balanceLabel").textContent=managerView==="own"?"Kasszámban":"Teljes kassza";}else{renderSummary(list);renderRecent(list);$("#balanceLabel").textContent="Kasszámban";} }

function exportCSV() {
  const rows=[["Dátum","Csoportvezető","Típus","Kategória","Megnevezés","Bizonylat","Összeg (Ft)","Ügyfél / munkatárs","Ügyfél címe","Megjegyzés"],...filteredEntries().map(x=>[x.date,x.leader,x.direction==="income"?"Bevétel":"Kiadás",x.category,x.designation,x.receipt,x.amount,x.partner,x.address,x.note])];
  const csv="\ufeff"+rows.map(row=>row.map(cell=>`"${String(cell??"").replaceAll('"','""')}"`).join(";")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a"); a.href=url;a.download=`kassza-${today()}.csv`;a.click();URL.revokeObjectURL(url);
}

populateLeaders(); updateCategories(); form.elements.date.value=today();
$("#profileSelect").addEventListener("change",e=>$("#enterButton").disabled=!e.target.value);
$("#profileDropdownButton").addEventListener("click",()=>{const menu=$("#profileButtons"),willOpen=menu.hidden;menu.hidden=!willOpen;$("#profileDropdownButton").setAttribute("aria-expanded",String(willOpen));});
$("#profileButtons").addEventListener("click",e=>{const button=e.target.closest("[data-profile]");if(!button)return;$("#profileSelect").value=button.dataset.profile;$("#selectedProfileName").textContent=button.dataset.profile;$("#profileButtons").querySelectorAll(".profile-button").forEach(item=>item.classList.toggle("active",item===button));$("#profileButtons").hidden=true;$("#profileDropdownButton").setAttribute("aria-expanded","false");$("#enterButton").disabled=false;});
document.addEventListener("click",e=>{if(!e.target.closest(".profile-dropdown")){$("#profileButtons").hidden=true;$("#profileDropdownButton").setAttribute("aria-expanded","false");}});
$("#enterButton").addEventListener("click",()=>{const name=$("#profileSelect").value;openApp({role:MANAGERS.includes(name)?"manager":"worker",name});});
$("#managerStatsTab").addEventListener("click",()=>{managerView="statistics";$("#workerPanel").hidden=true;$("#adminPanel").hidden=false;$("#managerStatsTab").classList.add("active");$("#managerEntryTab").classList.remove("active");render();});
$("#managerEntryTab").addEventListener("click",()=>{managerView="own";$("#adminPanel").hidden=true;$("#workerPanel").hidden=false;$("#managerEntryTab").classList.add("active");$("#managerStatsTab").classList.remove("active");render();});
$("#switchUser").addEventListener("click",switchUser); $("#homeLink").addEventListener("click",e=>{e.preventDefault();switchUser();});
form.addEventListener("change",e=>{if(e.target.name==="direction")updateCategories();if(e.target.name==="category")updatePartnerField();});
form.addEventListener("submit",e=>{e.preventDefault();if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));const list=entries();list.push({id:crypto.randomUUID?.()||String(Date.now()),leader:session.name,direction:data.direction,category:data.category,designation:String(data.designation||"").trim(),receipt:String(data.receipt||"").trim(),date:data.date,amount:Number(data.amount),partner:String(data.partner||"").trim(),address:String(data.address||"").trim(),note:String(data.note||"").trim(),createdAt:new Date().toISOString()});saveEntries(list);const direction=data.direction;form.reset();form.elements.direction.value=direction;form.elements.date.value=today();updateCategories();$("#formStatus").textContent="✓ A bejegyzést elmentettük.";setTimeout(()=>$("#formStatus").textContent="",2500);render();});
[$("#filterFrom"),$("#filterTo"),$("#filterLeader")].forEach(el=>el.addEventListener("change",render)); $("#filterText").addEventListener("input",render);
$("#clearFilters").addEventListener("click",()=>{$("#filterFrom").value="";$("#filterTo").value="";$("#filterLeader").value="";$("#filterText").value="";render();});
$("#entriesTable").addEventListener("click",e=>{const button=e.target.closest("[data-delete]");if(!button)return;pendingDeleteId=button.dataset.delete;$("#confirmDialog").showModal();});
$("#confirmDelete").addEventListener("click",()=>{if(!pendingDeleteId)return;saveEntries(entries().filter(x=>x.id!==pendingDeleteId));pendingDeleteId=null;render();});
$("#exportButton").addEventListener("click",exportCSV); $("#showAllOwn").addEventListener("click",()=>$("#recentEntries").scrollIntoView({behavior:"smooth"}));
const isInstalled=()=>window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
let installPrompt;
function syncInstallButton(){$("#installButton").hidden=isInstalled();}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;syncInstallButton();});
window.addEventListener("appinstalled",()=>{installPrompt=null;syncInstallButton();});
$("#installButton").addEventListener("click",async()=>{if(isInstalled()){syncInstallButton();return;}if(installPrompt){installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice.outcome==="accepted")$("#installButton").hidden=true;installPrompt=null;return;}$("#installHelpDialog").showModal();});
$("#updateButton").addEventListener("click",async()=>{const button=$("#updateButton"),original=button.textContent;button.disabled=true;button.textContent="Frissítés…";try{if("serviceWorker" in navigator){const registration=await navigator.serviceWorker.getRegistration();if(registration){await registration.update();if(registration.waiting)registration.waiting.postMessage({type:"SKIP_WAITING"});}const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith("diszkertek-kassza-")).map(key=>caches.delete(key)));}button.textContent="✓ Naprakész";button.classList.add("update-success");setTimeout(()=>location.reload(),700);}catch(_){button.textContent="Nem sikerült";button.classList.add("update-error");button.disabled=false;setTimeout(()=>{button.textContent=original;button.classList.remove("update-error");},2500);}});
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));navigator.serviceWorker.addEventListener("controllerchange",()=>location.reload());}
syncInstallButton();
if(session?.role==="worker"&&MANAGERS.includes(session.name))session.role="manager";
if(session?.role==="admin"||(["worker","manager"].includes(session?.role)&&LEADERS.includes(session.name)))openApp(session);
