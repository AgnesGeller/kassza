"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
const rows=[
  [12700,27,"Számlás"],[10500,5,"Számlás"],[10000,0,"Számlás"],
  [10000,null,"Nem számlás"],[12700,null,"Számlás"],[10550,5.5,"Számlás"],[11800,18,"Számlás"]
].map(([amount,vatRate,receipt],index)=>({
  date:"2026-10-15",leader:"Ági",direction:index%2?"income":"expense",category:"Egyéb",
  transferType:"",designation:"Tétel",receipt,amount,vatRate,partner:'Ügyfél; "idézet"',
  address:"",note:"Első sor\nMásodik sor",createdAt:"2026-10-15T10:00:00Z",updatedAt:"2026-10-15T11:00:00Z"
}));
const blobs=[],downloads=[];
const context={
  Blob,URL:{createObjectURL(blob){blobs.push(blob);return "blob:test";},revokeObjectURL(){}},
  document:{createElement(){return {click(){downloads.push(this.download);}};}},
  setTimeout:fn=>fn(),filteredEntries:()=>rows.slice(0,5),entries:()=>rows,
  formatDate:value=>value.replace(/^(\d{4})-(\d{2})-(\d{2})$/,"$1. $2. $3."),
  today:()=>"2026-10-15"
};
vm.createContext(context);
for(const name of ["cashVatAmount","cashVatExportValues"]){
  const line=source.split(/\r?\n/).find(value=>value.startsWith("function "+name+"("));
  assert(line,name+" missing");vm.runInContext(line,context);
}
vm.runInContext(source.slice(source.indexOf("function exportCSV()"),source.indexOf("function printOwnCash()")),context);
function parseCSV(text){
  assert.equal(text.charCodeAt(0),0xfeff,"UTF-8 BOM");
  const records=[];let record=[],cell="",quoted=false;
  for(let i=1;i<text.length;i++){
    const char=text[i];
    if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===";"&&!quoted){record.push(cell);cell="";}
    else if(char==="\r"&&text[i+1]==="\n"&&!quoted){record.push(cell);records.push(record);record=[];cell="";i++;}
    else cell+=char;
  }
  record.push(cell);records.push(record);assert.equal(quoted,false,"Balanced CSV quoting");return records;
}
(async()=>{
  context.exportCSV();context.exportBackup();
  const filtered=parseCSV(Buffer.from(await blobs[0].arrayBuffer()).toString("utf8"));
  const backup=parseCSV(Buffer.from(await blobs[1].arrayBuffer()).toString("utf8"));
  assert.equal(filtered.length,6,"Filtered export has five entries");
  assert.equal(backup.length,8,"Backup includes all seven entries");
  assert.equal(filtered[0].length,13);assert.equal(backup[0].length,15);
  for(const table of [filtered,backup]){
    assert.deepEqual(table[0].slice(-2),["Áfakulcs (%)","Áfa összege (Ft)"]);
    for(const row of table.slice(1)){assert.equal(row.length,table[0].length);assert.equal(row[0],"2026. 10. 15.");assert.equal(row[8],'Ügyfél; "idézet"');assert.equal(row[10],"Első sor\nMásodik sor");}
  }
  const expected=[["27","2700"],["5","500"],["0","0"],["",""],["27","2700"],["5,5","550"],["18","1800"]];
  for(let i=0;i<rows.length;i++){
    assert.deepEqual(backup[i+1].slice(-2),expected[i]);
    assert.equal(backup[i+1][7],String(rows[i].amount),"Gross amount unchanged");
    if(i<5)assert.deepEqual(filtered[i+1].slice(-2),expected[i]);
  }
  assert.match(downloads[0],/^kassza-/);assert.match(downloads[1],/^kassza-biztonsagi-mentes-/);
  console.log("PASS: VAT rates 27/18/5/5.5/0, legacy fallback, uninvoiced blanks, filtering, complete backup, gross amounts, Hungarian dates, BOM and quoted CSV fields");
})().catch(error=>{console.error(error);process.exitCode=1;});

