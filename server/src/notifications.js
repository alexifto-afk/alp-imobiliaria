import {getCompany} from './company-settings.js';
import crypto from 'node:crypto';

export const REMINDER_HOUR=12;
export const TIME_ZONE='America/Sao_Paulo';
export function brazilClock(date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour)};
}
export function dueFilter(day){
 const start=new Date(day+'T00:00:00Z');
 return {dueDate:{gte:start,lt:new Date(start.getTime()+86400000)},status:{in:['OPEN','REJECTED']}};
}
export function pushConfig(env){
 const publicKey=String(env.VAPID_PUBLIC_KEY||'').trim(),privateKey=String(env.VAPID_PRIVATE_KEY||'').trim();
 const subject=String(env.VAPID_SUBJECT||'').trim();
 let enabled=false;
 try{
  if(!/^[A-Za-z0-9_-]+={0,2}$/.test(publicKey)||!/^[A-Za-z0-9_-]+={0,2}$/.test(privateKey))return {enabled:false,publicKey,privateKey,subject};
  const ec=crypto.createECDH('prime256v1');ec.setPrivateKey(Buffer.from(privateKey,'base64url'));
  const supplied=Buffer.from(publicKey,'base64url'),derived=ec.getPublicKey();
  enabled=supplied.length===65&&crypto.timingSafeEqual(supplied,derived)&&(/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)||/^https:\/\/[^\s]+$/.test(subject));
 }catch{}
 return {enabled,publicKey,privateKey,subject};
}
export function endpointHash(endpoint){return crypto.createHash('sha256').update(endpoint).digest('hex')}
export function validateEndpoint(value){
 if(typeof value!=='string'||value.length>2048)throw Object.assign(Error('Assinatura de notificações inválida.'),{status:400});
 let url;try{url=new URL(value)}catch{throw Object.assign(Error('Assinatura de notificações inválida.'),{status:400})}
 const allowed=['fcm.googleapis.com','web.push.apple.com','updates.push.services.mozilla.com'];
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed.includes(url.hostname))throw Object.assign(Error('Serviço de notificações não reconhecido.'),{status:400});
 return value;
}
export function normalizeSubscription(value){
 const endpoint=validateEndpoint(value?.endpoint);
 const p256dh=value?.keys?.p256dh,auth=value?.keys?.auth;
 const valid=(key,length)=>typeof key==='string'&&/^[A-Za-z0-9_-]+={0,2}$/.test(key)&&Buffer.from(key,'base64url').length===length;
 if(!valid(p256dh,65)||Buffer.from(p256dh,'base64url')[0]!==4||!valid(auth,16))throw Object.assign(Error('Chaves de notificações inválidas.'),{status:400});
 return {endpoint,endpointHash:endpointHash(endpoint),p256dh,auth};
}
export function createPushSender(env,webPush){
 return async(subscription,payload,ttl)=>{
  const config=pushConfig(env);if(!config.enabled)throw Error('Notificações não configuradas');
  return webPush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify(payload),{
   vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},TTL:ttl,timeout:10000,urgency:'normal'
  });
 };
}
async function claimDelivery(db,subscriptionId,day,now){
 let row;
 try{row=await db.notificationDelivery.upsert({where:{subscriptionId_day:{subscriptionId,day}},create:{subscriptionId,day,nextAttemptAt:now},update:{}})}
 catch(error){if(error.code==='P2002')return null;throw error}
 const leaseToken=crypto.randomUUID();
 const claim=await db.notificationDelivery.updateMany({where:{id:row.id,status:{in:['PENDING','RETRY']},attempts:{lt:5},nextAttemptAt:{lte:now},OR:[{lockedUntil:null},{lockedUntil:{lte:now}}]},data:{attempts:{increment:1},leaseToken,lockedUntil:new Date(now.getTime()+120000)}});
 return claim.count?{id:row.id,leaseToken,attempt:row.attempts+1}:null;
}
export async function sendDueNotifications({db,sendPush,now=new Date()}){
 const {day,hour}=brazilClock(now),summary={day,sent:0,failed:0,skipped:0};
 if(hour<REMINDER_HOUR)return {...summary,beforeWindow:true};
 const due=dueFilter(day);
 const subscriptions=await db.pushSubscription.findMany({where:{
  active:true,user:{active:true,role:'CLIENT',client:{contracts:{some:{installments:{some:due}}}}},
  OR:[{deliveries:{none:{day}}},{deliveries:{some:{day,status:{in:['PENDING','RETRY']},attempts:{lt:5},nextAttemptAt:{lte:now},OR:[{lockedUntil:null},{lockedUntil:{lte:now}}]}}}]
 },orderBy:{id:'asc'},take:100});
 for(const subscription of subscriptions){
  const claim=await claimDelivery(db,subscription.id,day,now);if(!claim){summary.skipped++;continue}
  const finish=data=>db.notificationDelivery.updateMany({where:{id:claim.id,leaseToken:claim.leaseToken},data:{...data,lockedUntil:null,leaseToken:null}});
  try{
   const current=await db.pushSubscription.findUnique({where:{id:subscription.id},include:{user:{select:{active:true,role:true}}}});
   const count=current?.active&&current.user?.active&&current.user.role==='CLIENT'?await db.installment.count({where:{...due,contract:{client:{userId:current.userId}}}}):0;
   if(!count){await finish({status:'SKIPPED'});summary.skipped++;continue}
   const company=await getCompany(db);
   const payload={companyName:company.name,title:company.name,body:'Você tem parcela com vencimento hoje. Abra o app para consultar e pagar.',day,url:'/?view=installments',tag:'due-'+day};
   // O vencimento é uma data de calendário; o aviso expira até a meia-noite em Brasília.
   const ttl=Math.max(1,Math.min(43200,Math.floor((Date.parse(day+'T23:59:59-03:00')-now.getTime())/1000)));
   await sendPush(current,payload,ttl);
   await finish({status:'SENT',sentAt:now});await db.pushSubscription.updateMany({where:{id:current.id,active:true},data:{lastSuccessAt:now}});
   summary.sent++;
  }catch(error){
   const expired=[404,410].includes(error.statusCode);
   if(expired)await db.pushSubscription.updateMany({where:{id:subscription.id},data:{active:false}});
   await finish({status:expired?'EXPIRED':claim.attempt>=5?'ABANDONED':'RETRY',nextAttemptAt:new Date(now.getTime()+15*60000)});
   summary.failed++;
  }
 }
 return summary;
}
export function jobAuthorized(header,secret){
 if(typeof secret!=='string'||secret.length<32||!/^Bearer\s+/i.test(String(header||'')))return false;
 const supplied=String(header||'').replace(/^Bearer\s+/i,'');
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(),crypto.createHash('sha256').update(secret).digest());
}
