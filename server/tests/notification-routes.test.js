import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import webPush from 'web-push';
import {registerNotificationRoutes} from '../src/notification-routes.js';
async function setup(run){
 const keys=webPush.generateVAPIDKeys(),env={VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:test@example.com',NOTIFICATION_JOB_TOKEN:'s'.repeat(40)};
 const state={row:null,writes:[],limit:0};
 const db={pushSubscription:{findUnique:async()=>state.row,count:async()=>state.limit,upsert:async args=>{state.writes.push(args);state.row={...args.create,active:true}},updateMany:async args=>{state.writes.push(args);return {count:0}},findMany:async()=>[]}};
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{if(!req.get('x-user'))return res.sendStatus(401);req.auth={id:req.get('x-user'),role:req.get('x-role')||'CLIENT'};next()};
 registerNotificationRoutes(app,{db,env,auth,current:(req,res,next)=>next(),sendPush:async()=>{throw Error('No real push in tests')},now:()=>new Date('2026-11-18T15:00Z')});
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const send=(path,method='GET',body,headers={'x-user':'client'})=>fetch('http://127.0.0.1:'+listener.address().port+path,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 const subscription={endpoint:'https://fcm.googleapis.com/test',keys:{p256dh:keys.publicKey,auth:Buffer.alloc(16).toString('base64url')}};
 try{await run({state,env,send,subscription})}finally{await new Promise(resolve=>listener.close(resolve))}
}
test('configuração exige sessão CLIENT e nunca expõe segredo ou chave privada',async()=>setup(async({send,env})=>{
 assert.equal((await send('/api/notifications/config','GET',null,{})).status,401);
 assert.equal((await send('/api/notifications/config','GET',null,{'x-user':'admin','x-role':'ADMIN'})).status,403);
 const response=await send('/api/notifications/config'),data=await response.json();assert.equal(data.reminderHour,12);assert.equal(data.enabled,true);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(data).includes(env.VAPID_PRIVATE_KEY));assert.ok(!JSON.stringify(data).includes(env.NOTIFICATION_JOB_TOKEN));
}));
test('cadastro utiliza usuário autenticado, status e remoção respeitam proprietário',async()=>setup(async({send,subscription,state})=>{
 assert.equal((await send('/api/notifications/subscriptions','POST',{subscription,userId:'victim'})).status,201);assert.equal(state.row.userId,'client');
 assert.equal((await (await send('/api/notifications/status','POST',{endpoint:subscription.endpoint},{'x-user':'other'})).json()).active,false);
 await send('/api/notifications/subscriptions','DELETE',{endpoint:subscription.endpoint},{'x-user':'other'});assert.equal(state.writes.at(-1).where.userId,'other');
 state.limit=10;state.row=null;assert.equal((await send('/api/notifications/subscriptions','POST',{subscription})).status,429);
}));
test('rejeita assinatura inválida e protege execução do agendador',async()=>setup(async({send,subscription,env,state})=>{
 assert.equal((await send('/api/notifications/subscriptions','POST',{subscription:{...subscription,endpoint:'https://localhost/x'}})).status,400);assert.equal(state.writes.length,0);
 assert.equal((await send('/api/internal/notifications/due','POST',{})).status,401);
 assert.equal((await send('/api/internal/notifications/due','POST',{}, {authorization:'Bearer '+env.NOTIFICATION_JOB_TOKEN})).status,200);
 env.VAPID_PRIVATE_KEY='';assert.equal((await send('/api/notifications/subscriptions','POST',{subscription})).status,503);
}));
