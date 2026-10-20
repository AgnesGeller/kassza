(function(){
  "use strict";
  const nativeValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
  const ungroup=value=>String(value??"").replace(/[\s\u00a0\u202f]/g,"");
  const grouped=value=>/^\d*$/.test(ungroup(value))?ungroup(value).replace(/\B(?=(\d{3})+(?!\d))/g," "):String(value??"");
  function enhance(input){
    const read=()=>nativeValue.get.call(input);
    const write=value=>nativeValue.set.call(input,grouped(value));
    input.type="text";input.inputMode="numeric";input.pattern="[1-9][0-9 ]*";
    input.removeAttribute("min");input.removeAttribute("step");
    Object.defineProperty(input,"value",{configurable:true,get(){return ungroup(read());},set(value){write(value);}});
    const format=()=>{
      const raw=read(),caret=input.selectionStart,digits=ungroup(raw.slice(0,caret)).length;
      if(!/^\d*$/.test(ungroup(raw)))return;
      write(raw);
      let position=0,count=0;
      while(position<read().length&&count<digits){if(read()[position]!==" ")count++;position++;}
      input.setSelectionRange(position,position);
    };
    input.addEventListener("input",event=>{if(!event.isComposing)format();});
    input.addEventListener("compositionend",format);
    input.addEventListener("keydown",event=>{
      if(input.selectionStart!==input.selectionEnd)return;
      const caret=input.selectionStart;
      if(event.key==="Backspace"&&read()[caret-1]===" ")input.setSelectionRange(caret-1,caret-1);
      if(event.key==="Delete"&&read()[caret]===" ")input.setSelectionRange(caret+1,caret+1);
    });
    input.form?.addEventListener("formdata",event=>{if(input.name&&!input.disabled)event.formData.set(input.name,input.value);});
    write(read());
  }
  document.querySelectorAll('#entryForm input[name="amount"],#managerAmountField').forEach(enhance);
})();
