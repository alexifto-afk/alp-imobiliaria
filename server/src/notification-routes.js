import {pushConfig,normalizeSubscription,validateEndpoint,endpointHash,sendDueNotifications,jobAuthorized,REMINDER_HOUR,TIME_ZONE} from './notifications.js';

export function registerNotificationRoutes(app,{db,auth,current,env=process.env,sendPush,now=()=>new Date()}){
 const client=(req,res,next)=>req.auth.role==='CLIENT'?next():res.status(403).json({error:'Disponível apenas para clientes.'});
 const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(error=>{
  if(error.status&&error.status<500)return res.status(error.status).json({error:error.message});
  console.error('Falha no serviço de notificações');
  res.status(503).json({error:'Não foi possível atualizar as notificações. Tente novamente.'});
 });
 app.get('/api/notifications/config',auth,current,client,(req,res)=>{
  const config=pushConfig(env);res.setHeader('Cache-Control','no-store');
  res.json({enabled:config.enabled,publicKey:config.enabled?config.publicKey:null,reminderHour:REMINDER_HOUR,timeZone:TIME_ZONE});
 });
 app.post('/api/notifications/status',auth,current,client,wrap(async(req,res)=>{
  const endpoint=validateEndpoint(req.body?.endpoint);
  const found=await db.pushSubscription.findUnique({where:{endpointHash:endpointHash(endpoint)}});
  res.json({active:Boolean(found?.active&&found.userId===req.auth.id)});
 }));
 app.post('/api/notifications/subscriptions',auth,current,client,wrap(async(req,res)=>{
  if(!pushConfig(env).enabled)return res.status(503).json({error:'Os lembretes no celular ainda estão sendo configurados.'});
  const value=normalizeSubscription(req.body?.subscription);
  const existing=await db.pushSubscription.findUnique({where:{endpointHash:value.endpointHash}});
  if((!existing||existing.userId!==req.auth.id||!existing.active)&&await db.pushSubscription.count({where:{userId:req.auth.id,active:true}})>=10)return res.status(429).json({error:'Limite de aparelhos atingido. Entre em contato com a administração.'});
  await db.pushSubscription.upsert({where:{endpointHash:value.endpointHash},create:{...value,userId:req.auth.id},update:{...value,userId:req.auth.id,active:true}});
  res.status(201).json({ok:true});
 }));
 app.delete('/api/notifications/subscriptions',auth,current,client,wrap(async(req,res)=>{
  const endpoint=validateEndpoint(req.body?.endpoint);
  await db.pushSubscription.updateMany({where:{userId:req.auth.id,endpointHash:endpointHash(endpoint)},data:{active:false}});
  res.json({ok:true});
 }));
 app.post('/api/internal/notifications/due',wrap(async(req,res)=>{
  if(!env.NOTIFICATION_JOB_TOKEN||env.NOTIFICATION_JOB_TOKEN.length<32)return res.status(503).json({error:'Agendador não configurado.'});
  if(!jobAuthorized(req.get('authorization'),env.NOTIFICATION_JOB_TOKEN))return res.sendStatus(401);
  if(!pushConfig(env).enabled)return res.status(503).json({error:'Notificações ainda não configuradas.'});
  res.json(await sendDueNotifications({db,sendPush,now:now()}));
 }));
}
