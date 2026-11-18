import {test} from 'node:test';
import assert from 'node:assert/strict';
import webPush from 'web-push';
import {brazilClock,dueFilter,pushConfig,normalizeSubscription,validateEndpoint,jobAuthorized,sendDueNotifications} from '../src/notifications.js';

const noon=new Date('2026-11-18T15:00:00Z');
export function fixture(){
 const state={row:null,sent:0,count:1,active:true,queries:[]};
 const db={
  pushSubscription:{findMany:async query=>{state.queries.push(query);return state.active?[{id:'device'}]:[]},findUnique:async()=>({id:'device',userId:'client',active:state.active,user:{active:true,role:'CLIENT'}}),updateMany:async({data})=>{if(data.active===false)state.active=false;return {count:1}}},
  installment:{count:async({where})=>{state.where=where;return state.count}},
  notificationDelivery:{
   upsert:async({create})=>{state.row??={id:'delivery',...create,status:'PENDING',attempts:0,lockedUntil:null};return {...state.row}},
   updateMany:async({where,data})=>{
    const r=state.row;
    if(where.leaseToken&&r.leaseToken!==where.leaseToken)return {count:0};
    if(where.status&&(!where.status.in.includes(r.status)||r.attempts>=5||r.nextAttemptAt>where.nextAttemptAt.lte||(r.lockedUntil&&r.lockedUntil>where.OR[1].lockedUntil.lte)))return {count:0};
    for(const [key,value] of Object.entries(data))r[key]=key==='attempts'?r.attempts+value.increment:value;
    return {count:1};
   }
  }
 };
 return {state,db,sendPush:async(subscription,payload,ttl)=>{state.sent++;state.payload=payload;state.ttl=ttl}};
}
test('horário e calendário são de Brasília, inclusive perto da meia-noite',()=>{
 assert.deepEqual(brazilClock(new Date('2026-11-18T02:30Z')),{day:'2026-11-17',hour:23});
 assert.deepEqual(brazilClock(noon),{day:'2026-11-18',hour:12});
 const where=dueFilter('2026-11-18');assert.deepEqual(where.status.in,['OPEN','REJECTED']);
 assert.equal(where.dueDate.gte.toISOString(),'2026-11-18T00:00:00.000Z');assert.equal(where.dueDate.lt.toISOString(),'2026-11-19T00:00:00.000Z');
});
test('configuração exige par de chaves válido e contato',()=>{
 const keys=webPush.generateVAPIDKeys(),env={VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:teste@example.com'};
 assert.equal(pushConfig(env).enabled,true);assert.equal(pushConfig({...env,VAPID_PRIVATE_KEY:'incorreta'}).enabled,false);assert.equal(pushConfig({...env,VAPID_SUBJECT:''}).enabled,false);
});
test('assinatura recusa endpoints internos, host falsificado e chaves inválidas',()=>{
 for(const host of ['http://fcm.googleapis.com/x','https://localhost/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com:444/x','https://a@fcm.googleapis.com/x'])assert.throws(()=>validateEndpoint(host));
 const keys=webPush.generateVAPIDKeys();
 const valid={endpoint:'https://web.push.apple.com/test',keys:{p256dh:keys.publicKey,auth:Buffer.alloc(16).toString('base64url')}};
 assert.equal(normalizeSubscription(valid).endpointHash.length,64);assert.throws(()=>normalizeSubscription({...valid,keys:{...valid.keys,auth:'a'}}));
});
test('agendador exige Bearer e segredo suficientemente longo',()=>{
 const secret='x'.repeat(40);assert.equal(jobAuthorized('Bearer '+secret,secret),true);assert.equal(jobAuthorized(secret,secret),false);assert.equal(jobAuthorized('Bearer errado',secret),false);assert.equal(jobAuthorized('Bearer curto','curto'),false);
});
test('antes de 12h não consulta nem envia; a partir de 12h envia e deduplica',async()=>{
 const f=fixture();assert.equal((await sendDueNotifications({...f,now:new Date('2026-11-18T14:59Z')})).beforeWindow,true);assert.equal(f.state.queries.length,0);
 assert.equal((await sendDueNotifications({...f,now:noon})).sent,1);
 assert.equal((await sendDueNotifications({...f,now:noon})).sent,0);assert.equal(f.state.sent,1);
 assert.equal(f.state.row.status,'SENT');assert.equal(f.state.where.contract.client.userId,'client');assert.ok(f.state.ttl<=43200);
 assert.equal(f.state.payload.day,'2026-11-18');assert.doesNotMatch(JSON.stringify(f.state.payload),/cpf|amount|client/i);
});
test('execuções concorrentes obtêm somente uma concessão de envio',async()=>{
 const f=fixture();await Promise.all([sendDueNotifications({...f,now:noon}),sendDueNotifications({...f,now:noon})]);assert.equal(f.state.sent,1);
});
test('reconfere baixa antes do envio e não cobra parcela já paga',async()=>{
 const f=fixture();f.state.count=0;await sendDueNotifications({...f,now:noon});assert.equal(f.state.sent,0);assert.equal(f.state.row.status,'SKIPPED');
});
test('falha temporária espera 15 minutos e limita tentativas a cinco',async()=>{
 const f=fixture(),sendPush=async()=>{throw Error('provider unavailable')};
 for(let attempt=0;attempt<5;attempt++){
  const now=new Date(noon.getTime()+attempt*900000);await sendDueNotifications({...f,sendPush,now});
  await sendDueNotifications({...f,sendPush,now});assert.equal(f.state.row.attempts,attempt+1);
 }
 assert.equal(f.state.row.status,'ABANDONED');
});
test('assinatura expirada é desativada; concessão abandonada pode ser retomada',async()=>{
 const f=fixture();await sendDueNotifications({...f,sendPush:async()=>{throw {statusCode:410}},now:noon});assert.equal(f.state.active,false);assert.equal(f.state.row.status,'EXPIRED');
 const g=fixture();g.state.row={id:'delivery',status:'PENDING',attempts:1,nextAttemptAt:noon,lockedUntil:new Date(noon.getTime()-1),leaseToken:'old'};
 await sendDueNotifications({...g,now:noon});assert.equal(g.state.sent,1);
});
