(function(){
  "use strict";
  function parseISO(value){
    const text=String(value??"").trim().replace(/^(\d{4})(\d{2})(\d{2})$/,"$1-$2-$3");
    const match=text.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*\.?$/);
    if(!match)return "";
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    if(year<1||month<1||month>12)return "";
    const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(day<1||day>days[month-1])return "";
    return `${match[1]}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  function format(value){
    const iso=parseISO(value);
    return iso?iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/,"$1. $2. $3."):"";
  }
  function enhance(input){
    if(input.dataset.hungarianDate)return;
    const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value"),initial=input.value;
    const read=()=>descriptor.get.call(input);
    const wrapper=document.createElement("span"),picker=document.createElement("input"),icon=document.createElement("span");
    wrapper.className="hungarian-date-control";icon.className="hungarian-date-icon";icon.textContent="▦";icon.setAttribute("aria-hidden","true");
    picker.type="date";picker.lang="hu";picker.className="hungarian-date-picker";picker.setAttribute("aria-label","Dátum kiválasztása a naptárból");picker.tabIndex=0;
    input.before(wrapper);wrapper.append(input,icon,picker);
    input.type="text";input.placeholder="éééé. hh. nn.";input.inputMode="numeric";input.autocomplete="off";input.dataset.hungarianDate="true";
    const validate=()=>{
      const raw=read(),iso=parseISO(raw);
      let error=raw&&!iso?"Érvényes dátumot adj meg: éééé. hh. nn.":"";
      if(iso&&input.min&&iso<input.min)error=`A dátum nem lehet korábbi: ${format(input.min)}`;
      if(iso&&input.max&&iso>input.max)error=`A dátum nem lehet későbbi: ${format(input.max)}`;
      input.setCustomValidity(error);picker.value=iso;picker.min=input.min;picker.max=input.max;
    };
    Object.defineProperty(input,"value",{
      configurable:true,
      get(){return parseISO(read());},
      set(value){descriptor.set.call(input,format(value)||String(value??""));validate();}
    });
    input.addEventListener("input",validate);
    input.addEventListener("change",event=>{validate();if(!input.checkValidity()){event.stopImmediatePropagation();input.reportValidity();return;}if(input.value)input.value=input.value;});
    picker.addEventListener("click",()=>{if(typeof picker.showPicker==="function")try{picker.showPicker();}catch(_){}});
    picker.addEventListener("change",()=>{
      input.value=picker.value;
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));
    });
    if(input.form){
      input.form.addEventListener("formdata",event=>{if(input.name&&!input.disabled)event.formData.set(input.name,input.value);});
      input.form.addEventListener("reset",()=>queueMicrotask(()=>{input.value=read();}));
    }
    input.value=initial;
  }
  window.KasszaDates=Object.freeze({parseISO,format,enhance});
  document.querySelectorAll('input[type="date"]').forEach(enhance);
})();

