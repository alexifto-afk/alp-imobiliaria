import 'dotenv/config';
import PDFDocument from 'pdfkit';
import {credentialVersion} from './password-reset.js';
import {registerPasswordResetRoutes} from './password-reset-routes.js';
import {validMpSignature} from './mp-signature.js';
import {confirmarPagamentoPix,reconciliarCobranca,reconciliarParcela,reconciliarPendentes} from './pix-confirmation.js';
import express from 'express';import cors from 'cors';import bcrypt from 'bcryptjs';import jwt from 'jsonwebtoken';import multer from 'multer';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {PrismaClient} from '@prisma/client';
const db=new PrismaClient(),app=express();app.disable('x-powered-by');app.use(express.json({limit:'100kb'}));
// Render encaminha requisições por proxy; permite limitar pelo IP do cliente.
app.set('trust proxy',process.env.NODE_ENV==='production'?1:false);
const origins=(process.env.CLIENT_ORIGIN||'http://localhost:5173').split(',').map(s=>s.trim());app.use(cors({origin:(origin,cb)=>cb(null,!origin||origins.includes(origin))}));
const secret=process.env.JWT_SECRET;if(!secret||secret.length<24)throw Error('JWT_SECRET deve ter ao menos 24 caracteres');
const issueToken=user=>jwt.sign({id:user.id,role:user.role,cv:credentialVersion(user.passwordHash,secret)},secret,{expiresIn:'12h'});
const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
const digits=v=>String(v||'').replace(/\D/g,'');const txt=v=>v==null?'':String(v).trim();const optional=v=>txt(v)||null;
const cents=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error('Valor monetário inválido (centavos).');return n};
const auth=(req,res,next)=>{try{const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');req.auth=jwt.verify(token,secret);next()}catch{res.status(401).json({error:'Sessão inválida ou expirada'})}};
const admin=(req,res,next)=>req.auth.role==='ADMIN'?next():res.status(403).json({error:'Acesso restrito'});
const current=wrap(async(req,res,next)=>{const u=await db.user.findUnique({where:{id:req.auth.id}});if(!u?.active)return res.status(401).json({error:'Conta inativa'});if(req.auth.cv!==credentialVersion(u.passwordHash,secret))return res.status(401).json({error:'Sua sessão expirou. Entre novamente.'});req.auth.role=u.role;req.auth.mustChangePassword=u.mustChangePassword;if(u.mustChangePassword&&!['/api/me','/api/me/password'].includes(req.path))return res.status(403).json({error:'Altere sua senha provisória antes de continuar'});next()});
app.get('/api/health',(_q,r)=>r.json({ok:true}));
app.post('/api/login',wrap(async(req,res)=>{const cpf=digits(req.body.cpf),user=await db.user.findUnique({where:{cpf}});if(!user?.active||!await bcrypt.compare(String(req.body.password||''),user.passwordHash))return res.status(401).json({error:'CPF ou senha inválidos'});const token=issueToken(user);res.json({token,user:{id:user.id,name:user.name,role:user.role,mustChangePassword:user.mustChangePassword}})}));
registerPasswordResetRoutes(app,{db,secret,hashPassword:password=>bcrypt.hash(password,12)});
app.get('/api/me',auth,current,wrap(async(req,res)=>{const u=await db.user.findUnique({where:{id:req.auth.id},select:{id:true,name:true,role:true,cpf:true,mustChangePassword:true}});res.json(u)}));
app.patch('/api/me/password',auth,current,wrap(async(req,res)=>{
 const old=String(req.body.currentPassword||''),password=String(req.body.newPassword||'');
 if(password.length<10||password===old)return res.status(400).json({error:'Nova senha deve ter ao menos 10 caracteres e ser diferente'});
 const u=await db.user.findUnique({where:{id:req.auth.id}});
 if(!await bcrypt.compare(old,u.passwordHash))return res.status(401).json({error:'Senha atual incorreta'});
 const updated=await db.user.update({where:{id:u.id},data:{passwordHash:await bcrypt.hash(password,12),mustChangePassword:false}});
 res.json({ok:true,token:issueToken(updated)});
}));
app.patch('/api/me/profile',auth,current,wrap(async(req,res)=>{
 const u=await db.user.findUnique({where:{id:req.auth.id},include:{client:true}});
 const name=txt(req.body.name),email=optional(req.body.email),birthDate=req.body.birthDate?new Date(req.body.birthDate+'T00:00:00Z'):null;
 if(name.length<3||name.length>150||email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)||birthDate&&Number.isNaN(birthDate.getTime()))return res.status(400).json({error:'Dados inválidos'});
 await db.user.update({where:{id:u.id},data:{name}});
 if(u.client)await db.client.update({where:{id:u.client.id},data:{email,birthDate}});
 res.json({ok:true});
}));
app.get('/api/me/profile',auth,current,wrap(async(req,res)=>{
 const u=await db.user.findUnique({where:{id:req.auth.id},include:{client:true}});
 res.json({name:u.name,cpf:u.cpf,email:u.client?.email||'',birthDate:u.client?.birthDate||null,mustChangePassword:u.mustChangePassword});
}));
app.get('/api/clients',auth,current,admin,wrap(async(_q,res)=>res.json(await db.client.findMany({include:{user:{select:{id:true,name:true,cpf:true,active:true}}},orderBy:{user:{name:'asc'}}}))));
const clientFields=b=>({phone:optional(b.phone),email:optional(b.email),rg:optional(b.rg),birthDate:b.birthDate?new Date(`${b.birthDate}T00:00:00.000Z`):null,sex:optional(b.sex),maritalStatus:optional(b.maritalStatus),spouseName:optional(b.spouseName),spouseCpf:optional(b.spouseCpf)});
app.post('/api/clients',auth,current,admin,wrap(async(req,res)=>{const b=req.body,cpf=digits(b.cpf);if(!/^\d{11}$/.test(cpf)||!txt(b.name))return res.status(400).json({error:'Nome e CPF de 11 dígitos são obrigatórios'});const password=String(b.password||'');if(password.length<8)return res.status(400).json({error:'Senha precisa ter ao menos 8 caracteres'});const out=await db.user.create({data:{name:txt(b.name),cpf,passwordHash:await bcrypt.hash(password,12),role:'CLIENT',mustChangePassword:true,client:{create:clientFields(b)}},include:{client:true}});res.status(201).json({id:out.client.id})}));
app.put('/api/clients/:id',auth,current,admin,wrap(async(req,res)=>{const b=req.body,c=await db.client.findUnique({where:{id:req.params.id}});if(!c)return res.status(404).json({error:'Cliente não encontrado'});await db.$transaction([db.user.update({where:{id:c.userId},data:{name:txt(b.name),cpf:digits(b.cpf)}}),db.client.update({where:{id:c.id},data:clientFields(b)})]);res.json({ok:true})}));
app.patch('/api/clients/:id/status',auth,current,admin,wrap(async(req,res)=>{const c=await db.client.findUnique({where:{id:req.params.id}});if(!c)return res.status(404).json({error:'Cliente não encontrado'});await db.user.update({where:{id:c.userId},data:{active:req.body.active===true}});res.json({ok:true})}));
app.delete('/api/clients/:id',auth,current,admin,wrap(async(req,res)=>{
 const c=await db.client.findUnique({where:{id:req.params.id},include:{_count:{select:{contracts:true}}}});
 if(!c)return res.status(404).json({error:'Cliente não encontrado'});
 if(c._count.contracts)return res.status(409).json({error:'Cliente com contratos: desative-o para preservar o histórico financeiro'});
 await db.$transaction([db.client.delete({where:{id:c.id}}),db.user.delete({where:{id:c.userId}})]);res.json({ok:true});
}));
app.get('/api/properties',auth,current,admin,wrap(async(_q,res)=>res.json(await db.property.findMany({orderBy:{createdAt:'desc'}}))));
const propertyFields=b=>({reference:txt(b.reference),address:txt(b.address),notes:optional(b.notes),stateCode:optional(b.stateCode),cityCode:optional(b.cityCode),city:optional(b.city),financed:b.financed==null?null:b.financed===true});
app.post('/api/properties',auth,current,admin,wrap(async(req,res)=>{const d=propertyFields(req.body);if(!d.reference||!d.address)return res.status(400).json({error:'Referência e endereço são obrigatórios'});res.status(201).json(await db.property.create({data:d}))}));
app.put('/api/properties/:id',auth,current,admin,wrap(async(req,res)=>{const d=propertyFields(req.body);if(!d.reference||!d.address)return res.status(400).json({error:'Referência e endereço são obrigatórios'});res.json(await db.property.update({where:{id:req.params.id},data:d}))}));
app.patch('/api/properties/:id/status',auth,current,admin,wrap(async(req,res)=>res.json(await db.property.update({where:{id:req.params.id},data:{active:req.body.active===true}}))));
app.delete('/api/properties/:id',auth,current,admin,wrap(async(req,res)=>{
 const p=await db.property.findUnique({where:{id:req.params.id},include:{_count:{select:{contracts:true}}}});
 if(!p)return res.status(404).json({error:'Imóvel não encontrado'});
 if(p._count.contracts)return res.status(409).json({error:'Imóvel vinculado a contratos: desative-o para preservar o histórico'});
 await db.property.delete({where:{id:p.id}});res.json({ok:true});
}));
const contractInclude={client:{include:{user:{select:{name:true,cpf:true,active:true}}}},property:true,installments:{orderBy:{number:'asc'},include:{receipts:{orderBy:{createdAt:'desc'}}}}};
app.get('/api/contracts',auth,current,admin,wrap(async(_q,res)=>res.json(await db.contract.findMany({include:contractInclude,orderBy:{createdAt:'desc'}}))));
function schedule(principal,n,type,rate){const r=rate/100,values=[];if(type==='NONE'){const base=Math.floor(principal/n);for(let i=0;i<n;i++)values.push(base+(i<principal%n?1:0));}
else if(type==='SIMPLE'){const total=Math.round(principal*(1+r*n)),base=Math.floor(total/n);for(let i=0;i<n;i++)values.push(base+(i<total%n?1:0));}
else if(type==='PRICE'){if(r===0)return schedule(principal,n,'NONE',0);const total=Math.round(principal*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1)*n),base=Math.floor(total/n);for(let i=0;i<n;i++)values.push(base+(i<total%n?1:0));}else throw Error('Modalidade de juros inválida');return values}
function addMonth(date,n){const y=date.getUTCFullYear(),m=date.getUTCMonth()+n,d=date.getUTCDate(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(d,last),12))}
app.post('/api/contracts',auth,current,admin,wrap(async(req,res)=>{const b=req.body,n=Number(b.installmentCount),type=txt(b.interestType)||'NONE',rate=Number(b.monthlyRate||0);if(!Number.isInteger(n)||n<1||n>600||!['NONE','SIMPLE','PRICE'].includes(type)||!Number.isFinite(rate)||rate<0||rate>100)return res.status(400).json({error:'Parcelas ou juros inválidos'});
const price=cents(b.propertyPrice),financed=cents(b.financedAmount);if(!price||financed>price)return res.status(400).json({error:'Valor total ou financiado inválido'});const start=new Date(`${b.startDate}T12:00:00.000Z`);if(Number.isNaN(start.getTime()))return res.status(400).json({error:'Data inválida'});const [c,p]=await Promise.all([db.client.findUnique({where:{id:b.clientId},include:{user:true}}),db.property.findUnique({where:{id:b.propertyId}})]);if(!c?.user.active||!p?.active)return res.status(400).json({error:'Cliente ou imóvel inexistente/inativo'});
const amounts=schedule(financed,n,type,rate);const result=await db.contract.create({data:{clientId:c.id,propertyId:p.id,propertyPrice:price,financedAmount:financed,downPayment:price-financed,interestType:type,monthlyRate:rate,installmentCount:n,startDate:start,installments:{create:amounts.map((amount,i)=>({number:i+1,amount,dueDate:addMonth(start,i)}))}},include:contractInclude});res.status(201).json(result)}));
app.get('/api/contracts/:id',auth,current,admin,wrap(async(req,res)=>{const c=await db.contract.findUnique({where:{id:req.params.id},include:contractInclude});if(!c)return res.status(404).json({error:'Contrato não encontrado'});res.json(c)}));
app.patch('/api/contracts/:id',auth,current,admin,wrap(async(req,res)=>{
 const c=await db.contract.findUnique({where:{id:req.params.id},include:{installments:true}});
 if(!c)return res.status(404).json({error:'Contrato não encontrado'});
 if(c.installments.some(i=>i.status!=='OPEN'))return res.status(409).json({error:'Contrato com movimentações: edição financeira bloqueada para preservar pagamentos'});
 const b=req.body,n=Number(b.installmentCount),price=cents(b.propertyPrice),financed=cents(b.financedAmount),rate=Number(b.monthlyRate||0),type=txt(b.interestType)||'NONE';
 const start=new Date(String(b.startDate).slice(0,10)+'T12:00:00Z');
 if(!price||financed>price||!Number.isInteger(n)||n<1||n>600||!['NONE','SIMPLE','PRICE'].includes(type)||!Number.isFinite(rate)||rate<0||rate>100||Number.isNaN(start.getTime()))return res.status(400).json({error:'Dados do contrato inválidos'});
 if(c.installments.some(i=>i.status!=='OPEN'||i.receipts?.length))return res.status(409).json({error:'Contrato já movimentado'});
 const receiptCount=await db.receipt.count({where:{installment:{contractId:c.id}}});const paymentCount=await db.pixPayment.count({where:{installment:{contractId:c.id}}});
 if(receiptCount||paymentCount)return res.status(409).json({error:'Contrato possui comprovantes ou cobranças Pix: edição bloqueada'});
 const amounts=schedule(financed,n,type,rate);
 await db.$transaction(async tx=>{await tx.installment.deleteMany({where:{contractId:c.id}});await tx.contract.update({where:{id:c.id},data:{propertyPrice:price,financedAmount:financed,downPayment:price-financed,interestType:type,monthlyRate:rate,installmentCount:n,startDate:start,installments:{create:amounts.map((amount,i)=>({number:i+1,amount,dueDate:addMonth(start,i)}))}}})});res.json({ok:true});
}));
app.delete('/api/contracts/:id',auth,current,admin,wrap(async(req,res)=>{
 const c=await db.contract.findUnique({where:{id:req.params.id},include:{installments:true}});
 if(!c)return res.status(404).json({error:'Contrato não encontrado'});
 if(c.installments.some(i=>i.status!=='OPEN')||await db.receipt.count({where:{installment:{contractId:c.id}}})||await db.pixPayment.count({where:{installment:{contractId:c.id}}}))return res.status(409).json({error:'Contrato movimentado: exclusão bloqueada para preservar registros financeiros'});
 await db.$transaction(async tx=>{await tx.installment.deleteMany({where:{contractId:c.id}});await tx.contract.delete({where:{id:c.id}})});res.json({ok:true});
}));
const uploadDir=process.env.UPLOAD_DIR||path.resolve('private-uploads');fs.mkdirSync(uploadDir,{recursive:true});const upload=multer({storage:multer.diskStorage({destination:uploadDir,filename:(_req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:8*1024*1024},fileFilter:(_req,file,cb)=>cb(null,['application/pdf','image/jpeg','image/png','image/webp'].includes(file.mimetype))});
app.post('/api/installments/:id/receipts',auth,current,upload.single('file'),wrap(async(req,res)=>{if(!req.file)return res.status(400).json({error:'Envie PDF ou imagem até 8 MB'});const installment=await db.installment.findUnique({where:{id:req.params.id},include:{contract:{include:{client:true}}}});if(!installment||(req.auth.role==='CLIENT'&&installment.contract.client.userId!==req.auth.id)){fs.unlinkSync(req.file.path);return res.status(403).json({error:'Acesso negado'})}if(installment.status==='PAID')return res.status(409).json({error:'Parcela já quitada'});const receipt=await db.receipt.create({data:{installmentId:installment.id,fileName:req.file.filename,originalName:req.file.originalname,mimeType:req.file.mimetype}});if(installment.status!=='PAID')await db.installment.update({where:{id:installment.id},data:{status:'PENDING_REVIEW'}});res.status(201).json(receipt)}));

// Pix Nubank: QR estatico de pagamento. Nao confirma automaticamente recebimento.
// A conciliacao automatica depende de API/webhook oficial de um provedor habilitado.
import QRCode from 'qrcode';
const emv=(id,value)=>id+String(Buffer.byteLength(value,'utf8')).padStart(2,'0')+value;
function pixPayload(key,name,city,amount,reference){
  const merchant=emv('00','br.gov.bcb.pix')+emv('01',key);
  const body=emv('00','01')+emv('26',merchant)+emv('52','0000')+emv('53','986')+emv('54',(amount/100).toFixed(2))+emv('58','BR')+emv('59',name.slice(0,25))+emv('60',city.slice(0,15))+emv('62',emv('05',reference.slice(0,25)))+'6304';
  let crc=0xffff;for(const byte of Buffer.from(body,'utf8')){crc^=byte<<8;for(let i=0;i<8;i++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff}
  return body+crc.toString(16).toUpperCase().padStart(4,'0');
}
// Cobranças dinâmicas Mercado Pago: nenhum pagamento é considerado quitado sem consulta à API.
const mpToken=()=>txt(process.env.MERCADOPAGO_ACCESS_TOKEN);
async function mpCall(route,opts={}){
 if(!mpToken())throw Object.assign(Error('Integração Pix indisponível. Contate o administrador.'),{status:503});
 let response;
 try{response=await fetch('https://api.mercadopago.com'+route,{...opts,headers:{Authorization:'Bearer '+mpToken(),'Content-Type':'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(15000)})}
 catch{throw Object.assign(Error('Não foi possível consultar o Mercado Pago. Tente novamente em instantes; não pague outra cobrança se já efetuou o pagamento.'),{status:502})}
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  console.error('Mercado Pago falhou',{status:response.status,requestId:response.headers.get('x-request-id')});
  throw Object.assign(Error(response.status===401||response.status===403?'Integração Pix indisponível. Contate o administrador.':'Não foi possível processar o Pix no Mercado Pago. Verifique seu e-mail no perfil e tente novamente em instantes.'),{status:502});
 }
 return data;
}
const allowedPayment=async(id,userId)=>{
 const i=await db.installment.findUnique({where:{id},include:{contract:{include:{client:{include:{user:true}}}}}});
 if(!i||i.contract.client.userId!==userId)throw Object.assign(Error('Parcela não encontrada'),{status:404});return i;
};
app.post('/api/my/installments/:id/pix',auth,current,wrap(async(req,res)=>{
 if(req.auth.role!=='CLIENT')return res.status(403).json({error:'Somente clientes'});
 let i=await allowedPayment(req.params.id,req.auth.id);
 if(i.status!=='PAID')i={...i,...await reconciliarParcela(db,mpCall,i.id)};
 if(i.status==='PAID')return res.json({installmentStatus:'PAID',status:'approved',amount:i.amount});
 if(process.env.MP_PAYMENTS_ENABLED!=='true')return res.status(503).json({error:'Pix automático em preparação. Pagamentos reais ainda não habilitados.'});
 if(i.amount<=0)return res.status(400).json({error:'Parcela sem valor para cobrança'});
 // Serializa a reserva por parcela; chamadas concorrentes usam a mesma chave.
 let p=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${i.id}))::text`;
  const parcela=await tx.installment.findUnique({where:{id:i.id}});
  if(parcela.status==='PAID')return null;
  const existente=await tx.pixPayment.findFirst({where:{installmentId:i.id,status:{in:['CREATED','pending','in_process']}},orderBy:{createdAt:'desc'}});
  return existente||tx.pixPayment.create({data:{installmentId:i.id,amount:i.amount,idempotencyKey:crypto.randomUUID()}});
 });
 if(!p)return res.json({installmentStatus:'PAID',status:'approved',amount:i.amount});
 if(!p.providerId){
  const email=txt(i.contract.client.email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Cadastre um e-mail válido no perfil antes de pagar'});
  const payment=await mpCall('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':p.idempotencyKey},body:JSON.stringify({transaction_amount:i.amount/100,description:`ALP Imobiliária - parcela ${i.number}/${i.contract.installmentCount}`,payment_method_id:'pix',payer:{email},external_reference:i.id,notification_url:process.env.MP_WEBHOOK_URL||undefined})});
  if(!/^\d+$/.test(String(payment.id)))throw Object.assign(Error('Mercado Pago não retornou uma cobrança válida. Tente novamente.'),{status:502});
  const tx=payment.point_of_interaction?.transaction_data||{};
  p=await db.pixPayment.update({where:{id:p.id},data:{providerId:String(payment.id),qrCode:tx.qr_code||null,qrBase64:tx.qr_code_base64||null}});
  await db.$transaction(tx=>confirmarPagamentoPix(tx,payment,p));
  p=await db.pixPayment.findUnique({where:{id:p.id}});
 }
 if(p.status==='approved')return res.json({installmentStatus:'PAID',status:'approved',amount:i.amount});
 if(!['pending','in_process'].includes(p.status)||!p.qrCode)return res.status(409).json({error:'Cobrança Pix indisponível. Tente novamente para consultar ou gerar uma nova cobrança.'});
 res.json({paymentId:p.providerId,payload:p.qrCode,qrCode:p.qrBase64?`data:image/png;base64,${p.qrBase64}`:await QRCode.toDataURL(p.qrCode),amount:i.amount,status:p.status,automaticConfirmation:true,notice:'Aguardando confirmação do Mercado Pago. Não pague a mesma cobrança duas vezes.'});
}));
app.get('/api/my/installments/:id/payment-status',auth,current,wrap(async(req,res)=>{
 if(req.auth.role!=='CLIENT')return res.status(403).json({error:'Somente clientes'});
 let i=await allowedPayment(req.params.id,req.auth.id);
 if(i.status!=='PAID')i=await reconciliarParcela(db,mpCall,i.id);
 const p=await db.pixPayment.findFirst({where:{installmentId:i.id},orderBy:{createdAt:'desc'}});
 res.setHeader('Cache-Control','no-store');
 res.json({installmentStatus:i.status,paymentStatus:p?.status||null});
}));
app.post('/api/webhooks/mercadopago',wrap(async(req,res)=>{
 const id=String(req.query['data.id']||req.body?.data?.id||'');
 const type=String(req.query.type||req.body?.type||'');
 if(type!=='payment'||!/^\d+$/.test(id))return res.sendStatus(200);
 if(!validMpSignature(req,id,txt(process.env.MP_WEBHOOK_SECRET))){
  console.warn('Webhook Pix rejeitado: assinatura inválida ou expirada');
  return res.sendStatus(401);
 }
 const p=await db.pixPayment.findUnique({where:{providerId:id}});
 // A notificação pode chegar antes de salvarmos providerId. Solicita nova tentativa.
 if(!p)return res.status(503).json({error:'Cobrança ainda não localizada; tente reenviar a notificação'});
 await reconciliarCobranca(db,mpCall,p);
 res.sendStatus(200);
}));

app.get('/api/my/contracts',auth,current,wrap(async(req,res)=>{if(req.auth.role==='ADMIN')return res.json([]);res.json(await db.contract.findMany({where:{client:{userId:req.auth.id}},include:{property:true,installments:{orderBy:{number:'asc'},include:{receipts:true}}}}))}));
app.get('/api/receipts',auth,current,admin,wrap(async(_req,res)=>{
  const records=await db.receipt.findMany({
    include:{installment:{include:{contract:{include:{client:{include:{user:{select:{name:true}}}},property:true}}}}},
    orderBy:{createdAt:'desc'}
  });
  res.json(records);
}));

const ALP_RECEIPT_LOGO_BASE64='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCADcAUoDASIAAhEBAxEB/8QAHAABAQACAwEBAAAAAAAAAAAAAQACBQQGBwgD/8QASxAAAQMDAgQDAwgGBQkJAAAAAQACAwQFEQYhBxIxQRNRYQgUcSIyQoGRobHRFSMkUpSyFmJygsElM1Vjc5Ki0uI1Q0ZTZIOz4fD/xAAaAQEBAAMBAQAAAAAAAAAAAAAAAQIEBQMG/8QANBEAAgEDAgQEAwcEAwAAAAAAAAECAwQRBRITITFRIkFhcSORwQYUNIGh0fAWM1KxQlPh/9oADAMBAAIRAxEAPwD59+CUAJW+a4JHRSUBBKgrugIJKglAGEhOFYVBDZJQpCCFYVhKAgEhKsICAVhKVQSlJQABlKlFACUZVlAKkZUgJSUd0AAKwsiFiUAKIUEoDEhSiUKAFbpKEAd1FQCShTAoWRQUBhhGVkVioBCkDoskBJAQE4QCFYyoKVBY8lkgBIQCpBUEAqUEoQkoAWQ2QEnKApUCkISEAhRUpAQUUFdq0JoW76yq+S3xiGjYcS1koIjZ6D953oPuXnVqwpRc5vCMoQc3iKOt0dLPXVcVLRwyT1MruWOKNpc5x8gAuVqGzVun7tNbbpGIq2ENMkYOeUuaHYz54IX2Bw60JZNGUoFBCJq9wxLWzAGR/oP3R6D68r5p475HFrUHXBfGd/8AZMWhbagrmq4w6YPepbunHL6nRQlASumaxKUUBAZIUpAWFiVkhABCFkgqAxIR3WSEAIKUFAYlCyKxKFArHCSsVAKUKQCshusQskBJCEhUCnCMpygBIQkFAIShKEFSh0SqASFKCAUhCMoBKyja6R7WRtc97jyta0ZJPkAttpfTlz1NXiltUBeR/nJXbRxDzc7t8Oq+keG/D2z6TbHUua2tu+N6qRuzD5Rt+j8eq5t9qdK0WHzl2/fsbNC1nW5rodE4b8FZ6wRXHV4fTwbOZbwcSPH+sP0R6Df4L3FsFHZ7cGQsgo6CmZs0YYyNo+4LU6319YtGUPi3iqaalzS6KlYcyyfV2HqV4lUO1nxhqBPVF9l0pzZZG0H9aP6o+mfU7fgvmridW9+LWltgvl+S82dSlGNHwwWWbHiPx2LHS2vRWHnBa+4uHT/Zg/zH6h3XjcVNdLu+Sr8GtrpHuzJMGOkJd6nfdbLidY6LTeqTbbbEY4IaeLqclxIJLifMr1T2cpS7SNywSP249P7DV1VVpadaKvRjnOOvXmavDlc13Tm8YPIBZLr/AKMr/wCHf+SjZbt2tdf/AAz/AMl9fQSO83fauZCXOPUrS/qef/Wvn/4e70lL/l+h8amyXUDJtlcB607/AMlwpIpIn8sjHMcPouGD9i+6qcO2yT9qrnYLXfKV1PeLfTVkThgiWMEj4HqPqK3LfXXUfjhy9Ga1WxUOkj4SKQvZeMHCF2moZbxp4yT2lu80LzzSU/rn6TfXqO+eq8Z6LvUq0K0d0GaEoODwxUrKivUxBYndZIKAxUlRUAFBwkhGUBiQsSsysChQIWOAsisVAQT2WISgMuylBRQCpCVQISgJQEnCFkNwhCSArooFAISgJVBKypYuOAgHK9S4X8KKrVMcF0u73Ullcct5T+tnAP0f3R6n6l0/htpabWWq6e3tDm0Uf62rlH0Ix2z5noPj6L7KpIYaWmip6aNscETAxjGjAa0DAAXC1bUnQ+FSfifX0N+0tlPxy6HSaa3Uemon0FHFFTUkGT8nYY/ece5x3K8u4gcamUIkt+kCyoqvmvrnDMcf9gfSPqdvitp7UUdX7rbnUVe5kL2uFVRxnBe0EcsjsdW5PLg+nqvnRsQa3oufpumQr/HqvPPp+5t3V46fw4LH88jd6RlmvvEaxm8SOrpKu4QiY1B5/EBeMg56j0X3NFbmMaGMY1rGjAa0YAHkAvhvhuAOJWmM9rjAf+ML7xNQA5XWIQVSKfRI87OctraPj/2iY/D4pV8Y6Cng/kXn1Ber1a4HU9rulZRwOdzlkEhYC7zOF6R7ROJOK1e7saeD+RebeHldy1pQqW0IyWVhGlVnKNWTTwzmf0v1UP8AxBdP4h35pGs9Vt6ahuv8S/8ANcLwggxDyWf3Gj/gvkjH7xU/yZu7XxK1fbapk7b7cJC055ZJnOB+IOR9y+leCvF+PWX+TLyyKnuwBMbmbNmAG4I7Oxvtsd+nRfJE0I8lz9F18tp1XbamBzmvbOwjl7nmGFp3dlBQcoLDR70azlJRkz70uE0ckUkczWPie0te1wyHA7EFfGPEiwt03q+uoIcml5vFpz/q3bgfVuPqX0vctQMLiA4Yz0Xh3HGVlVX2mrb898ckTj5hpaR/MVxtEu5u52eUl/o3r62UaO7zR5mElYpBX2Rwy7IylGEBFCipASxKVEKAx6IKUIUxKElYqAMpQlASQpKAQEhAUqBSFAKQCkLBZhCCFKzhSoEKJUEFAS/GVxJDWgucTgADJJ8lk52AvSOB+lhc70b7XR5o6F36hrhtJN5/BvX44Wrd3Mbak6kvI9aFJ1pqCPZeD2k26R0uxk7Gi51mJqp3cHHyWf3QftJXdbhc6e22+orayQR09OwyPcT0AWvjqB5rw/2hNZNkpxYaWRxAdmXlOznDz9B+PwXwtJVL2459W+Z9DNRoU/RGymkl1Reqq4XNhfHUAxmHs2IjHIPq+/deOassstgvdTb5cubGeaN5GPEjO7XfZ9+V6nwSvLL7QOoat7BXUgGB0L4+x+IW844aPfcdLsvNHGXVNsB8QNG7oCd/907/AALl1NOuZWl07er0fL8/I17ynGvRVSHkeHcPjy8Q9OO8q+E/8QX2e6v3OCvizQ7uXXVhce1ZGdvivqGW6eZ+xY/aBvjRx2+pNMjmm/c8T47SeLxIq39c08P8q6GOi7hxel8fW0sh708X4FdLfIGDJX0mn/hafsjlXS+NL3P06IK9s0Jw705e9IW25Vra11TUMLnlk/K35xGwx6LdnhRpXO0dw/if+lak9ctYScXnl6HtHTq0kmsHzrKPkrtnCrTE931BHcZYj7hRO5y9w2e8dGjz33K9poOFOk4ZBI+jqKjH0J6hxb9gwu3R22mpKVlPRwRwU8YwyKNoa1o9AFytQ1+nUpunQTy/Nm7a6bKM1Kr5HTKmmdnO+V49xLrxUX9lIx5c2jj5Xej3HJ+7lH1L1fiVqej0rQOaHskukzf1EAOSP6zvID7189NfJPK+ad5fLI4ve49STuSp9nrWUpO4kuS6Geq3C28KPXzP0CVKX15wSQSlRQAUJKxQEgpJQoAKxSUIUChRKMqAAlAUgMkoCUBDZKlBUCEoSgFQUlCEpRUqDJYOKSvykdgFTIORbKCe73Wmt9IMzTv5QT0aO7j6AZK+ndP0lNZbTS26hHLBAzlHm493H1JyV5fwtsX6PoDdaln7VVt/VgjdkX5u6/DC7+a3wmFziA1oySewXxWtXjuKvCg/DH9WfRadbcKG+XV/6Obq7UbLFY5ql0gbKWkR98Hu76vxIHdfLtzqJbnXS1MuS952Gc4HYLtvEnUz71cjTxO/Z4vL7h/ifU+i7JwW0YK6qZfrpF+yQuzSRu/7x4+mR5Dt5n4LesqcNNtXc1ur/iRq3MpXdZUafRHl+m7vU6bv9JdKJxEtO8OLezm92n0I2X3JpKvtuqdL09xpAySgrIiHxu3xkYcx3w3C+aeOOhP0fK7UVqia2gqH4qomDAhkP0gP3XH7D8Qvx9nvXz9N3mWw18vLa7k7MbnHaKfoD6B3Q+uFleQp3lFXdLm0v4vyMKTnRm6EzV3nSsmkOMdJa4w40oq2y0rz9KInLfrG4PqF6w4PHXJK63xKqhV8U9KF5y5spaN/6wXdjAMdN1yL+4lXjSqS64+rOlaUlSc4rv8AQ8M4nE/0tfzf+RH+BXTap3yCu8cWI+TWMg/9PH+BXR6luWlfXWP4Wn7I4N1/fl7n0hwrrRHw+srXHpEf5itjqvWtJpe1e/1dPNUR+I2PlhxnJzvv8F0HQ11paXSNqhmraWOQRY5HTNBHyj1GdlruJlfTV+mZIIauCZ7Z43crJQ49+wK+QVvxbtwkuTl9TvOpst9yfNL6HYjx8szG5is1xe7yc9jfvyV1rUXHG+XGN0NloYLY123jOPiyD4ZAA+xeWspwOy5EcIC+ipaHaQe7bn3OPPUa0ljJPkqKyqkqq2eSoqZTzPlkcXOcfUlfuxuEtaAFnhdqMVFYRottvLLshPTqhZEJSsoQEViklCgJYpQgIrEpQhTE9ELIrHKgAKwgLIIBShKAQpSEBllIWKQqDLZKxTlCErKsrElATnLeaF0+7UV+ZHI0+5U+Jag9iM7N+J/DK69K7DSvRtGa30xpmyspAa59U889Q8QbOf6b9B0C52pVasKLVFNyfby9TbtIQlUTqPCR6iYWtGGgNA2AHQLpHEe+i1UJpoQDUSDG/byH+J+rzWM3FfT5Y7wo650uDygwgAntk56Lyq/Xee73CSqqHEgk8ufx/wD3oOy+e07TKk6u6tHCXc693ewjTxTeWzdaB0xLqi8csviCghIfUyjv/VB8z/8Aa+kbe2Kmhihp42xQxtDGMbsGgdAF4Fp/iZSaftcNBQ2J5jZu97qkB0jz1cfkrZt42vadrCP4r/pV1S2vb2plQ8K6LK+fUws6ttbw5y5vryZ9DMpqa4Uc1LXwsqKadhjkieNntPUFfKPFbRNTozUb6cc5t82ZaKfu5mehP7zeh+o913em4/zQY5dOMd8as/8AKuBrni9T6205JarjppkTsh8NQ2qy6F4+kPk9OxHcLLSLa9tJ7Zw8D6818+p531ahWWYy5r3NDa9RP1Dq7Rr6jetp5hFO7945GHfWPvyvfwMuwF8raeq4rVqG310weYaedsr+QZcQDvj1Xrw4yWIHahuWP7LP+ZXVLCpujGjFtJfVszsrqO2TqPm/2PQa3RlgvlYKm60HjVJaGeIJXs2HTYHHdcyn4OaLqQPFt0392qkH+K89p+OFihx/ky5HHoz81t6X2ibDT4zZro7HkY/zWrTp6jHEVuSXqZVJWssvlk7s/gLoEsLv0XUknv73J+a0tx4Q6Lt7D4FrkOPOqk/HK4DvaYsHh8osV1z/AG4/zWpr+P8AZK3LWWe5sz3JZ+a9a8NR5cPd8zyoyt8+PB5brfTr9OX6Wl3NM/8AW07z9KM9PrG4PqFoQu9611jY9TWsRx0laytifzwSvDcNz85p36EfeAuiL6ixqValFOtHEvP9zl3MIQqNU3lGQSFiE5W4a4lCsoQooyjKMoBQpSgJYlOUFAYnqpKChQKxwnKMqAxSCgDZI6IBSEBIQDlKAE9VQSVKQGXRGViSspI5GMY58b2teOZhc0gOGcZHmMgj6kAZQViv1hhmnfyQRSSvxnlY0uOPgEBx3tyuO6AErZTUdTCznnpp4mZxzPjc0Z+JC/DCxayDjRwBvZfoY8rlQU00/N7vBLLy/O8Nhdj44X6SUFZG3mkpKljPN0TgPtwphFNcYQeyx8AeS5S/aClqKgONPTzShuxMcZdj7Ewhk4DacZ6L9WxAdAuVNTzU5AqIZIidwJGFpP2r8+yqRDjPizsV+Xu4z0XOIRyo4jJwTTjyT7uPJcwtWw/QdzFpddHW+rbbWlrTVOicI8nYDmOxz6KbUXLNH7sPJfoynAPRcnC/QxPa1jixwa/5pLTh3w802oZMGN5Rsv0C5tfZbnb6Knq6+31VLTVBLYZJoiwSEYzy569QuG5j2NaXMc0OGWkjGR5hZJ9iYIFSomPleGRMe956NaCT9gWGd1SGROygscrJzXtDS9rmhwy0kYyPMIC7oQlUErPkrCFASCkoQFhCchYlCgeix2WR6LHKgBIQClAKVKQGQVhASqCUTsrKCdkBzrHbprxeKO3U20tTIIw49Gju4+gGSfQL2jX1BaNX8FLVf9MweGNOSPoZGZy4wB2OY+pyx/8AfcvOdJSU1g01cdQ3ClkqTVl1qo4mS+C88zczSNfg4w0hvT6ZXeuAWp7G68V+k47VUUtHe4XNcJ6zx2veGkcoHI3BLS7f0C1ak3ncvL+M9YRWMPzPFFs9K1lTRaotM1HPLBKKuIc8bi04LxkbLk6m01WWPV9Zp8xvmq4ajwYmsGTKCfkEDvzAg/Wvybaq+x6vt9DdqSejrI6qAuhmbyuAL2kH4L2k04mCTyeo+1bV1D+JENMaiU0rKGJzYS88gJc/Jx0yvF1617Tz+fiWwuO/uEXX+09eeQ6cuc9Pa309LJLLdJHspKdjSZJQ3ALgP3cnAPofJYUmlBFmvEzfcEayopuK+m2088sTJaoMkaxxAe0g5BHcLtPEXV+prLx5uQtF0rXRiuijZRmVz4nhzWAs5Dtg58u66pw1oay18YLBRXCmlpqyCua2SGRvK9hweoXYeKesbrY+Kt8dbILZFVRTNEdY6ijdOzMbd+cg779eq8586mF2Mo8o59TP2lrVarVxCjFnhipzU0jZ6mGJoa1shc4ZwOmQAfv7rhezhWVEHF2zxRzysglbMJY2vIa8CJxGR33AXnlwrqu51s1bcqmWqq5nc0k0ruZzj6ru3AJxbxbspb1Am/8Aics5JxpYfYieZ8h15QXjVHFzUVDQx1Fwq/f5mRRc+S1gdgAZOAAMKpOE2sauSsihtjPHpXOa6J1RG17y3Y8jScuGdsjb1XOo3lvtKNec836eeR/vFbO0VEzfaplmfI8vNymZ84n5Phu+T8PRY8SUVhdsmWxPm+51Sz8M9WXa3y1dFanERtLvBfKxkzgOpEZPMfs37Lr1lstxvVyFBa6SSoqyCSwbcgHznOJ2aB3JwAvS+H1TM32nKuV0khc+urWu+UflDD8A+mw+xbDRMbKjTvGGKiAF2eZmtDfn+DzPJA9Dg/cnGkuvp+pOGmeaXDR93prPNdYmUtbbYHck9RQ1LKhsLvJ/KSW/E7eq9J05SXK/ezXU0FGJ6yo/TTWxML9mMHKepOGtHXsAtX7NtRHT3HVba3BtDrS91UH/AObwDtn6i5flQucfZjubA5wjdemjGeo+TsVJzbeOzRYxWM+h1bVmhNRaVpaaqvFCGUdRtHUwytliJ8uZpIBW51vPq9nDrTFHqC3U1FZ6R7mUMreUSzHlzk4J2x3wMlbXR1e8eztrCluj3uom1TI6IPOQJTynDfgd9vVflrd+eAOgGjtUT/i5OI20n3JtSTwc/izUz1vCHhi+olknqJIJQ5z3FznHDQMkrQ8SZ9WnS+lKfVlupaCjpoHxUHhhoklaA3LnYJxty+XcrncTnOdwd4bN7Ngl/Bq/big2Wp4c8LaaAF0r6R0cfmXHwwB9qkJY2+7LJdfyPw0DZ9U2R1WLNb6aPUtwpP2MVFXEypigcCXvihcebmcAME4wM4ByumWDS171BeJLZaqCaor2OIkiJDSwg4PNzEYwc5XqVBSyWvjrpyDU9wrbxqvmiMssQbDTwN5Dyt6Zkw3y5R8VrtIPI9qCZzQf+06vb6nqqq1l+mQ4dEdPufDzU1u0/Neau3GOgjn93L3SNyXc3ICG5yWl2wPf4LacTajVsli0pDq220lBT09K6Gh8IND5GDlBc7BONuXy7nC61ru4V0+qtSRTVtS+nmuErpIXSuLXFr3BpLemw2Hku+8Uop63RnCqlpWnx5KDw4t8ZcTGAPtwstzzFyMcLDwdVt/DzUdfNHTQUtO2vlh94ioZaqOOpkjxkOERPN03811SaKSCZ8UzHRyxuLHscMFpBwQR5r223U77bx+scGpLhW3rVnPGZ54Wtgp4R4RwAMZkw3v8kfFeX8RHA8QNSEf6Rn2/9wrKnUcnhklBJZNDlRCxyor3PMUFKChQwhOUIDFyFkVgoCCUBKAUoSgIJCEhASxd6LNYlUG5uerLvc7LT2isdSOt1NkwRMpI2eET1LSACCe++/dcGw3mv09cWV9pdFFWR7xyvhbIYz5t5gcHfquJhWFhsWMF3POTeXfWmoLvd6O7XCrjfdKRzXw1TIGMeOU5bkgDIHkcrG46yvlx1MNQV1RDUXVoaGSSQMc1nL83lYRgY+C0oAUWqcOPYu5nbKzifq2vkZJXVdHUyMGGvmt8DyB5AlhXEq9eamq9QW29z3HNztzeSmlETGiNu/yeUDGNz2XXeVOFFSivIb5dzeM1pf2anm1CKqJ95ldzGpkgY8sOMfIBGG7bbdlx9QaguWpK3329SQzVhADp2wMje/AwOYtAzgDutZypAWSppPOCbm+QYWz05qS66XrnVljlhgqyC0TOgZI9oPUAuBxn0WuIWPKrKKksMieOhuhrG9/0jF/8Sl/TIJd7z7pHnm/exjHN64ymLWd9i1I/UEc1M28vzmq91j5skYLsYxzEbZxlaTlTyrHhx7GW5m6o9Z32j1FNfqWamivE2S+pFLHzZOeYgYwCc7kDJX4U2qL1RaiffaGr91uchJlkgjaxsmTl3M0DlOT1GFrOVXKnDj2G5m4uOrbtcKCehzSUVFUOD6iChpWU7Z3DoX8oHN8OnoqyavvlktsltoqmJ1rkLnSUVRAyWGQnGS5rgcnYb+i0/KrlThxxjA3M2F51Bc7vT01PWSxtoqbJhpKeJsUMZPUhjQBk+Z3XJuOsL1cbHT2askpX2umOYKcUsbREfNpAyO+fPK0/KrlV4a7E3M3F31he7xaaS2XKWlmoKPHu0IpY2iHHZpABA2wfNV51jfbzbaOhuE8D6aix7qGU0cZgxjHIWgEdB9i03KgtU4cexdzO21nFDWNZLRzS3NgqKXl5Z46aNsjw05Ae8DLhnqM4PcLjnX+pDqV9/bU0zbs4crZxSRfIB68o5cAnJyep811oBPKipR7De+5ybrc6q63KW4V3gvq5Xc8jmRNYHuzkktAAye62N81lfb5b6GjuNRA+Cgx7p4dPHG6DGMBhaAQNh9i02FcoV2Im5nbK3ihrCsqKSolucbaqmLeWoip42SvDTkB7wMuHodj5LSaiv9x1JdJLhd5Y5Kp/UxxNjH2NAH19VrS1QGEjTjHmkHJvqKlFWVmQc7LElSkBiSoqQVAR6IypGEBBKxCyygJZLEK7oDJKEoCUpSoEKUpAQSpSAsKIUooCUpSAVKShAKkoQpJUEIQQpCUAKKlICSgJQBhQVlWUKSkKQEVKUdkBKRlSAihKCgBSkIAKElY5CgFSFZQCFkgJQEkFGEoBUgKQDlOUBSoMlISgLKlK6oCCUZwrKAVIykFAKkKQhZUpKFBQUVIQklY5SgJSso7oUUFWVEoCUpCAUFSsoCVhSCUBIKcoQEsSlSgBY4SUYKAlKSFAQSgKVBkpCcoBQeqlIBUFZSqCUVEqBQChSsoBVlWd1ICSEJQErKMqygHKCVZSUAZShWUAqKFICUpSAUKQgFSFICypXRRQFlClIAQssoKgBSkFARKMqPRY5QECssrEJUA5SsQlUCEkoKEBkErEJ7IBUDhAUEAqQrugMlAoUqBTlASUBZUgKQElCkA53VlAUeqAQVIKEBkrqoIKAVLFZdkBKQrugJWVIKAspKFKAiVI7pQArKldkBEoKkFABWKSscqA/9k=';

// Recibo de pagamento no modelo oficial apresentado pelo cliente.
app.get('/api/installments/:id/receipt-pdf',auth,current,wrap(async(req,res)=>{
  const installment=await db.installment.findUnique({where:{id:req.params.id},include:{
    contract:{include:{client:{include:{user:{select:{id:true,name:true,cpf:true}}}},property:true}},
    receipts:{where:{status:'APPROVED'},orderBy:{reviewedAt:'desc'},take:1},
    payments:{where:{status:'approved'},orderBy:{paidAt:'desc'},take:1}
  }});
  if(!installment)return res.status(404).json({error:'Parcela não encontrada'});
  if(req.auth.role!=='ADMIN'&&installment.contract.client.userId!==req.auth.id)return res.status(403).json({error:'Acesso negado'});
  if(installment.status!=='PAID')return res.status(409).json({error:'O comprovante estará disponível após a confirmação do pagamento'});
  const contract=installment.contract,payment=installment.payments[0],receipt=installment.receipts[0];
  const paidAt=payment?.paidAt||receipt?.reviewedAt||null;
  const money=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const dt=d=>d?new Date(d).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'Não informada';
  const pdf=new PDFDocument({size:'A4',margin:0,info:{Title:'Comprovante de Pagamento - A.L.P Imobiliária',Author:'A.L.P Imobiliária'}});
  res.status(200).type('application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="recibo-alp-parcela-${installment.number}.pdf"`);
  pdf.on('error',e=>{console.error('Erro ao gerar comprovante:',e);res.destroy(e)});
  pdf.pipe(res);
  const navy='#162641',gray='#64748B',rule='#D9DFE8',gold='#C18B3E';
  const label=(t,x,y)=>pdf.fillColor(gray).font('Helvetica').fontSize(8).text(t,x,y,{width:230});
  const value=(t,x,y,w=230)=>pdf.fillColor(navy).font('Helvetica-Bold').fontSize(10).text(String(t||'Não informado'),x,y,{width:w,height:34,ellipsis:true});
  const pair=(left,right,y)=>{label(left[0],48,y);value(left[1],48,y+17,245);label(right[0],320,y);value(right[1],320,y+17,228)};
  pdf.fillColor(navy).font('Helvetica-Bold').fontSize(20).text('Comprovante de Pagamento',48,62,{width:380});
  pdf.fillColor(gray).font('Helvetica').fontSize(9).text('Emitido em '+dt(new Date()),48,92);
  pdf.image(Buffer.from(ALP_RECEIPT_LOGO_BASE64,'base64'),423,49,{fit:[113,78],align:'center',valign:'center'});
  pdf.moveTo(48,141).lineTo(547,141).strokeColor(rule).lineWidth(.8).stroke();
  pair(['Número do recibo',receipt?.id||payment?.id||installment.id],['Identificação da transação',payment?.providerId||'Não informada'],163);
  pair(['Nome do cliente',contract.client.user.name],['CPF do cliente',contract.client.user.cpf],222);
  pair(['Imóvel',contract.property.address||contract.property.reference],['Contrato',contract.id],281);
  pair(['Forma de pagamento',payment?'PIX':receipt?'Comprovante aprovado':'Pagamento registrado'],['Pago em',dt(paidAt)],340);
  pdf.fillColor(navy).font('Helvetica-Bold').fontSize(12).text('Detalhamento do pagamento',48,429);
  pdf.rect(48,454,499,30).fill(navy);
  pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
  pdf.text('Descrição',60,464);pdf.text('Vencimento',310,464);pdf.text('Valor',451,464,{width:83,align:'right'});
  pdf.fillColor(navy).font('Helvetica').fontSize(9);
  pdf.text(`Parcela ${installment.number}/${contract.installmentCount}`,60,499);
  pdf.text(dt(installment.dueDate),310,499);
  pdf.text(money(installment.amount),441,499,{width:93,align:'right'});
  pdf.moveTo(48,529).lineTo(547,529).strokeColor(rule).stroke();
  pdf.fillColor(gray).fontSize(9).text('Total recebido',345,552,{width:190,align:'right'});
  pdf.fillColor(navy).font('Helvetica-Bold').fontSize(19).text(money(installment.amount),345,572,{width:190,align:'right'});
  pdf.moveTo(150,690).lineTo(445,690).strokeColor(gold).lineWidth(.9).stroke();
  pdf.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('A.L.P Imobiliária',150,705,{width:295,align:'center'});
  pdf.fillColor(gray).font('Helvetica').fontSize(8).text('Comprovante referente ao pagamento identificado acima.',95,735,{width:405,align:'center'});
  pdf.end();
}));

app.get('/api/receipts/:id/file',auth,current,wrap(async(req,res)=>{const r=await db.receipt.findUnique({where:{id:req.params.id},include:{installment:{include:{contract:{include:{client:true}}}}}});if(!r||(req.auth.role==='CLIENT'&&r.installment.contract.client.userId!==req.auth.id))return res.status(403).json({error:'Acesso negado'});const file=path.join(uploadDir,path.basename(r.fileName));if(!fs.existsSync(file))return res.status(404).json({error:'Arquivo não disponível no armazenamento'});res.type(r.mimeType);res.setHeader('Content-Disposition',`inline; filename="${r.fileName}"`);res.sendFile(file)}));
app.patch('/api/receipts/:id',auth,current,admin,wrap(async(req,res)=>{const status=txt(req.body.status);if(!['APPROVED','REJECTED'].includes(status))return res.status(400).json({error:'Status inválido'});const previous=await db.receipt.findUnique({where:{id:req.params.id}});if(!previous)return res.status(404).json({error:'Comprovante não encontrado'});if(previous.status!=='PENDING')return res.status(409).json({error:'Comprovante já analisado'});const receipt=await db.receipt.update({where:{id:req.params.id},data:{status,note:optional(req.body.note),reviewedAt:new Date()}});await db.installment.update({where:{id:receipt.installmentId},data:{status:status==='APPROVED'?'PAID':'REJECTED'}});res.json(receipt)}));
app.delete('/api/receipts/:id',auth,current,admin,wrap(async(req,res)=>{
 const r=await db.receipt.findUnique({where:{id:req.params.id}});
 if(!r)return res.status(404).json({error:'Comprovante não encontrado'});
 if(r.status==='APPROVED')return res.status(409).json({error:'Comprovante aprovado não pode ser excluído; preserve o histórico financeiro'});
 await db.receipt.delete({where:{id:r.id}});
 const file=path.join(uploadDir,path.basename(r.fileName));if(fs.existsSync(file))fs.unlinkSync(file);
 const other=await db.receipt.count({where:{installmentId:r.installmentId,status:'PENDING'}});
 if(!other){const i=await db.installment.findUnique({where:{id:r.installmentId}});if(i.status==='PENDING_REVIEW')await db.installment.update({where:{id:i.id},data:{status:'OPEN'}})}
 res.json({ok:true});
}));
app.use((err,_req,res,_next)=>{console.error(err);if(err.code==='P2002')return res.status(409).json({error:'CPF ou valor único já cadastrado'});if(err.code==='P2025')return res.status(404).json({error:'Registro não encontrado'});res.status(err.status||400).json({error:err.message||'Erro ao processar solicitação'})});
// Recupera notificações perdidas mesmo quando o cliente fecha o modal.
let conciliandoPix=false;
async function conciliarPix(){
 if(conciliandoPix||!mpToken())return;
 conciliandoPix=true;
 try{await reconciliarPendentes(db,mpCall,id=>console.warn('Conciliação Pix pendente',{cobrancaId:id}))}
 catch{console.error('Falha no ciclo de conciliação Pix; nova tentativa no próximo ciclo')}
 finally{conciliandoPix=false}
}
const pixTimer=setInterval(conciliarPix,60000);pixTimer.unref();
app.listen(Number(process.env.PORT)||3001,()=>{console.log('API iniciada');void conciliarPix()});
