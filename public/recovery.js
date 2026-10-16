"use strict";
window.RecoveryUI={
  init({request,isCurrent}){
    const form=document.getElementById("recoveryRequestForm"),status=document.getElementById("recoveryRequestStatus");let busy=false;
    form.addEventListener("submit",async event=>{
      event.preventDefault();if(busy)return;
      busy=true;const button=form.querySelector("button[type=submit]");button.disabled=true;status.textContent="Sending request…";
      const payload=Object.fromEntries(new FormData(form));
      try{const result=await request("/api/recovery-request",{method:"POST",body:JSON.stringify(payload)});if(isCurrent()){status.textContent=result.message;form.reset();}}
      catch(error){if(isCurrent())status.textContent=error.message;}
      finally{busy=false;button.disabled=false;}
    });
  },
  changePassword({container,request,onDone,onLogout,isCurrent}){
    container.innerHTML=`<p class="recovery-explanation">Your administrator issued a temporary password. Choose your own password to continue. The temporary password expires after 24 hours.</p><form id="requiredPasswordForm"><fieldset><label class="field">Temporary password<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label class="field">New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" placeholder="12 or more characters"></label><label class="field">Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><label class="recovery-check"><input type="checkbox" id="showRecoveryPasswords"> Show passwords</label><p class="form-error" role="alert"></p><button class="button button-primary button-wide" type="submit">Save new password</button><button class="button recovery-back" id="cancelPasswordChange" type="button">Sign out</button></fieldset></form>`;
    const form=container.querySelector("form");let busy=false;
    const current=()=>isCurrent()&&form.isConnected;
    form.querySelector("#showRecoveryPasswords").onchange=event=>{for(const name of ["currentPassword","newPassword","confirmPassword"])form.elements[name].type=event.target.checked?"text":"password";};
    form.querySelector("#cancelPasswordChange").onclick=async()=>{if(busy)return;busy=true;try{await request("/api/logout",{method:"POST",body:"{}"});if(current())onLogout();}catch(error){if(current()){if(error.status===401)onLogout();else form.querySelector(".form-error").textContent=error.message;}}finally{busy=false;}};
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||!current())return;
      const errorBox=form.querySelector(".form-error"),payload=Object.fromEntries(new FormData(form));errorBox.textContent="";
      if(payload.newPassword!==payload.confirmPassword){errorBox.textContent="New passwords do not match.";return;}
      if(payload.newPassword===payload.currentPassword){errorBox.textContent="Choose a different password from your temporary password.";return;}
      delete payload.confirmPassword;busy=true;form.querySelector("fieldset").disabled=true;
      try{const result=await request("/api/change-password",{method:"POST",body:JSON.stringify(payload)});if(current()){form.reset();onDone(result);}}
      catch(error){if(current())errorBox.textContent=error.message;}
      finally{payload.currentPassword="";payload.newPassword="";busy=false;if(form.isConnected)form.querySelector("fieldset").disabled=false;}
    };
  }
};
