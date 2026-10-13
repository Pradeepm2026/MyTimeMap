"use strict";
const {randomUUID}=require("node:crypto");

function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function dateValid(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
function validate(input){
  if(!input||typeof input!=="object"||Array.isArray(input))fail("Enter form details.");
  const limits={name:120,filledDate:10,examDate:10,website:2048,applicationNumber:120,notes:2000},result={};
  for(const [key,limit] of Object.entries(limits)){
    if(input[key]!=null&&typeof input[key]!=="string")fail("Invalid "+key+".");
    result[key]=(input[key]||"").trim();
    if(result[key].length>limit)fail(key+" is too long.");
  }
  if(!result.name)fail("Enter the form or exam name.");
  if(!dateValid(result.filledDate))fail("Choose the date you filled the form.");
  if(result.examDate&&!dateValid(result.examDate))fail("Choose a valid exam date.");
  let url;try{url=new URL(result.website);}catch{fail("Enter a full website link, starting with https://.");}
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password)fail("Use an HTTP or HTTPS website link without login details.");
  result.website=url.href;
  return result;
}

function createFormsService({getDatabase,getMongoDatabase,save}){
  const collection=()=>getMongoDatabase()?.collection("forms");
  const local=()=>{const db=getDatabase();return db.forms||(db.forms=[]);};
  const publicForm=({_id,userId,...form})=>form;
  return {
    async list(userId){
      const mongo=collection();
      const forms=mongo?await mongo.find({userId}).sort({filledDate:-1,createdAt:-1}).toArray():local().filter(form=>form.userId===userId).sort((a,b)=>b.filledDate.localeCompare(a.filledDate)||b.createdAt-a.createdAt);
      return forms.map(publicForm);
    },
    async write(userId,id,input){
      const fields=validate(input),mongo=collection(),now=Date.now();
      if(id){
        if(mongo){const result=await mongo.updateOne({id,userId},{$set:{...fields,updatedAt:now}});if(!result.matchedCount)fail("Form not found.",404);}
        else{const form=local().find(item=>item.id===id&&item.userId===userId);if(!form)fail("Form not found.",404);const previous={...form};Object.assign(form,fields,{updatedAt:now});try{await save();}catch(error){Object.assign(form,previous);throw error;}}
        return {id,...fields,updatedAt:now};
      }
      const form={id:randomUUID(),userId,...fields,createdAt:now,updatedAt:now};
      if(mongo)await mongo.insertOne({...form,_id:form.id});
      else{local().push(form);try{await save();}catch(error){getDatabase().forms=local().filter(item=>item.id!==form.id);throw error;}}
      return publicForm(form);
    },
    async remove(userId,id){
      const mongo=collection();
      if(mongo){const result=await mongo.deleteOne({id,userId});if(!result.deletedCount)fail("Form not found.",404);}
      else{const forms=local(),index=forms.findIndex(item=>item.id===id&&item.userId===userId);if(index<0)fail("Form not found.",404);const [removed]=forms.splice(index,1);try{await save();}catch(error){forms.splice(index,0,removed);throw error;}}
    }
  };
}
module.exports={createFormsService};
