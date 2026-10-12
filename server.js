"use strict";
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{MongoClient}=require("mongodb");
const {createFocusService,createFocusRepository}=require("./lib/focus-timer");
const {buildWeeklyInsights}=require("./lib/weekly-insights");
const {buildStudyStreak}=require("./lib/study-streak");
try{process.loadEnvFile(path.join(__dirname,".env"));}catch(error){if(error.code!=="ENOENT")throw error;}
const ROOT=__dirname,PUBLIC=path.join(ROOT,"public"),IS_VERCEL=process.env.VERCEL==="1",DATA_DIR=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(ROOT,"data"),DB_FILE=path.join(DATA_DIR,"mytimemap.json");
const PORT=Number(process.env.PORT||3000),HOST=process.env.HOST||(process.env.NODE_ENV==="production"?"0.0.0.0":"127.0.0.1"),SESSION_DAYS=14;
const GROUPS=["Study","Mobile","Sleep","Work","Other"],COLORS={Study:"#3978f6",Mobile:"#f27b54",Sleep:"#9271d5",Work:"#e0a441",Other:"#6c8798"};
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".png":"image/png"};
if(!IS_VERCEL)fs.mkdirSync(DATA_DIR,{recursive:true});
function emptyDatabase(){return{users:[],activities:[],logs:[],sessions:[],focusTimers:[]};}
function readLocalDatabase(){const local=emptyDatabase();if(fs.existsSync(DB_FILE)){try{return Object.assign(local,JSON.parse(fs.readFileSync(DB_FILE,"utf8")));}catch(e){console.error("Could not read local data store:",e.message);}}return local;}
function writeLocalDatabase(snapshot){const t=DB_FILE+".tmp";fs.writeFileSync(t,JSON.stringify(snapshot,null,2),{mode:0o600});fs.renameSync(t,DB_FILE);}
let db=readLocalDatabase(),mongoClient=null,mongoDatabase=null,mongoCollections=null,persistQueue=Promise.resolve(),mongoBaseline=null;
async function replaceMongoCollection(collection,documents,keyOf){const operations=documents.map(document=>{const id=keyOf(document);return{replaceOne:{filter:{_id:id},replacement:{...document,_id:id},upsert:true}};});if(operations.length)await collection.bulkWrite(operations,{ordered:true});}
async function writeMongoSnapshot(snapshot){await Promise.all([replaceMongoCollection(mongoCollections.users,snapshot.users,item=>item.id),replaceMongoCollection(mongoCollections.activities,snapshot.activities,item=>item.id),replaceMongoCollection(mongoCollections.logs,snapshot.logs,item=>item.userId+":"+item.date),replaceMongoCollection(mongoCollections.sessions,snapshot.sessions,item=>item.tokenHash)]);await mongoCollections.sessions.deleteMany({_id:{$nin:snapshot.sessions.map(item=>item.tokenHash)}});}
async function writeMongoChanges(before,after){
  const specs=[{name:"users",key:item=>item.id},{name:"activities",key:item=>item.id},{name:"logs",key:item=>item.userId+":"+item.date},{name:"sessions",key:item=>item.tokenHash}];
  await Promise.all(specs.map(async spec=>{
    const collection=mongoCollections[spec.name],oldByKey=new Map(before[spec.name].map(item=>[spec.key(item),item])),newByKey=new Map(after[spec.name].map(item=>[spec.key(item),item])),operations=[];
    for(const [id,item] of newByKey){
      const old=oldByKey.get(id);
      if(old&&JSON.stringify(old)===JSON.stringify(item))continue;
      if(spec.name!=="logs"){operations.push({replaceOne:{filter:{_id:id},replacement:{...item,_id:id},upsert:true}});continue;}
      // Update only edited fields so another function's timer increment and
      // completion receipt survive unrelated manual log edits.
      const set={userId:item.userId,date:item.date},unset={};
      for(const field of ["notes","updatedAt"])if(item[field]!==undefined&&item[field]!==old?.[field])set[field]=item[field];
      for(const [activityId,minutes] of Object.entries(item.times||{}))if(minutes!==old?.times?.[activityId])set["times."+activityId]=minutes;
      for(const activityId of Object.keys(old?.times||{}))if(!(activityId in (item.times||{})))unset["times."+activityId]="";
      const update={$set:set};if(Object.keys(unset).length)update.$unset=unset;
      operations.push({updateOne:{filter:{_id:id},update,upsert:true}});
    }
    if(operations.length)await collection.bulkWrite(operations,{ordered:true});
    const removed=[...oldByKey.keys()].filter(id=>!newByKey.has(id));if(removed.length)await collection.deleteMany({_id:{$in:removed}});
  }));
}
async function refreshMongoSnapshot(){if(!mongoCollections)return;const [users,activities,logs,sessions]=await Promise.all([mongoCollections.users.find({}).toArray(),mongoCollections.activities.find({}).toArray(),mongoCollections.logs.find({}).toArray(),mongoCollections.sessions.find({}).toArray()]);const clean=items=>items.map(({_id,...item})=>item);db={users:clean(users),activities:clean(activities),logs:clean(logs),sessions:clean(sessions).filter(session=>session.expiresAt>Date.now())};mongoBaseline=JSON.parse(JSON.stringify(db));}
async function save(){if(!mongoCollections){writeLocalDatabase(db);return;}const snapshot=JSON.parse(JSON.stringify(db)),before=mongoBaseline||emptyDatabase();persistQueue=persistQueue.catch(()=>{}).then(()=>writeMongoChanges(before,snapshot)).then(()=>{mongoBaseline=JSON.parse(JSON.stringify(snapshot));});return persistQueue;}
async function connectDatabase(){const uri=process.env.MONGODB_URI;if(!uri){if(process.env.NODE_ENV==="production")throw new Error("MONGODB_URI is required in production.");console.warn("MONGODB_URI is not set; using local JSON storage for development.");return;}if(!/^mongodb(?:\+srv)?:\/\//i.test(uri))throw new Error("MONGODB_URI must start with mongodb:// or mongodb+srv://.");if(/YOUR_CLUSTER|YOUR_USERNAME|YOUR_PASSWORD|<[^>]+>/i.test(uri))throw new Error("MONGODB_URI still contains example placeholders. Copy the real connection string from MongoDB Atlas and replace every placeholder.");mongoClient=new MongoClient(uri,{serverSelectionTimeoutMS:10000});await mongoClient.connect();mongoDatabase=mongoClient.db(process.env.MONGODB_DB||"mytimemap");mongoCollections={users:mongoDatabase.collection("users"),activities:mongoDatabase.collection("activities"),logs:mongoDatabase.collection("logs"),sessions:mongoDatabase.collection("sessions")};await mongoCollections.users.createIndex({email:1},{unique:true,sparse:true});const [users,activities,logs,sessions]=await Promise.all([mongoCollections.users.find({}).toArray(),mongoCollections.activities.find({}).toArray(),mongoCollections.logs.find({}).toArray(),mongoCollections.sessions.find({}).toArray()]);if(users.length===0){db=readLocalDatabase();await writeMongoSnapshot(db);}else{const clean=items=>items.map(({_id,...item})=>item);db={users:clean(users),activities:clean(activities),logs:clean(logs),sessions:clean(sessions)};}mongoBaseline=JSON.parse(JSON.stringify(db));db.sessions=db.sessions.filter(session=>session.expiresAt>Date.now());await save();console.log("Connected to MongoDB database "+mongoDatabase.databaseName);}
function uid(){return crypto.randomUUID();}
function today(){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:process.env.APP_TIME_ZONE||"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),date=Object.fromEntries(parts.map(part=>[part.type,part.value]));return date.year+"-"+date.month+"-"+date.day;}
function focusDateAt(timestamp){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:process.env.APP_TIME_ZONE||"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(timestamp)),date=Object.fromEntries(parts.map(part=>[part.type,part.value]));return date.year+"-"+date.month+"-"+date.day;}
const focusService=createFocusService({repository:createFocusRepository({getDatabase:()=>db,getMongoDatabase:()=>mongoDatabase,save}),dateAt:focusDateAt});
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||""))return false;const d=new Date(s+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
function dt(s){return new Date(s+"T00:00:00Z");}
function key(d){return d.toISOString().slice(0,10);}
function plus(s,n){const d=dt(s);d.setUTCDate(d.getUTCDate()+n);return key(d);}
function weekStart(s){const d=dt(s);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return key(d);}
function weekEnd(s){return plus(s,6);}
function clamp(v){if(v==null||v==="")return null;return Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=1440?Number(v):NaN;}
function clean(s,max){return typeof s==="string"?s.trim().replace(/\s+/g," ").slice(0,max):"";}
function headers(){return {"X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"};}
function send(res,status,obj,extra={}){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers(),...extra});res.end(JSON.stringify(obj));}
function err(res,status,msg){send(res,status,{error:msg});}
function body(req){if(req.body&&typeof req.body==="object"&&!Buffer.isBuffer(req.body))return Promise.resolve(req.body);if(typeof req.body==="string"||Buffer.isBuffer(req.body)){try{return Promise.resolve(JSON.parse(String(req.body)||"{}"));}catch{return Promise.reject(Error("Invalid JSON"));}}return new Promise((resolve,reject)=>{let raw="",size=0;req.on("data",c=>{size+=c.length;if(size>1000000){reject(Error("too large"));req.destroy();}else raw+=c;});req.on("end",()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(Error("Invalid JSON"));}});req.on("error",reject);});}
function cookies(req){const out={};for(const p of (req.headers.cookie||"").split(";")){const i=p.indexOf("=");if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());}return out;}
function findSession(req){const token=cookies(req).mtm_session;if(!token)return null;const h=crypto.createHash("sha256").update(token).digest("hex"),session=db.sessions.find(s=>s.tokenHash===h&&s.expiresAt>Date.now());if(!session)return null;const user=db.users.find(u=>u.id===session.userId);return user?{session,user}:null;}
function cookie(token,clear){return "mtm_session="+(clear?"":encodeURIComponent(token))+"; HttpOnly; SameSite=Lax; Path=/; Max-Age="+(clear?0:SESSION_DAYS*86400)+(process.env.NODE_ENV==="production"?"; Secure":"");}
async function newSession(user){const token=crypto.randomBytes(32).toString("base64url"),csrf=crypto.randomBytes(24).toString("base64url");db.sessions=db.sessions.filter(s=>s.expiresAt>Date.now());const tokenHash=crypto.createHash("sha256").update(token).digest("hex");db.sessions.push({tokenHash,csrf,userId:user.id,expiresAt:Date.now()+SESSION_DAYS*86400000});await save();return{token,csrf,tokenHash};}
function userPublic(u){return{id:u.id,name:u.name,email:u.email||"",username:u.email?undefined:u.username,profile:u.profile};}
function activities(userId,all){return db.activities.filter(a=>a.userId===userId&&(all||a.active!==false));}
function defaults(userId){return [["Programming","Study"],["Aptitude","Study"],["Maths","Study"],["YouTube","Mobile"],["WhatsApp","Mobile"],["Chrome","Mobile"],["Sleep","Sleep"],["Work","Work"],["Other","Other"]].map(x=>({id:uid(),userId,name:x[0],group:x[1],color:COLORS[x[1]],active:true}));}
function getLog(userId,date){return db.logs.find(x=>x.userId===userId&&x.date===date)||{userId,date,times:{},notes:""};}
function totalGroup(log,acts,g){return acts.reduce((n,a)=>n+(a.group===g?Number(log.times?.[a.id]||0):0),0);}
function findUser(id){return db.users.find(u=>u.id===id);}
function totals(userId,from,to){const acts=activities(userId,true),logs=db.logs.filter(l=>l.userId===userId&&l.date>=from&&l.date<=to);let study=0,mobile=0,sleep=0,loggedDays=0,goalDays=0;const u=findUser(userId);for(const l of logs){const s=totalGroup(l,acts,"Study"),m=totalGroup(l,acts,"Mobile"),sl=totalGroup(l,acts,"Sleep");study+=s;mobile+=m;sleep+=sl;if(s+m+sl>0)loggedDays++;if(u.profile.studyGoalMinutes!=null&&s>=u.profile.studyGoalMinutes)goalDays++;}return{study,mobile,sleep,loggedDays,goalDays};}
function label(s,opts){return new Intl.DateTimeFormat("en-IN",{timeZone:"UTC",...opts}).format(dt(s));}
function weekDaySummary(userId,date,acts){
  const log=getLog(userId,date);
  const recorded=acts.filter(activity=>Object.hasOwn(log.times||{},activity.id)&&log.times[activity.id]!=null&&Number.isFinite(Number(log.times[activity.id])));
  return{
    label:label(date,{day:"numeric",month:"short"}),date,
    study:totalGroup(log,acts,"Study"),mobile:totalGroup(log,acts,"Mobile"),sleep:totalGroup(log,acts,"Sleep"),
    logged:recorded.length>0,studyLogged:recorded.some(activity=>activity.group==="Study"),mobileLogged:recorded.some(activity=>activity.group==="Mobile")
  };
}
function dashboard(u,date,monthValue=date.slice(0,7),weekValue=date){
  const acts=activities(u.id,true),day=getLog(u.id,date),selected={study:totalGroup(day,acts,"Study"),mobile:totalGroup(day,acts,"Mobile"),sleep:totalGroup(day,acts,"Sleep")};
  const ws=weekStart(weekValue),we=weekEnd(ws),ms=monthValue+"-01",nm=new Date(ms+"T00:00:00Z");nm.setUTCMonth(nm.getUTCMonth()+1);const me=plus(key(nm),-1);
  const week=totals(u.id,ws,we),month=totals(u.id,ms,me),daily=[];
  const dailyActivities=acts.filter(a=>a.group==="Study"||a.group==="Mobile");
  const palettes={Study:["#3978f6","#39a27b","#9271d5","#2499a8","#bf6aa5","#739543"],Mobile:["#f27b54","#d6a02b","#427e9c","#d45d70","#6b9d65","#8c77bd"]},paletteIndex={Study:0,Mobile:0};
  const dailyLegend=dailyActivities.map(a=>{const i=paletteIndex[a.group]++;return{id:a.id,name:a.name,group:a.group,color:palettes[a.group][i%palettes[a.group].length]};});
  for(let i=13;i>=0;i--){const d=plus(date,-i),l=getLog(u.id,d),activityValues=Object.fromEntries(dailyActivities.map(a=>[a.id,Number(l.times?.[a.id]||0)]));daily.push({label:label(d,{day:"2-digit",month:"short"}),date:d,study:totalGroup(l,acts,"Study"),mobile:totalGroup(l,acts,"Mobile"),activityValues});}
  const currentDate=today(),comparisonDays=Array.from({length:14},(_,index)=>weekDaySummary(u.id,plus(ws,index-7),acts));
  const selectedWeekDays=comparisonDays.slice(7),weeklyInsights=buildWeeklyInsights({start:ws,today:currentDate,days:comparisonDays});
  const weekly=[];for(let i=7;i>=0;i--){const st=plus(ws,-7*i),en=weekEnd(st),t=totals(u.id,st,en);weekly.push({label:label(st,{day:"2-digit",month:"short"}),start:st,end:en,study:t.study,mobile:t.mobile,sleep:t.sleep});}
  const selectedMonthWeeks=[],monthDayCount=Number(me.slice(8,10));for(let startDay=1,weekNumber=1;startDay<=monthDayCount;startDay+=7,weekNumber++){const periodStart=plus(ms,startDay-1),periodEnd=plus(ms,Math.min(startDay+6,monthDayCount)-1),t=totals(u.id,periodStart,periodEnd);selectedMonthWeeks.push({label:"Week "+weekNumber,start:periodStart,end:periodEnd,study:t.study,mobile:t.mobile,sleep:t.sleep});}
  const monthly=[],yr=monthValue.slice(0,4);for(let m=0;m<12;m++){const st=yr+"-"+String(m+1).padStart(2,"0")+"-01",d=new Date(st+"T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);const t=totals(u.id,st,plus(key(d),-1));monthly.push({label:new Intl.DateTimeFormat("en",{month:"short",timeZone:"UTC"}).format(dt(st)),study:t.study,mobile:t.mobile,sleep:t.sleep,loggedDays:t.loggedDays,studyAvg:t.loggedDays?Math.round(t.study/t.loggedDays):0,mobileAvg:t.loggedDays?Math.round(t.mobile/t.loggedDays):0,sleepAvg:t.loggedDays?Math.round(t.sleep/t.loggedDays):0});}
  return{date,today:currentDate,selected,weeklyInsights,week:{...week,start:ws,end:we},month:{...month,start:ms,end:me,studyAvg:month.loggedDays?Math.round(month.study/month.loggedDays):0,mobileAvg:month.loggedDays?Math.round(month.mobile/month.loggedDays):0,sleepAvg:month.loggedDays?Math.round(month.sleep/month.loggedDays):0},goal:{study:u.profile.studyGoalMinutes,mobile:u.profile.mobileLimitMinutes},dailyLegend,dailySeries:daily,selectedWeekSeries:selectedWeekDays,selectedMonthWeeks,weeklySeries:weekly,monthlySeries:monthly};
}
function auth(u,s){return{user:userPublic(u),activities:activities(u.id,false),csrfToken:s.csrf};}
function need(req,res){const f=findSession(req);if(!f)err(res,401,"Please sign in again.");return f;}
function csrf(req,res,f){if(req.headers["x-csrf-token"]!==f.session.csrf){err(res,403,"Session check failed. Refresh and try again.");return false;}return true;}
async function api(req,res,url){
  if(req.method==="GET"&&url.pathname==="/api/health")return send(res,200,{ok:true});
  if(req.method==="POST"&&url.pathname==="/api/register"){
    const b=await body(req),name=clean(b.name,60),email=clean(b.email,254).toLowerCase(),password=String(b.password||"");
    if(name.length<2)return err(res,400,"Enter your name (at least 2 characters).");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return err(res,400,"Enter a valid email address.");
    if(password.length<8)return err(res,400,"Password must be at least 8 characters.");
    if(db.users.some(x=>(x.email||"").toLowerCase()===email))return err(res,409,"An account with this email already exists.");
    const salt=crypto.randomBytes(16).toString("hex"),passwordHash=crypto.pbkdf2Sync(password,salt,260000,64,"sha512").toString("hex"),u={id:uid(),name,email,salt,passwordHash,profile:{studyGoalMinutes:null,mobileLimitMinutes:null}};
    db.users.push(u);db.activities.push(...defaults(u.id));const s=await newSession(u);return send(res,201,auth(u,s),{"Set-Cookie":cookie(s.token,false)});
  }
  if(req.method==="POST"&&url.pathname==="/api/login"){
    const b=await body(req),identifier=clean(b.email||b.username,254).toLowerCase(),u=db.users.find(x=>(x.email||"").toLowerCase()===identifier||(!x.email&&x.username===identifier));if(!u)return err(res,401,"Email or password is incorrect.");
    const h=crypto.pbkdf2Sync(String(b.password||""),u.salt,260000,64,"sha512");if(!crypto.timingSafeEqual(h,Buffer.from(u.passwordHash,"hex")))return err(res,401,"Email or password is incorrect.");
    const s=await newSession(u);return send(res,200,auth(u,s),{"Set-Cookie":cookie(s.token,false)});
  }
  if(req.method==="GET"&&url.pathname==="/api/me"){const f=findSession(req);if(!f)return err(res,401,"Sign in to continue.");return send(res,200,auth(f.user,f.session));}
  const f=need(req,res);if(!f)return;const u=f.user;
  if(url.pathname==="/api/focus"&&(req.method==="GET"||req.method==="POST")){
    if(req.method==="POST"&&!csrf(req,res,f))return;
    try{const result=req.method==="GET"?await focusService.read(u.id):await focusService.act(u.id,await body(req),db.activities);return send(res,200,result);}
    catch(error){if(error.status)return err(res,error.status,error.message);throw error;}
  }
  if(req.method==="POST"&&url.pathname==="/api/logout"){if(!csrf(req,res,f))return;db.sessions=db.sessions.filter(s=>s.tokenHash!==f.session.tokenHash);await save();return send(res,200,{ok:true},{"Set-Cookie":cookie("",true)});}
  if(req.method==="GET"&&url.pathname==="/api/dashboard"){const d=url.searchParams.get("date")||today(),m=url.searchParams.get("month")||d.slice(0,7),w=url.searchParams.get("week")||d;if(!validDate(d))return err(res,400,"Choose a valid date.");if(!/^\d{4}-\d{2}$/.test(m)||!validDate(m+"-01"))return err(res,400,"Choose a valid month.");if(!validDate(w))return err(res,400,"Choose a valid week.");return send(res,200,dashboard(u,d,m,w));}
  if(req.method==="GET"&&url.pathname==="/api/study-streak"){
    const currentDate=today(),month=url.searchParams.get("month")||currentDate.slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(0,4))<1||!validDate(month+"-01"))return err(res,400,"Choose a valid month and year.");
    return send(res,200,buildStudyStreak({userId:u.id,logs:db.logs,activities:db.activities,today:currentDate,month,timeZone:process.env.APP_TIME_ZONE||"Asia/Kolkata"}));
  }
  if(req.method==="GET"&&url.pathname==="/api/day"){const d=url.searchParams.get("date")||today();if(!validDate(d))return err(res,400,"Choose a valid date.");const l=getLog(u.id,d);return send(res,200,{date:d,times:l.times||{},notes:l.notes||"",activities:activities(u.id,false)});}
  if(req.method==="PUT"&&url.pathname==="/api/day"){if(!csrf(req,res,f))return;const b=await body(req);if(!validDate(b.date))return err(res,400,"Choose a valid date.");const currentDate=today();if(b.date<plus(currentDate,-1)||b.date>currentDate)return err(res,400,"Daily logs can only be entered for today or yesterday.");if(!b.times||Array.isArray(b.times)||typeof b.times!=="object")return err(res,400,"Daily time data is missing.");const allow=new Set(activities(u.id,false).map(a=>a.id)),old=getLog(u.id,b.date),times={...old.times};for(const [aid,v] of Object.entries(b.times)){if(!allow.has(aid))return err(res,400,"An activity is no longer on your schedule.");const m=clamp(v);if(Number.isNaN(m))return err(res,400,"Enter time from 0:00 to 24:00.");if(m===null)delete times[aid];else times[aid]=m;}const notes=typeof b.notes==="string"?b.notes.slice(0,2000):"";const next={...old,userId:u.id,date:b.date,times,notes,updatedAt:Date.now()},i=db.logs.findIndex(l=>l.userId===u.id&&l.date===b.date);if(i<0)db.logs.push(next);else db.logs[i]=next;await save();return send(res,200,{ok:true,log:next,dashboard:dashboard(u,b.date)});}
  if(req.method==="PUT"&&url.pathname==="/api/profile"){if(!csrf(req,res,f))return;const b=await body(req),sg=clamp(b.studyGoalMinutes),ml=clamp(b.mobileLimitMinutes);if(Number.isNaN(sg)||Number.isNaN(ml))return err(res,400,"Goals must be between 0:00 and 24:00.");u.profile={studyGoalMinutes:sg,mobileLimitMinutes:ml};await save();return send(res,200,{profile:u.profile});}
  if(req.method==="POST"&&url.pathname==="/api/activities"){if(!csrf(req,res,f))return;const b=await body(req),name=clean(b.name,45),group=String(b.group||"");if(!name)return err(res,400,"Enter an activity name.");if(!GROUPS.includes(group))return err(res,400,"Choose a valid activity group.");if(activities(u.id,false).some(a=>a.group===group&&a.name.toLowerCase()===name.toLowerCase()))return err(res,409,"That activity already exists in this group.");const a={id:uid(),userId:u.id,name,group,color:COLORS[group],active:true};db.activities.push(a);await save();return send(res,201,{activity:a});}
  const am=url.pathname.match(/^\/api\/activities\/([0-9a-f-]+)$/i);if(req.method==="DELETE"&&am){if(!csrf(req,res,f))return;const a=db.activities.find(x=>x.id===am[1]&&x.userId===u.id&&x.active!==false);if(!a)return err(res,404,"Activity not found.");a.active=false;await save();return send(res,200,{ok:true});}
  if(req.method==="GET"&&url.pathname==="/api/export"){const acts=activities(u.id,true),rows=[["Date","Group","Activity","Time (hh:mm)","Notes"]];for(const l of db.logs.filter(x=>x.userId===u.id).sort((a,b)=>a.date.localeCompare(b.date))){for(const a of acts){const m=Number(l.times?.[a.id]||0);if(m>0)rows.push([l.date,a.group,a.name,Math.floor(m/60)+":"+String(m%60).padStart(2,"0"),l.notes||""]);}}const csv=rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\r\n");res.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=studyorbit-data.csv",...headers()});return res.end("\uFEFF"+csv);}
  return err(res,404,"Page not found.");
}
let databaseReady=null,requestQueue=Promise.resolve();
async function processRequest(req,res){
  try{databaseReady=databaseReady||connectDatabase();await databaseReady;await refreshMongoSnapshot();}catch(error){console.error("Could not connect to MongoDB:",error.message);return err(res,500,"Database connection failed. Check the MONGODB_URI and Atlas network access settings.");}
  const requestUrl=new URL(req.url,"http://127.0.0.1"),routedPath=requestUrl.searchParams.get("__path");
  let url=requestUrl;
  if(routedPath){requestUrl.searchParams.delete("__path");url=new URL(routedPath+requestUrl.search,"http://127.0.0.1");}
  if(url.pathname.startsWith("/api/")){try{return await api(req,res,url);}catch(e){console.error(e);if(!res.headersSent)return err(res,500,"Something went wrong. Please try again.");res.end();return;}}
  const file=url.pathname==="/"?"index.html":path.basename(url.pathname),full=path.join(PUBLIC,file);
  try{const data=await fs.promises.readFile(full);res.writeHead(200,{"Content-Type":MIME[path.extname(full)]||"application/octet-stream","Cache-Control":"no-cache",...headers()});res.end(data);}catch{res.writeHead(404,headers());res.end("Not found");}
}
function handleRequest(req,res){const current=requestQueue.then(()=>processRequest(req,res),()=>processRequest(req,res));requestQueue=current.catch(()=>{});return current;}
module.exports=handleRequest;
if(require.main===module){const server=http.createServer(handleRequest);databaseReady=connectDatabase();databaseReady.then(()=>server.listen(PORT,HOST,()=>console.log("StudyOrbit is running at http://"+HOST+":"+PORT))).catch(error=>{console.error("Could not start StudyOrbit:",error.message);process.exit(1);});function shutdown(){server.close(async()=>{if(mongoClient)await mongoClient.close();process.exit(0);});}process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);}



