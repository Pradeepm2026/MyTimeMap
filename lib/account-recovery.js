"use strict";
const crypto=require("node:crypto");
const publicMessage="If this email is registered, your recovery request has been submitted. Contact the administrator from your registered email to verify ownership.";
const buckets=new Map();
function allowRequest(address){
  const now=Date.now();
  for(const [key,bucket] of buckets)if(bucket.until<=now)buckets.delete(key);
  const key=crypto.createHash("sha256").update(address||"unknown").digest("hex");
  const bucket=buckets.get(key)||{count:0,until:now+10*60*1000};
  if(buckets.size>=10000&&!buckets.has(key))return false;
  bucket.count++;buckets.set(key,bucket);return bucket.count<=10;
}
function passwordFields(password){const salt=crypto.randomBytes(16).toString("hex");return{salt,passwordHash:crypto.pbkdf2Sync(password,salt,260000,64,"sha512").toString("hex"),passwordVersion:crypto.randomUUID()};}
function matches(password,user){if(typeof password!=="string"||password.length>128)return false;const hash=crypto.pbkdf2Sync(password,user.salt,260000,64,"sha512");const expected=Buffer.from(user.passwordHash,"hex");return hash.length===expected.length&&crypto.timingSafeEqual(hash,expected);}
function validPassword(password){return typeof password==="string"&&password.length>=12&&password.length<=128;}
module.exports={publicMessage,allowRequest,passwordFields,matches,validPassword};
