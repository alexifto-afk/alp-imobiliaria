import {createPasswordReset,createEmailSender} from './password-reset.js';

export function registerPasswordResetRoutes(app,{db,secret,hashPassword,env=process.env,fetchImpl=fetch,onDeliveryError=()=>console.error('Falha no envio de recuperação: confira Resend, domínio e remetente')}){
 const limits=new Map();
 const wrap=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
 function limit(req,res,next){
  const ip=String(req.ip||'unknown'),now=Date.now();
  const recent=(limits.get(ip)||[]).filter(t=>now-t<15*60*1000);
  if(recent.length>=12){res.setHeader('Retry-After','900');return res.status(429).json({error:'Muitas solicitações. Aguarde alguns minutos.'})}
  recent.push(now);limits.set(ip,recent);
  if(limits.size>10000)for(const [key,times]of limits)if(times.every(t=>now-t>15*60*1000))limits.delete(key);
  next();
 }
 const service=createPasswordReset({db,secret,hashPassword,sendEmail:createEmailSender({env,fetchImpl}),onDeliveryError});
 function ready(req,res,next){
  if(String(env.RESEND_API_KEY||'').trim()&&String(env.RESET_EMAIL_FROM||'').trim())return next();
  res.status(503).json({error:'A recuperação por e-mail ainda não está disponível. Entre em contato com a administração.'});
 }
 app.post('/api/auth/password-reset/request',limit,ready,wrap(async(req,res)=>res.json(await service.request(req.body))));
 app.post('/api/auth/password-reset/verify',limit,wrap(async(req,res)=>res.json(await service.verify(req.body))));
 app.post('/api/auth/password-reset/confirm',limit,wrap(async(req,res)=>res.json(await service.confirm(req.body))));
}
