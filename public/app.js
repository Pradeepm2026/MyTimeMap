"use strict";
const state={user:null,activities:[],csrf:"",date:new Date().toLocaleDateString("en-CA"),weekDate:new Date().toLocaleDateString("en-CA"),month:new Date().toLocaleDateString("en-CA").slice(0,7),view:"welcome",page:"dashboard",returnPage:"dashboard",authMode:"login",toastTimer:null};
const $=s=>document.querySelector(s),content=$("#content");
let dashboardRenderVersion=0,logRenderVersion=0;
let welcomeSession=null,sessionGeneration=0,publicNavigationVersion=0,enteringDashboard=false,authenticating=false;
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function mins(v){return Math.max(0,Math.round(Number(v)||0));}
function fmtTime(n){n=mins(n);return Math.floor(n/60)+"h "+String(n%60).padStart(2,"0")+"m";}
function fmtInput(n,zeroValue=""){n=mins(n);return n?Math.floor(n/60)+":"+String(n%60).padStart(2,"0"):zeroValue;}
function parseInput(s){if(!s.trim())return null;const m=s.trim().match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return NaN;const h=Number(m[1]),mm=Number(m[2]);if(h>24||(h===24&&mm>0))return NaN;return h*60+mm;}
function logDurationFields(control){return {hours:control.querySelector("[data-hours]"),minutes:control.querySelector("[data-minutes]")};}
function readLogDuration(control){
  const fields=logDurationFields(control),hours=fields.hours.value.trim(),minutes=fields.minutes.value.trim();
  const hoursError=/^\d{0,2}$/.test(hours)&&Number(hours)<=24?"":"Enter whole hours from 0 to 24.";
  let minutesError=/^\d{0,2}$/.test(minutes)&&Number(minutes)<=59?"":"Enter minutes from 0 to 59.";
  if(!hoursError&&!minutesError&&Number(hours)===24&&Number(minutes)>0)minutesError="For 24 hours, minutes must be 00.";
  return {value:hoursError||minutesError?NaN:hours===""&&minutes===""?null:Number(hours)*60+Number(minutes),hoursError,minutesError};
}
function validateLogDuration(control){
  const result=readLogDuration(control),fields=logDurationFields(control);
  for(const part of ["hours","minutes"]){
    const error=result[part+"Error"],input=fields[part];
    input.setCustomValidity(error);
    if(error)input.setAttribute("aria-invalid","true");else input.removeAttribute("aria-invalid");
  }
  return result.value;
}
function setLogDuration(control,value){
  const total=mins(value),fields=logDurationFields(control);
  fields.hours.value=String(Math.floor(total/60));fields.minutes.value=String(total%60).padStart(2,"0");
  validateLogDuration(control);
}
function logDurationSnapshot(control){const fields=logDurationFields(control);return JSON.stringify([fields.hours.value,fields.minutes.value]);}
function datePretty(s,opts={weekday:"long",day:"numeric",month:"long",year:"numeric"}){return new Intl.DateTimeFormat("en-IN",opts).format(new Date(s+"T00:00:00"));}
function moveDate(s,n){const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function weekInputValue(dateString){const d=new Date(dateString+"T00:00:00Z"),monday=new Date(d);monday.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const thursday=new Date(monday);thursday.setUTCDate(monday.getUTCDate()+3);const year=thursday.getUTCFullYear(),jan4=new Date(Date.UTC(year,0,4)),firstMonday=new Date(jan4);firstMonday.setUTCDate(jan4.getUTCDate()-((jan4.getUTCDay()+6)%7));const week=Math.round((monday-firstMonday)/604800000)+1;return year+"-W"+String(week).padStart(2,"0");}
function weekDateFromInput(value){const [year,week]=value.split("-W").map(Number),jan4=new Date(Date.UTC(year,0,4)),monday=new Date(jan4);monday.setUTCDate(jan4.getUTCDate()-((jan4.getUTCDay()+6)%7)+(week-1)*7);return monday.toISOString().slice(0,10);}
function weekSelector(){return '<label class="week-selector" for="weekSelect" style="display:flex;align-items:center;gap:8px;color:#d3dfec;font-size:11px;font-weight:600"><span>Week</span><input id="weekSelect" type="week" value="'+esc(weekInputValue(state.weekDate))+'" aria-label="Select week" style="padding:8px 9px;border:1px solid #34536b;border-radius:9px;background:#1b344b;color:#f2f7fc;font:600 11px DM Sans,Arial,sans-serif"></label>';}
async function request(url,options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(options.method&&options.method!=="GET"&&state.csrf)headers["X-CSRF-Token"]=state.csrf;
  const response=await fetch(url,{credentials:"same-origin",...options,headers});
  const type=response.headers.get("content-type")||"",data=type.includes("application/json")?await response.json():await response.text();
  if(!response.ok){const error=new Error(data.error||"Request failed.");error.status=response.status;throw error;}
  return data;
}
function toast(message,error=false){const t=$("#toast");t.textContent=message;t.classList.toggle("error",error);t.classList.add("show");clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>t.classList.remove("show"),2800);}
async function focusLogUpdated(session){
 if(state.page==="dashboard"){render();return;}
 if(state.page==="streak"){StudyStreak.refresh();return;}
 if(state.page!=="log"||state.date!==session.date)return;
 const form=$("#dayForm"),control=form?.querySelector('[data-activity="'+session.activityId+'"]');
 if(!form||!control)return;
 // Apply timer updates after a save has established the latest stored totals.
 if(form.pendingSave){
  try{await form.pendingSave;}catch{/* The save handler displays the error. */}
  if(form.isConnected&&state.page==="log"&&state.date===session.date)return focusLogUpdated(session);
  return;
 }
 const saveVersion=form.saveVersion,refreshVersion=Number(control.dataset.focusVersion||0)+1;
 control.dataset.focusVersion=String(refreshVersion);
 try{
  const latest=await request("/api/day?date="+encodeURIComponent(session.date));
  if(!form.isConnected||state.page!=="log"||state.date!==session.date)return;
  if(refreshVersion!==Number(control.dataset.focusVersion))return;
  if(saveVersion!==form.saveVersion)return focusLogUpdated(session);
  const value=readLogDuration(control).value,total=Number(latest.times[session.activityId]||0),delta=total-Number(control.dataset.savedMinutes||0);
  if(!Number.isNaN(value)){setLogDuration(control,Number(value||0)+delta);control.dataset.savedMinutes=String(total);}
  $("#savedMark").textContent="Focus session added";
 }catch(error){toast("Focus saved. Reload the Daily Log to see the updated total.");}
}
$("#focusMini").addEventListener("click",()=>navigate("focus"));
function deactivateWorkspace(){
  FocusTimer.disconnect();StudyStreak.disconnect();dashboardRenderVersion++;
  state.user=null;state.activities=[];state.csrf="";state.page="dashboard";state.returnPage="dashboard";
  content.replaceChildren();$("#sidebar").classList.remove("open");$("#mobileMenu").setAttribute("aria-expanded","false");
}
function showScreen(view){
  state.view=view;publicNavigationVersion++;
  for(const [name,id] of Object.entries({welcome:"#welcomeView",auth:"#authView",app:"#appView"}))$(id).classList.toggle("hidden",name!==view);
  document.querySelector('meta[name="theme-color"]').content=view==="app"?"#17160f":"#040a16";
  window.scrollTo(0,0);
}
function welcomeStatus(message="",error=false){$("#welcomeStatus").textContent=message;$("#welcomeStatus").classList.toggle("is-error",error);}
function updateWelcomeActions(){
  const signedIn=!!welcomeSession;
  $("#welcomeStart").classList.toggle("hidden",signedIn||enteringDashboard);
  $("#welcomeSignIn").classList.toggle("hidden",signedIn||enteringDashboard);
  $("#welcomeContinue").classList.toggle("hidden",!signedIn&&!enteringDashboard);
  $("#welcomeContinue").setAttribute("aria-disabled",String(enteringDashboard||authenticating));
  $("#welcomeContinue").setAttribute("aria-busy",String(enteringDashboard||authenticating));
  $("#welcomeContinueLabel").textContent=authenticating?"Finishing sign in…":enteringDashboard?"Opening your space…":"Continue to Dashboard";
}
async function discoverWelcomeSession(){
  // Wait for the authentication response to set its cookie before checking the session.
  if(authenticating)return;
  const generation=++sessionGeneration;
  try{
    const data=await request("/api/me");
    if(generation!==sessionGeneration)return;
    welcomeSession=data;
  }catch(error){if(generation!==sessionGeneration)return;if(error.status===401)welcomeSession=null;}
  updateWelcomeActions();
}
function showWelcome({discover=true,focus=true}={}){
  deactivateWorkspace();showScreen("welcome");enteringDashboard=false;welcomeStatus();updateWelcomeActions();
  const welcome=$("#welcomeView");welcome.classList.remove("welcome-enter");void welcome.offsetWidth;welcome.classList.add("welcome-enter");
  if(focus)$("#welcomeTitle").focus({preventScroll:true});
  if(discover)discoverWelcomeSession();
}
function showAuth(mode="login",focus=true){
  deactivateWorkspace();showScreen("auth");enteringDashboard=false;setAuthMode(mode);
  if(focus)$("#authTitle").focus({preventScroll:true});
}
function showApp(data){
  sessionGeneration++;welcomeSession=data;enteringDashboard=false;
  state.user=data.user;state.activities=data.activities;state.csrf=data.csrfToken;state.returnPage="dashboard";
  history.replaceState(null,"","#dashboard");showScreen("app");
  $("#userName").textContent=state.user.name;$("#userHandle").textContent=state.user.email||"@"+state.user.username;$("#avatar").textContent=(state.user.name[0]||"M").toUpperCase();
  state.page="dashboard";
  FocusTimer.connect({userId:state.user.id,request,toast,page:()=>state.page,activities:()=>state.activities,navigate,openLog:date=>{state.date=date;navigate("log");},onLogged:focusLogUpdated});
  navigate("dashboard");
}
function publicRoute(route,{replace=false}={}){
  if(location.hash!=="#"+route)history[replace?"replaceState":"pushState"](null,"","#"+route);
  routePublicScreen();
}
async function enterDashboard(){
  if(enteringDashboard||authenticating)return;
  enteringDashboard=true;welcomeStatus();updateWelcomeActions();
  const navigation=publicNavigationVersion,generation=++sessionGeneration;
  try{
    const data=await request("/api/me");
    if(navigation!==publicNavigationVersion||generation!==sessionGeneration||state.view!=="welcome")return;
    showApp(data);
  }catch(error){
    if(navigation!==publicNavigationVersion||generation!==sessionGeneration||state.view!=="welcome")return;
    if(error.status===401){welcomeSession=null;publicRoute("login",{replace:true});}
    else welcomeStatus("Could not open your account. Please try again.",true);
  }finally{
    if(navigation===publicNavigationVersion){enteringDashboard=false;updateWelcomeActions();}
  }
}
function routePublicScreen({initial=false}={}){
  const route=location.hash.slice(1);
  if(["login","register","forgot"].includes(route)){showAuth(route,!initial);return;}
  if(route==="dashboard"){
    if(state.view==="app"&&state.user)return;
    showWelcome({discover:false,focus:false});enterDashboard();return;
  }
  showWelcome({focus:!initial});
}
$("#welcomeContinue").addEventListener("click",event=>{event.preventDefault();enterDashboard();});
window.addEventListener("hashchange",()=>routePublicScreen());
function setAuthMode(mode){
  state.authMode=mode;
  const forgot=mode==="forgot",password=$("#authForm [name=password]"),toggle=$("#passwordToggle");
  $("#authError").textContent="";$("#authForm").reset();
  $("#authForm").classList.toggle("hidden",forgot);
  $("#recoveryCard").classList.toggle("hidden",!forgot);
  $(".auth-switch").classList.toggle("hidden",forgot);
  $("#forgotLink").classList.toggle("hidden",mode!=="login");
  $("#legacyLoginNote").classList.toggle("hidden",mode!=="login");
  $("#nameField").classList.toggle("hidden",mode!=="register");
  $("#authSubmit").innerHTML=mode==="login"?'Sign in <span>→</span>':'Create account <span>→</span>';
  $("#authTitle").textContent=forgot?"Forgot your password?":mode==="login"?"Sign in to your space":"Create your account";
  $("#authEyebrow").textContent=forgot?"ACCOUNT RECOVERY":mode==="login"?"WELCOME BACK":"GET STARTED";
  $("#authHint").textContent=forgot?"A secure way back to your account.":mode==="login"?"Pick up where you left off.":"Your schedule starts with you.";
  document.querySelectorAll(".auth-switch button").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
  password.type="password";password.autocomplete=mode==="login"?"current-password":"new-password";
  toggle.setAttribute("aria-label","Show password");toggle.setAttribute("aria-pressed","false");toggle.classList.remove("is-visible");
  $("#authForm [name=email]").placeholder=mode==="register"?"you@example.com":"name@example.com";
}
document.querySelectorAll(".auth-switch button").forEach(b=>b.addEventListener("click",()=>publicRoute(b.dataset.mode)));
$("#forgotLink").addEventListener("click",()=>publicRoute("forgot"));
$("#recoveryBack").addEventListener("click",()=>publicRoute("login"));
$("#passwordToggle").addEventListener("click",()=>{const input=$("#authForm [name=password]"),button=$("#passwordToggle"),show=input.type==="password";input.type=show?"text":"password";button.setAttribute("aria-label",show?"Hide password":"Show password");button.setAttribute("aria-pressed",String(show));button.classList.toggle("is-visible",show);});
$("#authForm").addEventListener("submit",async event=>{
  event.preventDefault();if($("#authSubmit").disabled)return;
  const mode=state.authMode,navigation=publicNavigationVersion,generation=++sessionGeneration;
  const form=new FormData(event.currentTarget),payload={email:form.get("email").trim(),password:form.get("password")};
  if(mode==="register")payload.name=form.get("name");
  $("#authError").textContent="";$("#authSubmit").disabled=true;authenticating=true;updateWelcomeActions();
  try{
    const data=await request("/api/"+(mode==="login"?"login":"register"),{method:"POST",body:JSON.stringify(payload)});
    if(generation!==sessionGeneration)return;
    welcomeSession=data;updateWelcomeActions();
    if(navigation!==publicNavigationVersion||state.view!=="auth")return;
    showApp(data);toast(mode==="login"?"Welcome back.":"Your account is ready.");
  }catch(error){if(navigation===publicNavigationVersion&&state.view==="auth")$("#authError").textContent=error.message;}
  finally{
    authenticating=false;$("#authSubmit").disabled=false;updateWelcomeActions();
    if(state.view==="welcome")discoverWelcomeSession();
  }
});
document.querySelectorAll("[data-nav]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();navigate(b.dataset.nav);}));
function navigate(page){if(page==="logout"&&state.page!=="logout")state.returnPage=state.page;if(page==="log"){const today=new Date().toLocaleDateString("en-CA");if(state.date<moveDate(today,-1)||state.date>today)state.date=today;}state.page=page;$("#sidebar").classList.remove("open");$("#mobileMenu").setAttribute("aria-expanded","false");document.querySelectorAll(".nav-item, .header-streak").forEach(b=>{const active=b.dataset.nav===page;b.classList.toggle("active",active);if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});$("#pageCrumb").textContent=({dashboard:"Dashboard",log:"Daily log",schedule:"My schedule",forms:"My Forms",help:"How to Use",focus:"Focus timer",streak:"Study streak",logout:"Logout"}[page]||page);render();}
$("#mobileMenu").addEventListener("click",()=>{const sidebar=$("#sidebar"),isOpen=sidebar.classList.toggle("open");$("#mobileMenu").setAttribute("aria-expanded",String(isOpen));});
$("#profileButton").addEventListener("click",()=>{if(state.user)navigate("logout");});
async function render(){if(!state.user)return;const page=state.page,ownerId=state.user.id;try{if(state.page==="dashboard")await renderDashboard();else if(state.page==="log")await renderLog();else if(state.page==="schedule")await renderSchedule();else if(state.page==="forms")await MyForms.render({container:content,request,esc,datePretty,toast,isCurrent:()=>state.page==="forms"&&state.user?.id===ownerId});else if(state.page==="help")HowToUse.render({container:content,navigate});else if(state.page==="focus")FocusTimer.render();else if(state.page==="streak")await StudyStreak.render({userId:ownerId,request,isCurrent:()=>state.page==="streak"&&state.user?.id===ownerId,openLog:date=>{state.date=date;navigate("log");}});else renderLogout();}catch(e){if(state.page!==page||state.user?.id!==ownerId)return;content.innerHTML='<div class="chart-card"><h3>Could not load this view</h3><p class="muted">'+esc(e.message)+'</p><button class="button button-primary" id="retryButton">Try again</button></div>';$("#retryButton").onclick=render;}}
function dateControl(label){const recentOnly=label==="One entry per day",today=new Date().toLocaleDateString("en-CA"),yesterday=moveDate(today,-1),min=recentOnly?yesterday:"",max=recentOnly?today:"",prevDisabled=recentOnly&&state.date<=yesterday,nextDisabled=recentOnly&&state.date>=today;return '<div class="date-controls"><button type="button" data-step="-1" aria-label="Previous day"'+(prevDisabled?' disabled':'')+'>‹</button><input type="date" id="viewDate" value="'+esc(state.date)+'" '+(min?'min="'+min+'" max="'+max+'" ':'')+'aria-label="Choose date"><button type="button" data-step="1" aria-label="Next day"'+(nextDisabled?' disabled':'')+'>›</button><span class="date-caption">'+esc(recentOnly?"Today and yesterday only":label||"Selected date")+'</span></div>';}
function hookDate(){const input=$("#viewDate");if(input)input.addEventListener("change",()=>{if(input.value&&(!input.min||input.value>=input.min)&&(!input.max||input.value<=input.max)){state.date=input.value;render();}});document.querySelectorAll("[data-step]").forEach(b=>b.addEventListener("click",()=>{const nextDate=moveDate(state.date,Number(b.dataset.step));if(input?.min&&(nextDate<input.min||nextDate>input.max))return;state.date=nextDate;render();}));}
function pct(v,g){return g?Math.min(100,Math.round(v/g*100)):0;}
function statCard(label,value,detail,icon,color,progress){return '<article class="stat-card"><div class="stat-top"><span>'+label+'</span><span class="stat-icon '+color+'">'+icon+'</span></div><div class="stat-value">'+value+'</div><div class="stat-foot">'+detail+'</div>'+(progress==null?"":'<div class="progress-track"><span style="width:'+progress+'%"></span></div>')+'</article>';}
function periodSummary(title,range,totals,totalDays,selector=""){return '<section class="period-summary"><div class="period-summary-heading"><div><p class="eyebrow">PERIOD TOTALS</p><h2>'+title+'</h2></div>'+(selector||(title==="This week"?weekSelector():'<span>'+range+'</span>'))+'</div><div class="period-stats">'+statCard("Study total",fmtTime(totals.study),"Time spent studying","◷","study-bg",null)+statCard("Mobile total",fmtTime(totals.mobile),"Time spent on mobile","▣","mobile-bg",null)+statCard("Sleep total",fmtTime(totals.sleep),"Time spent sleeping","☾","sleep-bg",null)+statCard("Days logged",totals.loggedDays+" / "+totalDays,"Days with activity","✳","goal-bg",null)+'</div></section>';}
function monthSelector(){
 const [year,month]=state.month.split("-"),selectedYear=Number(year);
 const monthOptions=Array.from({length:12},(_,i)=>{const value=String(i+1).padStart(2,"0"),name=new Intl.DateTimeFormat("en",{month:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2026,i,1)));return '<option value="'+value+'"'+(value===month?' selected':'')+'>'+name+'</option>';}).join("");
 const yearOptions=Array.from({length:21},(_,i)=>selectedYear-10+i).map(value=>'<option value="'+value+'"'+(value===selectedYear?' selected':'')+'>'+value+'</option>').join("");
 return '<div class="month-selector"><label for="monthSelect"><span>Month</span><select id="monthSelect" aria-label="Select month">'+monthOptions+'</select></label><label for="yearSelect"><span>Year</span><select id="yearSelect" aria-label="Select year">'+yearOptions+'</select></label></div>';
}async function renderDashboard(){
 const renderVersion=++dashboardRenderVersion,ownerId=state.user.id,date=state.date,month=state.month,weekDate=state.weekDate;
 const isCurrent=()=>state.page==="dashboard"&&state.user?.id===ownerId&&renderVersion===dashboardRenderVersion&&state.date===date&&state.month===month&&state.weekDate===weekDate;
 let d;
 try{d=await request("/api/dashboard?date="+encodeURIComponent(date)+"&month="+encodeURIComponent(month)+"&week="+encodeURIComponent(weekDate));}
 catch(error){if(isCurrent())throw error;return;}
 if(!isCurrent())return;
 const g=d.goal,goalStudy=g.study,mobileLimit=g.mobile;
 d.dailyLegend=d.dailyLegend.map((item,index)=>({...item,color:["#22c7d2","#42c89b","#a78bfa","#fb7185","#fbbf24","#60a5fa"][index%6]}));
 const selectedDay=d.dailySeries.filter(item=>item.date===date),selectedWeek=d.selectedWeekSeries,selectedMonth=d.selectedMonthDays;
 const monthName=datePretty(d.month.start,{month:"long",year:"numeric"});
 const monthSubtitle="Daily totals for "+monthName+(d.today>=d.month.start&&d.today<d.month.end?" · Through "+datePretty(d.today,{day:"numeric",month:"short"}):"");
 const goalLine=goalStudy?fmtTime(goalStudy)+" daily goal":'<a href="#" id="setGoalLink">Set a study goal</a>',mobileLine=mobileLimit?"Limit "+fmtTime(mobileLimit):'<a href="#" id="setGoalLink">Set a mobile limit</a>';
 const goalCard=goalStudy?statCard("Study goal",pct(d.selected.study,goalStudy)+"%",fmtTime(d.selected.study)+" of "+fmtTime(goalStudy),"✳","goal-bg",pct(d.selected.study,goalStudy)):statCard("Study goal","—",'<a href="#" id="setGoalLink">Set a daily goal</a>',"✳","goal-bg",null);
 content.innerHTML='<div class="page-heading"><div><p class="eyebrow">YOUR TIME, AT A GLANCE</p><h1>Good day, '+esc(state.user.name.split(" ")[0])+'.</h1><p>'+esc(datePretty(state.date))+' · Your time, mapped clearly.</p></div>'+dateControl("Selected day")+'</div>'+
 '<section class="period-panel period-panel-daily"><div class="period-panel-heading"><p class="eyebrow">DAILY OVERVIEW</p><span>'+esc(datePretty(state.date,{weekday:"long",day:"numeric",month:"long"}))+'</span></div><section class="stats-grid">'+statCard("Study time",fmtTime(d.selected.study),goalLine,"◷","study-bg",goalStudy?pct(d.selected.study,goalStudy):null)+statCard("Mobile time",fmtTime(d.selected.mobile),mobileLine,"▣","mobile-bg",mobileLimit?pct(d.selected.mobile,mobileLimit):null)+statCard("Sleep",fmtTime(d.selected.sleep),"Logged for selected day","☾","sleep-bg",null)+goalCard+'</section><section class="chart-grid">'+chartCard("Daily rhythm","Selected day · hours by subject and app","dailyChart",selectedDay,d.selected,d.dailyLegend)+'</section></section>'+
 '<section class="period-panel period-panel-weekly">'+periodSummary(d.today>=d.week.start&&d.today<=d.week.end?"This week":"Selected week",datePretty(d.week.start,{day:"numeric",month:"short"})+" – "+datePretty(d.week.end,{day:"numeric",month:"short"}),d.week,7,weekSelector())+'<section class="chart-grid">'+chartCard("Weekly totals","Selected week · Monday to Sunday","weeklyChart",selectedWeek,d.week)+'</section></section>'+
 '<section class="period-panel period-panel-monthly">'+periodSummary(datePretty(d.month.start,{month:"long"})+" month","",d.month,new Date(d.month.end+"T00:00:00Z").getUTCDate(),monthSelector())+'<section class="chart-grid">'+chartCard(monthName+" totals",monthSubtitle,"monthlyChart",selectedMonth,d.month)+'</section></section>';
 hookDate();const monthInput=$("#monthSelect"),yearInput=$("#yearSelect"),weekInput=$("#weekSelect"),updateMonthSelection=()=>{if(monthInput&&yearInput){state.month=yearInput.value+"-"+monthInput.value;render();}},updateWeekSelection=()=>{if(weekInput?.value){state.weekDate=weekDateFromInput(weekInput.value);render();}};monthInput?.addEventListener("change",updateMonthSelection);yearInput?.addEventListener("change",updateMonthSelection);weekInput?.addEventListener("change",updateWeekSelection);document.querySelectorAll("#setGoalLink").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();navigate("schedule");setTimeout(()=>$("#studyGoalInput")?.focus(),0);}));
 requestAnimationFrame(()=>{
   if(!isCurrent())return;
   drawChart($("#dailyChart"),selectedDay,"activityBar",d.dailyLegend);
   drawMetricLineChart($("#weeklyChart"),selectedWeek,{cutoff:d.today,betweenDates:true});
   drawMetricLineChart($("#monthlyChart"),selectedMonth,{cutoff:d.today,betweenDates:true});
 });
}
function chartCard(title,sub,id,series,totals,legend){
 const label=id==="dailyChart"?"Selected day":id==="weeklyChart"?"Selected week":"Selected month";
 const foot='<span>'+label+': <b>'+fmtTime(totals.study)+' study</b> · <b>'+fmtTime(totals.mobile)+' mobile</b> · <b>'+fmtTime(totals.sleep)+' sleep</b></span>';
 const items=legend||[{name:"Study",color:"#22c7d2"},{name:"Mobile",color:"#fb786b"},{name:"Sleep",color:"#9b7bf5"}];
 const legendHtml=items.map(item=>'<span class="legend-item"><i class="legend-swatch" style="background:'+esc(item.color)+'"></i>'+esc(item.name)+'</span>').join("");
 const plot=id==="monthlyChart"
   ? '<div class="monthly-chart-scroll" role="region" aria-label="Day-wise monthly chart. Scroll horizontally to see all dates." tabindex="0"><div class="chart-wrap monthly-chart-plot" style="--month-chart-width:'+Math.max(1200,series.length*48+70)+'px"><canvas id="'+id+'" aria-label="'+title+' chart"></canvas></div></div><p class="monthly-chart-hint">← Swipe or scroll sideways to see all days →</p>'
   : '<div class="chart-wrap"><canvas id="'+id+'" aria-label="'+title+' chart"></canvas></div>';
 return '<article class="chart-card '+(id==="dailyChart"?"wide":"")+'"><div class="chart-title-row"><div><h3>'+title+'</h3><p>'+sub+'</p></div><div class="chart-legend">'+legendHtml+'</div></div>'+plot+'<div class="chart-footer">'+foot+'</div></article>';
}function drawChart(canvas,data,type,legend=[]){
 if(!canvas||!data.length)return;
 const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1,w=Math.max(280,rect.width),h=Math.max(130,rect.height);canvas.width=w*ratio;canvas.height=h*ratio;
 const c=canvas.getContext("2d");c.scale(ratio,ratio);c.clearRect(0,0,w,h);
 const p={l:34,r:8,t:9,b:24},pw=w-p.l-p.r,ph=h-p.t-p.b,activityMode=type==="activityBar";
 const vals=activityMode||type==="line"?data.flatMap(d=>legend.map(s=>Number(d.activityValues?.[s.id]||0)/60)):data.flatMap(d=>[d.study/60,d.mobile/60,(d.sleep||0)/60]);
 const step=Math.max(1,Math.ceil(Math.max(1,...vals)/4)),max=step*4;
 c.font="600 10px Arial, sans-serif";c.textBaseline="middle";c.textAlign="right";c.strokeStyle="#2a4054";c.fillStyle="#b2c3d4";c.lineWidth=.8;
 for(let i=0;i<=4;i++){const y=p.t+ph-(ph*i/4);c.beginPath();c.moveTo(p.l,y);c.lineTo(w-p.r,y);c.stroke();c.fillText((step*i)+"h",p.l-7,y);}
 const n=data.length,slot=pw/n,xAt=i=>(activityMode||type==="bar")?p.l+i*slot+slot/2:p.l+(n===1?pw/2:i*(pw/(n-1)));
 if(type==="line"){
  legend.forEach(s=>{c.strokeStyle=s.color;c.lineWidth=2.2;c.lineJoin="round";c.lineCap="round";c.beginPath();data.forEach((d,i)=>{const v=Number(d.activityValues?.[s.id]||0)/60,x=xAt(i),y=p.t+ph-(v/max)*ph;if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();data.forEach((d,i)=>{const v=Number(d.activityValues?.[s.id]||0)/60,x=xAt(i),y=p.t+ph-(v/max)*ph;c.beginPath();c.fillStyle="#fff";c.arc(x,y,3.3,0,Math.PI*2);c.fill();c.beginPath();c.fillStyle=s.color;c.arc(x,y,2.2,0,Math.PI*2);c.fill();});});
 }else if(activityMode){
  data.forEach((d,i)=>{const count=Math.max(1,legend.length),gap=3,groupWidth=Math.min(slot*.88,count*18+(count-1)*gap),barWidth=Math.max(2,(groupWidth-(count-1)*gap)/count),left=p.l+i*slot+(slot-groupWidth)/2;legend.forEach((s,j)=>{const value=Number(d.activityValues?.[s.id]||0)/60,bh=value/max*ph;if(bh>0){const x=left+j*(barWidth+gap),y=p.t+ph-bh,gradient=c.createLinearGradient(0,y,0,p.t+ph);gradient.addColorStop(0,"rgba(255,255,255,.38)");gradient.addColorStop(.28,s.color);gradient.addColorStop(1,s.color);c.fillStyle=gradient;c.shadowColor=s.color;c.shadowBlur=9;c.shadowOffsetY=1;c.beginPath();c.roundRect(x,y,barWidth,bh,Math.min(5,barWidth/2,bh/2));c.fill();c.shadowColor="transparent";c.shadowBlur=0;c.shadowOffsetY=0;}});});
 }else{
  const cols=[["study","#22c7d2"],["mobile","#fb786b"],["sleep","#9b7bf5"]],bw=Math.min(17,slot*.24),gap=3,groupWidth=cols.length*bw+(cols.length-1)*gap;
  data.forEach((d,i)=>{const left=xAt(i)-groupWidth/2;cols.forEach(([k,color],j)=>{const bh=((d[k]||0)/60/max)*ph;if(bh>0){const x=left+j*(bw+gap),y=p.t+ph-bh,gradient=c.createLinearGradient(0,y,0,p.t+ph);gradient.addColorStop(0,"rgba(255,255,255,.42)");gradient.addColorStop(.24,color);gradient.addColorStop(1,color);c.fillStyle=gradient;c.shadowColor=color;c.shadowBlur=11;c.shadowOffsetY=1;c.beginPath();c.roundRect(x,y,bw,bh,Math.min(6,bw/2,bh/2));c.fill();c.shadowColor="transparent";c.shadowBlur=0;c.shadowOffsetY=0;}});});
 }
 c.fillStyle="#b2c3d4";c.font="600 10px Arial, sans-serif";c.textAlign="center";c.textBaseline="top";const every=n>10?Math.ceil(n/7):1;data.forEach((d,i)=>{if(i%every===0||i===n-1)c.fillText(d.label,xAt(i),h-p.b+6);});
}function groupColor(g){return({Study:"#3978f6",Mobile:"#f27b54",Sleep:"#9271d5",Work:"#e0a441",Other:"#6c8798"})[g]||"#6c8798";}
function drawMetricLineChart(canvas,data,{cutoff=null,showRanges=false,betweenDates=false}={}){
  if(!canvas)return;
  const rect=canvas.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return;
  const ratio=window.devicePixelRatio||1,width=rect.width,height=rect.height;
  const p={l:42,r:28,t:14,b:showRanges?46:28},plotWidth=Math.max(1,width-p.l-p.r),plotHeight=Math.max(1,height-p.t-p.b);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  const c=canvas.getContext("2d");if(!c)return;
  c.scale(ratio,ratio);c.clearRect(0,0,width,height);
  const series=[{key:"study",color:"#22c7d2"},{key:"mobile",color:"#fb786b"},{key:"sleep",color:"#9b7bf5"}];
  const hours=(point,key)=>{const value=Number(point[key]);return Number.isFinite(value)&&value>0?value/60:0;};
  // Retain all axis positions, including weeks/days that have not started yet.
  const included=data.map((point,index)=>({point,index})).filter(({point})=>!cutoff||(point.date||point.start)<=cutoff);
  const values=included.flatMap(({point})=>series.map(item=>hours(point,item.key)));
  const step=Math.max(1,Math.ceil(Math.max(1,...values)/4)),max=step*4;
  // Each day's segment ends at the next date boundary.
  const intervalCount=Math.max(1,betweenDates?data.length:data.length-1);
  const axisXAt=index=>p.l+index*plotWidth/intervalCount;
  const xAt=index=>betweenDates?axisXAt(index+1):data.length<=1?p.l+plotWidth/2:axisXAt(index);
  const yAt=value=>p.t+plotHeight-(value/max)*plotHeight;
  c.font="600 10px Arial, sans-serif";c.textBaseline="middle";c.textAlign="right";c.lineWidth=.8;
  for(let i=0;i<=4;i++){
    const y=yAt(step*i);c.strokeStyle=i===0?"#4a6074":"#2a4054";
    c.beginPath();c.moveTo(p.l,y);c.lineTo(width-p.r,y);c.stroke();
    c.fillStyle="#b2c3d4";c.fillText((step*i)+"h",p.l-8,y);
  }
  if(values.some(value=>value>0)){
    for(const item of series){
      c.beginPath();
      included.forEach(({point,index},position)=>{
        const x=xAt(index),y=yAt(hours(point,item.key));
        if(position===0){
          if(betweenDates){c.moveTo(axisXAt(index),yAt(0));c.lineTo(x,y);}
          else c.moveTo(x,y);
        }else c.lineTo(x,y);
      });
      c.strokeStyle=item.color;c.lineWidth=3;c.lineJoin="round";c.lineCap="round";
      c.shadowColor=item.color;c.shadowBlur=8;c.stroke();c.shadowColor="transparent";c.shadowBlur=0;
      included.forEach(({point,index})=>{
        const x=xAt(index),y=yAt(hours(point,item.key));
        c.beginPath();c.fillStyle=item.color;c.arc(x,y,4,0,Math.PI*2);c.fill();
        c.beginPath();c.fillStyle="#132b40";c.arc(x,y,1.7,0,Math.PI*2);c.fill();
      });
    }
  }else{
    c.textAlign="center";c.fillStyle="#dbe6ef";c.font="600 13px Arial, sans-serif";
    c.fillText(included.length?"No time logged":"Upcoming period",p.l+plotWidth/2,p.t+plotHeight/2-8,plotWidth);
    c.fillStyle="#a3b8cc";c.font="11px Arial, sans-serif";
    c.fillText(included.length?"Saved time will appear here.":"Data will appear as days begin.",p.l+plotWidth/2,p.t+plotHeight/2+12,plotWidth);
  }
  c.textAlign="center";c.textBaseline="top";
  const labelWidth=Math.max(1,Math.min(72,plotWidth/intervalCount-4));
  data.forEach((point,index)=>{
    const future=cutoff&&(point.date||point.start)>cutoff;
    c.fillStyle=future?"#8297aa":"#c6d5e2";c.font="600 10px Arial, sans-serif";
    c.fillText(point.label,betweenDates?axisXAt(index):xAt(index),height-p.b+8,labelWidth);
    if(showRanges&&point.start&&point.end){
      const first=Number(point.start.slice(8,10)),last=Number(point.end.slice(8,10));
      c.fillStyle="#9eafbf";c.font="10px Arial, sans-serif";
      c.fillText(first===last?String(first):first+"–"+last,xAt(index),height-p.b+23,labelWidth);
    }
  });
  if(betweenDates&&data.length){
    const nextDate=moveDate(data[data.length-1].date,1);
    c.fillStyle=cutoff&&nextDate>cutoff?"#8297aa":"#c6d5e2";c.font="600 10px Arial, sans-serif";
    c.fillText(datePretty(nextDate,{day:"numeric",month:"short"}),axisXAt(data.length),height-p.b+8,labelWidth);
  }
  const summary=included.map(({point})=>point.label+": "+series.map(item=>item.key+" "+fmtTime(hours(point,item.key)*60)).join(", ")).join("; ");
  canvas.setAttribute("role","img");
  canvas.setAttribute("aria-label",(canvas.id==="monthlyChart"?"Monthly":"Weekly")+" time chart. "+(summary||"This period has not started yet."));
}
async function renderLog(){
  const date=state.date,ownerId=state.user.id,version=++logRenderVersion;
  const isCurrentRender=()=>state.page==="log"&&state.date===date&&state.user?.id===ownerId&&version===logRenderVersion;
  let d;
  try{d=await request("/api/day?date="+encodeURIComponent(date));}
  catch(error){if(isCurrentRender())throw error;return;}
  if(!isCurrentRender())return;
  const groups=["Study","Mobile","Sleep","Work","Other"];
  const grouped=groups.map(group=>[group,d.activities.filter(activity=>activity.group===group)]).filter(([,activities])=>activities.length);
  const sections=grouped.map(([group,activities])=>{
    const rows=activities.map(activity=>{
      const total=mins(d.times[activity.id]),name=esc(activity.name);
      return `<div class="activity-row">
        <div><div class="activity-name">${name}</div><div class="activity-group-name">${esc(group)}</div></div>
        <div class="duration-input" role="group" aria-label="${name} time" data-activity="${esc(activity.id)}" data-saved-minutes="${total}">
          <label class="duration-part"><span class="duration-label">Hours</span><input class="time-input" type="text" inputmode="numeric" maxlength="2" pattern="[0-9]*" autocomplete="off" aria-label="${name} hours" data-hours value="${Math.floor(total/60)}"></label>
          <span class="duration-separator" aria-hidden="true">:</span>
          <label class="duration-part"><span class="duration-label">Minutes</span><input class="time-input" type="text" inputmode="numeric" maxlength="2" pattern="[0-9]*" autocomplete="off" aria-label="${name} minutes" data-minutes value="${String(total%60).padStart(2,"0")}"></label>
        </div>
      </div>`;
    }).join("");
    return '<section class="activity-group"><h3 class="group-heading"><i class="group-color" style="background:'+groupColor(group)+'"></i>'+esc(group)+'</h3>'+rows+'</section>';
  }).join("");
  content.innerHTML='<div class="page-heading"><div><p class="eyebrow">A SMALL DAILY CHECK-IN</p><h1>Daily log</h1><p>Enter the time you spent on each activity.</p></div>'+dateControl("One entry per day")+'</div><section class="log-panel"><div class="log-toolbar"><strong>'+esc(datePretty(date))+'</strong><span>Enter hours and minutes separately, for example 2 hours and 30 minutes.</span></div><form id="dayForm">'+sections+'<label class="field notes-field">Notes <textarea name="notes" maxlength="2000" placeholder="Anything you want to remember about today?">'+esc(d.notes)+'</textarea></label><div class="log-footer"><button class="button button-primary" type="submit">Save daily log <span>→</span></button><span id="savedMark" class="saved-mark"></span><small>Changes update your graphs automatically.</small></div></form></section>';
  const form=$("#dayForm"),controls=[...form.querySelectorAll("[data-activity]")];
  form.pendingSave=null;form.saveVersion=0;
  const isCurrent=()=>form.isConnected&&state.page==="log"&&state.date===date&&state.user?.id===ownerId;
  for(const control of controls){
    for(const input of Object.values(logDurationFields(control))){
      input.addEventListener("input",()=>validateLogDuration(control));
      input.addEventListener("focus",()=>input.select());
    }
  }
  hookDate();
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"]');
    if(button.disabled||!isCurrent())return;
    const times={};let invalid=false;
    for(const control of controls){
      const value=validateLogDuration(control);
      if(Number.isNaN(value))invalid=true;
      else if(Number(value||0)!==Number(control.dataset.savedMinutes||0))times[control.dataset.activity]=value;
    }
    if(invalid){form.reportValidity();return;}
    const submittedValues=new Map(controls.map(control=>[control.dataset.activity,logDurationSnapshot(control)]));
    button.disabled=true;
    try{
      form.saveVersion++;
      form.pendingSave=request("/api/day",{method:"PUT",body:JSON.stringify({date,times,notes:form.elements.notes.value})});
      const saved=await form.pendingSave;
      if(!isCurrent())return;
      for(const control of controls){
        const total=Number(saved.log.times[control.dataset.activity]||0);
        if(logDurationSnapshot(control)===submittedValues.get(control.dataset.activity))setLogDuration(control,total);
        control.dataset.savedMinutes=String(total);
      }
      form.querySelector("#savedMark").textContent="Saved just now";toast("Daily log saved.");
    }catch(error){if(isCurrent())toast(error.message,true);}
    finally{form.pendingSave=null;button.disabled=false;}
  });
}
function renderLogout(){
  content.innerHTML='<section class="logout-screen"><div class="logout-mark" aria-hidden="true">↪</div><p class="eyebrow">SIGN OUT</p><h1>Log out of StudyOrbit?</h1><p>Your tracked time and schedule are saved to your account. You can sign in again anytime.</p><div class="logout-actions"><button class="button logout-cancel" id="cancelLogout" type="button">No, stay logged in</button><button class="button logout-confirm" id="confirmLogout" type="button">Yes, log out <span>→</span></button></div></section>';
  $("#cancelLogout").addEventListener("click",()=>navigate(state.returnPage||"dashboard"));
  $("#confirmLogout").addEventListener("click",async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      await request("/api/logout",{method:"POST",body:"{}"});
      sessionGeneration++;welcomeSession=null;
      history.replaceState(null,"","#welcome");showWelcome({discover:false});
    }catch(error){toast(error.message,true);button.disabled=false;}
  });
}
async function renderSchedule(){
 const p=state.user.profile||{},acts=state.activities,groups=["Study","Mobile","Sleep","Work","Other"];
 const rows=groups.map(g=>{const list=acts.filter(a=>a.group===g);if(!list.length)return"";return'<section class="activity-group"><h3 class="group-heading"><i class="group-color" style="background:'+groupColor(g)+'"></i>'+esc(g)+'</h3>'+list.map(a=>'<div class="activity-manage-row"><span class="activity-name">'+esc(a.name)+'</span><span class="activity-tag">'+esc(g)+'</span><button type="button" class="remove-button" title="Remove activity" aria-label="Remove '+esc(a.name)+'" data-remove="'+esc(a.id)+'">×</button></div>').join("")+'</section>';}).join("");
 content.innerHTML='<div class="page-heading"><div><p class="eyebrow">MAKE IT YOURS</p><h1>My schedule</h1><p>Add the activities and goals that fit your routine.</p></div></div><div class="schedule-layout"><section class="schedule-panel"><h2 class="section-title">Your activities</h2><p class="section-subtitle">Study and Mobile include starter suggestions. Remove and add activities to customize them.</p><div class="activity-list">'+(rows||'<p class="muted">No activities yet. Add one below.</p>')+'</div><form id="addActivityForm" class="add-form"><input name="name" maxlength="45" required placeholder="Activity name"><select name="group" aria-label="Activity group">'+groups.map(g=>'<option>'+g+'</option>').join("")+'</select><button class="button button-primary" type="submit">Add activity</button></form></section><section class="settings-panel"><h2 class="section-title">Daily targets</h2><p class="section-subtitle">Targets are optional. Enter a time like 2:30.</p><form id="goalForm" class="goal-form"><label class="field">Study goal per day<input id="studyGoalInput" name="study" type="text" inputmode="numeric" placeholder="e.g. 4:00" value="'+esc(fmtInput(p.studyGoalMinutes))+'"></label><label class="field">Mobile limit per day<input name="mobile" type="text" inputmode="numeric" placeholder="e.g. 2:00" value="'+esc(fmtInput(p.mobileLimitMinutes))+'"></label><button class="button button-primary" type="submit">Save targets <span>→</span></button></form><div class="settings-note">Your week starts Monday. The overview uses this schedule for daily, weekly, and monthly totals. Times are stored in minutes and shown as hours and minutes.</div></section></div>';
 $("#addActivityForm").addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const r=await request("/api/activities",{method:"POST",body:JSON.stringify({name:fd.get("name"),group:fd.get("group")})});state.activities.push(r.activity);toast("Activity added.");await renderSchedule();}catch(x){toast(x.message,true);}});
 document.querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",async()=>{const a=state.activities.find(x=>x.id===b.dataset.remove);if(!a||!confirm("Remove "+a.name+" from your schedule? Old entries will stay in your history."))return;try{await request("/api/activities/"+encodeURIComponent(a.id),{method:"DELETE"});state.activities=state.activities.filter(x=>x.id!==a.id);toast("Activity removed from your schedule.");await renderSchedule();}catch(x){toast(x.message,true);}}));
 $("#goalForm").addEventListener("submit",async e=>{e.preventDefault();const a=parseInput(e.currentTarget.elements.study.value),b=parseInput(e.currentTarget.elements.mobile.value);if(Number.isNaN(a)||Number.isNaN(b)){toast("Use hours:minutes from 0:00 to 24:00.",true);return;}try{const r=await request("/api/profile",{method:"PUT",body:JSON.stringify({studyGoalMinutes:a,mobileLimitMinutes:b})});state.user.profile=r.profile;toast("Daily targets saved.");}catch(x){toast(x.message,true);}});
}
routePublicScreen({initial:true});
window.addEventListener("resize",()=>{if(state.view==="app"&&state.page==="dashboard")render();});







