"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
class Input{
  constructor(name){this.raw="";this.name=name;this.handlers={};this.form={addEventListener:(name,fn)=>this.formDataHandler=fn};}
  get value(){return this.raw;}
  set value(value){this.raw=String(value);}
  removeAttribute(){}
  addEventListener(name,fn){this.handlers[name]=fn;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  typeValue(value,caret=value.length){this.raw=value;this.setSelectionRange(caret,caret);this.handlers.input({});}
}
const own=new Input("amount"),manager=new Input("");
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","amount-inputs.js"),"utf8"),{HTMLInputElement:Input,document:{querySelectorAll:()=>[own,manager]}});
for(const input of [own,manager]){
  for(const [value,expected] of [["1","1"],["1000","1 000"],["1000000","1 000 000"],["123456789","123 456 789"],["",""]]){
    input.typeValue(value);assert.equal(input.raw,expected);assert.equal(input.value,value);assert.equal(Number(input.value),Number(value));
  }
  input.value=123456;assert.equal(input.raw,"123 456");assert.equal(input.value,"123456");
  input.typeValue("1\u00a0000\u202f000");assert.equal(input.raw,"1 000 000");assert.equal(input.value,"1000000");
  input.typeValue("1234000",3);assert.equal(input.raw,"1 234 000");assert.equal(input.selectionStart,4);
  input.value="1000";input.setSelectionRange(2,2);input.handlers.keydown({key:"Backspace"});assert.equal(input.selectionStart,1);
  input.setSelectionRange(1,1);input.handlers.keydown({key:"Delete"});assert.equal(input.selectionStart,2);
  for(const invalid of ["-100","1.5","1,5","100Ft"]){input.typeValue(invalid);assert.equal(input.raw,invalid);assert.equal(new RegExp("^(?:"+input.pattern+")$").test(input.raw),false);}
  input.value="0";assert.equal(new RegExp("^(?:"+input.pattern+")$").test(input.raw),false);
}
own.value=100000;const values=new Map();own.formDataHandler({formData:values});assert.equal(values.get("amount"),"100000");
console.log("PASS: both amount fields, grouping, raw values, edit prefilling, paste, cursor, deletion, validation and FormData");
