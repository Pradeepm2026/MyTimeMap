"use strict";
window.AdminPanel={
  async render({container,request,esc,toast,isCurrent}){
    const data=await request("/api/admin/users");if(!isCurrent())return;
    container.innerHTML=`<section class="forms-page"><div class="forms-hero"><div><p class="eyebrow">ADMINISTRATION</p><h1>Registered users</h1><p>Manage accounts and help users recover access.</p></div><div class="forms-count"><strong>${data.users.length}</strong><span>Accounts</span></div></div><label class="field">Search users<input id="adminSearch" type="search" placeholder="Search name or email"></label><div id="adminUsers" class="forms-layout"></div><section id="adminReset" class="forms-editor" hidden></section></section>`;
    const list=container.querySelector("#adminUsers"),panel=container.querySelector("#adminReset"),search=container.querySelector("#adminSearch");
    const active=()=>isCurrent()&&list.isConnected;
    let resetInFlight=false;
    function draw(){const query=search.value.trim().toLowerCase();list.innerHTML=data.users.filter(user=>(user.name+" "+user.email+" "+(user.username||"")).toLowerCase().includes(query)).map(user=>`<article class="form-entry"><h3>${esc(user.name)}</h3><p>${esc(user.email||user.username||"No email recorded")}</p><p>${user.isAdmin?"Administrator":"User"}</p>${user.isAdmin?"":`<button class="button button-primary" type="button" data-reset="${esc(user.id)}">Reset password</button>`}</article>`).join("")||'<p class="muted">No users found.</p>';}
    search.oninput=draw;draw();
    list.onclick=event=>{
      const button=event.target.closest("[data-reset]");if(!button||!active()||resetInFlight)return;
      const user=data.users.find(item=>item.id===button.dataset.reset);if(!user)return;
      panel.hidden=false;panel.innerHTML=`<h2>Reset password for ${esc(user.name)}</h2><p class="forms-help">${esc(user.email||user.username)} — Verify the request belongs to this user before resetting. Their existing sessions will be signed out.</p><form id="adminResetForm"><fieldset><label>New password<input name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label><input type="checkbox" id="adminShowNew" style="width:auto;min-height:0;display:inline"> Show new password</label><label>Your admin password<input name="adminPassword" type="password" maxlength="128" autocomplete="current-password" required></label><p role="alert" class="forms-error"></p><div class="forms-actions"><button class="button button-primary" type="submit">Confirm reset</button><button class="button" type="button" id="adminCancel">Cancel</button></div></fieldset></form>`;
      const form=panel.querySelector("form");let busy=false;
      panel.querySelector("#adminShowNew").onchange=event=>{form.elements.newPassword.type=event.target.checked?"text":"password";};
      panel.querySelector("#adminCancel").onclick=()=>{panel.replaceChildren();panel.hidden=true;};
      form.onsubmit=async event=>{event.preventDefault();if(busy||!active())return;busy=true;resetInFlight=true;const payload={userId:user.id,...Object.fromEntries(new FormData(form))};form.querySelector("fieldset").disabled=true;
        try{await request("/api/admin/reset-password",{method:"POST",body:JSON.stringify(payload)});if(!active()||!form.isConnected)return;panel.replaceChildren();panel.hidden=true;toast("Password changed. Share the new password privately with the verified user.");}
        catch(error){if(active()&&form.isConnected)form.querySelector(".forms-error").textContent=error.message;}
        finally{payload.newPassword="";payload.adminPassword="";busy=false;resetInFlight=false;if(form.isConnected)form.querySelector("fieldset").disabled=false;}
      };
      panel.scrollIntoView({block:"center"});form.elements.newPassword.focus();
    };
  }
};
