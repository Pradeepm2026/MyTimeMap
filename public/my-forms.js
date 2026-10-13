"use strict";
window.MyForms=(()=>{
  let generation=0;
  async function render({container,request,esc,datePretty,isCurrent,toast}){
    const version=++generation,current=()=>version===generation&&isCurrent();
    const {forms,today}=await request("/api/forms");
    if(!current())return;
    container.innerHTML=`<section class="forms-page">
      <div class="forms-hero"><div><p class="eyebrow">YOUR NEXT OPPORTUNITY</p><h1>My Forms</h1><p>Applications, exam dates and important links. All in one place.</p></div><div class="forms-count"><strong>${forms.length}</strong><span>Saved forms</span></div></div>
      <div class="forms-layout"><section class="forms-editor"><h2 id="formsEditorTitle">Add a form</h2><p class="forms-help">Fields marked * are required.</p>
        <form id="applicationForm"><fieldset>
          <label>Form / Exam name *<input name="name" required maxlength="120" placeholder="e.g. SSC CGL 2026"></label>
          <div class="forms-dates"><label>Date filled *<input name="filledDate" type="date" required></label><label>Exam date <small>Optional</small><input name="examDate" type="date"></label></div>
          <label>Website link *<input name="website" type="url" required maxlength="2048" placeholder="https://example.com" inputmode="url"></label>
          <label>Application number <small>Optional</small><input name="applicationNumber" maxlength="120" placeholder="Your registration or application number"></label>
          <label>Notes <small>Optional</small><textarea name="notes" maxlength="2000" rows="4" placeholder="Fees, documents, or anything to remember"></textarea></label>
          <p class="forms-error" role="alert" id="formsError"></p>
          <div class="forms-actions"><button type="submit" class="button button-primary" id="saveForm">Save form →</button><button type="button" class="button" id="cancelForm" hidden>Cancel edit</button></div>
        </fieldset></form>
      </section><section class="forms-library"><div class="forms-library-heading"><h2>Saved forms</h2><label class="forms-search"><span class="sr-only">Search forms</span><input type="search" id="searchForms" placeholder="Search name or application number" aria-label="Search forms"></label></div><div id="formsList"></div></section></div>
    </section>`;
    const root=container.querySelector(".forms-page"),form=root.querySelector("#applicationForm"),list=root.querySelector("#formsList"),error=root.querySelector("#formsError"),saveButton=root.querySelector("#saveForm"),cancel=root.querySelector("#cancelForm");
    let editingId=null,busy=false;
    const active=()=>current()&&root.isConnected;
    form.elements.filledDate.value=today;
    const pretty=value=>esc(datePretty(value,{day:"numeric",month:"short",year:"numeric"}));
    const safeLink=value=>{try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
    function draw(){
      const query=root.querySelector("#searchForms").value.trim().toLowerCase();
      const visible=forms.filter(item=>(item.name+" "+item.applicationNumber).toLowerCase().includes(query));
      list.innerHTML=visible.length?visible.map(item=>{
        const link=safeLink(item.website),status=!item.examDate?"Date awaited":item.examDate<today?"Exam date passed":item.examDate===today?"Exam today":"Upcoming exam";
        return `<article class="form-entry"><div class="form-entry-head"><span class="form-entry-icon" aria-hidden="true">▤</span><span class="form-status">${status}</span></div><h3>${esc(item.name)}</h3><dl><div><dt>Date filled</dt><dd>${pretty(item.filledDate)}</dd></div><div><dt>Exam date</dt><dd>${item.examDate?pretty(item.examDate):"Not set"}</dd></div>${item.applicationNumber?`<div class="form-application"><dt>Application number</dt><dd>${esc(item.applicationNumber)}</dd></div>`:""}</dl>${item.notes?`<p class="form-notes">${esc(item.notes)}</p>`:""}<div class="form-entry-actions">${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="form-open">Open website ↗</a>`:""}<button type="button" data-edit="${esc(item.id)}" aria-label="Edit ${esc(item.name)}">Edit</button><button type="button" data-delete="${esc(item.id)}" aria-label="Delete ${esc(item.name)}">Delete</button></div></article>`;
      }).join(""):`<div class="forms-empty"><span aria-hidden="true">▤</span><h3>${forms.length?"No matching forms":"Your applications start here"}</h3><p>${forms.length?"Try another name or application number.":"Add your first form to keep its dates and website handy."}</p></div>`;
      root.querySelector(".forms-count strong").textContent=forms.length;
    }
    function reset(){editingId=null;form.reset();form.elements.filledDate.value=today;error.textContent="";cancel.hidden=true;saveButton.textContent="Save form →";root.querySelector("#formsEditorTitle").textContent="Add a form";}
    function setBusy(value){busy=value;form.querySelector("fieldset").disabled=value;list.querySelectorAll("button").forEach(button=>button.disabled=value);}
    root.querySelector("#searchForms").oninput=()=>{draw();if(busy)setBusy(true);};
    cancel.onclick=reset;
    list.onclick=async event=>{
      const button=event.target.closest("button");if(!button||busy||!active())return;
      const id=button.dataset.edit||button.dataset.delete,item=forms.find(entry=>entry.id===id);if(!item)return;
      if(button.dataset.edit){editingId=id;for(const key of ["name","filledDate","examDate","website","applicationNumber","notes"])form.elements[key].value=item[key]||"";error.textContent="";cancel.hidden=false;saveButton.textContent="Save changes →";root.querySelector("#formsEditorTitle").textContent="Edit form";form.elements.name.focus();return;}
      if(!confirm('Delete "'+item.name+'"?'))return;
      setBusy(true);
      try{await request("/api/forms/"+encodeURIComponent(id),{method:"DELETE"});if(!active())return;forms.splice(forms.findIndex(entry=>entry.id===id),1);if(editingId===id)reset();draw();toast("Form deleted.");}catch(failure){if(active())toast(failure.message,true);}finally{if(active())setBusy(false);}
    };
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||!active())return;
      const payload=Object.fromEntries(new FormData(form)),id=editingId;
      error.textContent="";setBusy(true);saveButton.textContent="Saving…";
      try{
        const result=await request("/api/forms"+(id?"/"+encodeURIComponent(id):""),{method:id?"PUT":"POST",body:JSON.stringify(payload)});
        if(!active())return;
        const index=forms.findIndex(item=>item.id===id);if(index>=0)forms[index]={...forms[index],...result.form};else forms.push(result.form);
        forms.sort((a,b)=>b.filledDate.localeCompare(a.filledDate)||b.createdAt-a.createdAt);reset();draw();toast(id?"Form updated.":"Form saved.");
      }catch(failure){if(active())error.textContent=failure.message;}finally{if(active()){setBusy(false);saveButton.textContent=editingId?"Save changes →":"Save form →";}}
    };
    draw();
  }
  return {render};
})();
