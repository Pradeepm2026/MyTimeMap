"use strict";
window.AdminPanel={
  async render({container,request,esc,toast,isCurrent}){
    const [data,recoveryData]=await Promise.all([request("/api/admin/users"),request("/api/admin/recovery-requests")]);if(!isCurrent())return;
    let requests=recoveryData.requests,busy=false;
    container.innerHTML=`<section class="forms-page"><div class="forms-hero"><div><p class="eyebrow">ADMINISTRATION</p><h1>Accounts & recovery</h1><p>Manage users and help verified owners recover access.</p></div><div class="forms-count"><strong>${data.users.length}</strong><span>Accounts</span></div></div><div class="recovery-admin-heading"><h2>Recovery requests</h2><button type="button" id="refreshRecovery" class="button">Refresh requests</button></div><p class="forms-help">Verify the person controls the registered email before issuing a temporary password. No email is sent automatically.</p><p id="recoveryAdminError" class="recovery-error" role="alert"></p><div id="recoveryRequests" class="recovery-admin-list"></div><h2>Registered users</h2><label class="field">Search users<input id="adminSearch" type="search" placeholder="Search name or email"></label><div id="adminUsers" class="forms-layout"></div><section id="adminReset" class="forms-editor" hidden></section></section>`;
    const list=container.querySelector("#adminUsers"),panel=container.querySelector("#adminReset"),search=container.querySelector("#adminSearch"),requestList=container.querySelector("#recoveryRequests"),errorBox=container.querySelector("#recoveryAdminError"),refreshButton=container.querySelector("#refreshRecovery");
    const active=()=>isCurrent()&&list.isConnected;
    const date=value=>esc(new Date(value).toLocaleString("en-IN"));
    function drawUsers(){const query=search.value.trim().toLowerCase();list.innerHTML=data.users.filter(user=>(user.name+" "+user.email+" "+(user.username||"")).toLowerCase().includes(query)).map(user=>`<article class="form-entry"><h3>${esc(user.name)}</h3><p>${esc(user.email||user.username||"No email recorded")}</p><p>${user.isAdmin?"Administrator":"User"}</p>${user.isAdmin?"":`<button class="button button-primary" type="button" data-reset="${esc(user.id)}">Reset password</button>`}</article>`).join("")||'<p class="muted">No users found.</p>';}
    function drawRequests(){requestList.innerHTML=requests.length?requests.map(item=>`<article class="form-entry"><div class="recovery-request-head"><h3>${esc(item.name)}</h3><span class="form-status">${item.status==="pending"?(item.resetAt?"Pending · awaiting password change":"Pending"):item.status==="resolved"?"Resolved":"Rejected"}</span></div><p>${esc(item.email)}</p><p class="recovery-request-meta">Requested: ${date(item.requestedAt)}${item.resetAt?"<br>Temporary password issued: "+date(item.resetAt):""}${item.resolvedAt?"<br>Resolved: "+date(item.resolvedAt):""}</p>${item.message?`<p class="recovery-request-message">${esc(item.message)}</p>`:""}${item.status==="pending"?`<div class="recovery-request-actions"><button type="button" class="button button-primary" data-request-reset="${esc(item.id)}">${item.resetAt?"Reissue temporary password":"Verify & reset"}</button>${item.resetAt?"":`<button type="button" class="button" data-request-reject="${esc(item.id)}">Reject</button>`}</div>`:""}</article>`).join(""):'<div class="forms-empty"><h3>No recovery requests yet</h3><p>Requests from Forgot password will appear here.</p></div>';}
    async function refresh(){const result=await request("/api/admin/recovery-requests");if(active()){requests=result.requests;drawRequests();}}
    refreshButton.onclick=async()=>{if(busy)return;busy=true;refreshButton.disabled=true;errorBox.textContent="";try{await refresh();}catch(error){if(active())errorBox.textContent=error.message;}finally{busy=false;if(active())refreshButton.disabled=false;}};
    search.oninput=drawUsers;drawUsers();drawRequests();
    function openReset(user,recoveryRequest){
      if(!user||busy||!active())return;
      panel.hidden=false;panel.innerHTML=`<h2>Reset password for ${esc(user.name)}</h2><p class="forms-help">${esc(user.email||user.username)} — Temporary passwords expire in 24 hours. Share privately after verifying the owner. They must set their own password before opening the dashboard.</p><form id="adminResetForm"><fieldset><label class="recovery-check"><input type="checkbox" name="identityConfirmed" required> I verified this person controls the registered account.</label><label>Temporary password<input name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label class="recovery-check"><input type="checkbox" id="adminShowNew"> Show temporary password</label><label>Your admin password<input name="adminPassword" type="password" maxlength="128" autocomplete="current-password" required></label><p role="alert" class="forms-error"></p><div class="forms-actions"><button class="button button-primary" type="submit">Confirm reset</button><button class="button" type="button" id="adminCancel">Cancel</button></div></fieldset></form>`;
      const form=panel.querySelector("form");
      panel.querySelector("#adminShowNew").onchange=event=>{form.elements.newPassword.type=event.target.checked?"text":"password";};
      panel.querySelector("#adminCancel").onclick=()=>{if(busy)return;panel.replaceChildren();panel.hidden=true;};
      form.onsubmit=async event=>{
        event.preventDefault();if(busy||!active())return;busy=true;
        const payload={userId:user.id,...Object.fromEntries(new FormData(form)),identityConfirmed:form.elements.identityConfirmed.checked};if(recoveryRequest)payload.requestId=recoveryRequest.id;
        form.querySelector("fieldset").disabled=true;errorBox.textContent="";
        try{await request("/api/admin/reset-password",{method:"POST",body:JSON.stringify(payload)});if(!active()||!form.isConnected)return;panel.replaceChildren();panel.hidden=true;toast("Temporary password set. Share it privately with the verified owner.");try{await refresh();}catch{if(active())errorBox.textContent="Password reset succeeded. Refresh requests to update their status.";}}
        catch(error){if(active()&&form.isConnected)form.querySelector(".forms-error").textContent=error.message;}
        finally{payload.newPassword="";payload.adminPassword="";busy=false;if(form.isConnected)form.querySelector("fieldset").disabled=false;}
      };
      panel.scrollIntoView({block:"center"});form.elements.identityConfirmed.focus();
    }
    list.onclick=event=>{const button=event.target.closest("[data-reset]");if(button)openReset(data.users.find(item=>item.id===button.dataset.reset));};
    requestList.onclick=async event=>{
      const button=event.target.closest("button");if(!button||busy||!active())return;
      const item=requests.find(entry=>entry.id===(button.dataset.requestReset||button.dataset.requestReject));if(!item)return;
      if(button.dataset.requestReset){openReset(data.users.find(user=>user.id===item.userId),item);return;}
      if(!confirm("Reject the recovery request for "+item.email+"?"))return;
      busy=true;button.disabled=true;errorBox.textContent="";
      try{await request("/api/admin/recovery-reject",{method:"POST",body:JSON.stringify({userId:item.userId,requestId:item.id})});if(active()){panel.replaceChildren();panel.hidden=true;toast("Request rejected.");await refresh();}}
      catch(error){if(active())errorBox.textContent=error.message;}
      finally{busy=false;if(button.isConnected)button.disabled=false;}
    };
  }
};