"use strict";
// Run locally once to grant access to the owner's existing account.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{MongoClient}=require("mongodb");
const root=path.resolve(__dirname,"..");
try{process.loadEnvFile(path.join(root,".env"));}catch(error){if(error.code!=="ENOENT")throw error;}
const email="pradeepmauryasln02@gmail.com";
async function main(){
  function createOwner(){
    if(!process.argv.includes("--create"))throw new Error("Owner account missing.");
    const password=fs.readFileSync(0,"utf8").trim();
    if(password.length<12||password.length>128)throw new Error("Invalid password length.");
    const salt=crypto.randomBytes(16).toString("hex");
    return{id:crypto.randomUUID(),name:"Pradeep",email,role:"admin",salt,passwordHash:crypto.pbkdf2Sync(password,salt,260000,64,"sha512").toString("hex"),profile:{studyGoalMinutes:null,mobileLimitMinutes:null}};
  }
  if(process.env.MONGODB_URI){
    const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
    try{await client.connect();const users=client.db(process.env.MONGODB_DB||"mytimemap").collection("users");
      const user=await users.findOne({email});
      if(!user){const owner=createOwner();await users.insertOne({...owner,_id:owner.id});}
      else await users.updateOne({_id:user._id},{$set:{role:"admin"}});
    }finally{await client.close();}
  }else{
    const file=path.join(process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(root,"data"),"mytimemap.json");
    const db=JSON.parse(fs.readFileSync(file,"utf8"));let user=db.users.find(item=>(item.email||"").toLowerCase()===email);
    if(!user){user=createOwner();db.users.push(user);}
    user.role="admin";fs.writeFileSync(file+".tmp",JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(file+".tmp",file);
  }
  console.log("Administrator account is ready. Existing account passwords are not changed by provisioning.");
}
main().catch(()=>{console.error("Admin provisioning failed. Check the database connection and ensure the owner's account already exists.");process.exitCode=1;});
