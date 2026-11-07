import 'dotenv/config';
import express from 'express';import cors from 'cors';import bcrypt from 'bcryptjs';import jwt from 'jsonwebtoken';import multer from 'multer';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {PrismaClient} from '@prisma/client';
const db=new PrismaClient(),app=express();app.disable('x-powered-by');app.use(express.json({limit:'100kb'}));
const origins=(process.env.CLIENT_ORIGIN||'http://localhost:5173').split(',').map(s=>s.trim());app.use(cors({origin:(origin,cb)=>cb(null,!origin||origins.includes(origin))}));
const secret=process.env.JWT_SECRET;if(!secret||secret.length<24)throw Error('JWT_SECRET deve ter ao menos 24 caracteres');
const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
const digits=v=>String(v||'').replace(/\D/g,'');const txt=v=>v==null?'':String(v).trim();const optional=v=>txt(v)||null;
const cents=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error('Valor monetário inválido (centavos).');return n};
const auth=(req,res,next)=>{try{const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');req.auth=jwt.verify(token,secret);next()}catch{res.status(401).json({error:'Sessão inválida ou expirada'})}};
const admin=(req,res,next)=>req.auth.role==='ADMIN'?next():res.status(403).json({error:'Acesso restrito'});
const current=wrap(async(req,res,next)=>{const u=await db.user.findUnique({where:{id:req.auth.id}});if(!u?.active)return res.status(401).json({error:'Conta inativa'});req.auth.role=u.role;req.auth.mustChangePassword=u.mustChangePassword;if(u.mustChangePassword&&!['/api/me','/api/me/password'].includes(req.path))return res.status(403).json({error:'Altere sua senha provisória antes de continuar'});next()});
app.get('/api/health',(_q,r)=>r.json({ok:true}));
app.post('/api/login',wrap(async(req,res)=>{const cpf=digits(req.body.cpf),user=await db.user.findUnique({where:{cpf}});if(!user?.active||!await bcrypt.compare(String(req.body.password||''),user.passwordHash))return res.status(401).json({error:'CPF ou senha inválidos'});const token=jwt.sign({id:user.id,role:user.role},secret,{expiresIn:'12h'});res.json({token,user:{id:user.id,name:user.name,role:user.role,mustChangePassword:user.mustChangePassword}})}));
app.get('/api/me',auth,current,wrap(async(req,res)=>{const u=await db.user.findUnique({where:{id:req.auth.id},select:{id:true,name:true,role:true,cpf:true,mustChangePassword:true}});res.json(u)}));
app.patch('/api/me/password',auth,current,wrap(async(req,res)=>{
 const old=String(req.body.currentPassword||''),password=String(req.body.newPassword||'');
 if(password.length<10||password===old)return res.status(400).json({error:'Nova senha deve ter ao menos 10 caracteres e ser diferente'});
 const u=await db.user.findUnique({where:{id:req.auth.id}});
 if(!await bcrypt.compare(old,u.passwordHash))return res.status(401).json({error:'Senha atual incorreta'});
 await db.user.update({where:{id:u.id},data:{passwordHash:await bcrypt.hash(password,12),mustChangePassword:false}});
 res.json({ok:true});
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
 if(!mpToken())throw Object.assign(Error('Configure MERCADOPAGO_ACCESS_TOKEN no Render'),{status:503});
 const response=await fetch('https://api.mercadopago.com'+route,{...opts,headers:{Authorization:'Bearer '+mpToken(),'Content-Type':'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(Error('Mercado Pago: '+(data.message||response.status)),{status:502});return data;
}
const allowedPayment=async(id,userId)=>{
 const i=await db.installment.findUnique({where:{id},include:{contract:{include:{client:{include:{user:true}}}}}});
 if(!i||i.contract.client.userId!==userId)throw Object.assign(Error('Parcela não encontrada'),{status:404});return i;
};
app.post('/api/my/installments/:id/pix',auth,current,wrap(async(req,res)=>{
 if(req.auth.role!=='CLIENT')return res.status(403).json({error:'Somente clientes'});
 if(process.env.MP_PAYMENTS_ENABLED!=='true')return res.status(503).json({error:'Pix automático em preparação. Pagamentos reais ainda não habilitados.'});
 const i=await allowedPayment(req.params.id,req.auth.id);
 if(i.status==='PAID')return res.status(409).json({error:'Parcela já paga'});
 if(i.amount<=0)return res.status(400).json({error:'Parcela sem valor para cobrança'});
 let p=await db.pixPayment.findFirst({where:{installmentId:i.id,status:{in:['CREATED','pending','in_process']}},orderBy:{createdAt:'desc'}});
 if(!p){p=await db.pixPayment.create({data:{installmentId:i.id,amount:i.amount,idempotencyKey:crypto.randomUUID()}})}
 if(!p.providerId){
  const email=txt(i.contract.client.email);if(!email)return res.status(400).json({error:'Cadastre seu e-mail no perfil antes de pagar'});
  const payment=await mpCall('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':p.idempotencyKey},body:JSON.stringify({transaction_amount:i.amount/100,description:`ALP Imobiliária - parcela ${i.number}/${i.contract.installmentCount}`,payment_method_id:'pix',payer:{email},external_reference:i.id,notification_url:process.env.MP_WEBHOOK_URL||undefined})});
  const tx=payment.point_of_interaction?.transaction_data||{};
  p=await db.pixPayment.update({where:{id:p.id},data:{providerId:String(payment.id),status:payment.status||'pending',qrCode:tx.qr_code||null,qrBase64:tx.qr_code_base64||null}});
 }
 res.json({paymentId:p.providerId,payload:p.qrCode,qrCode:p.qrBase64?`data:image/png;base64,${p.qrBase64}`:p.qrCode?await QRCode.toDataURL(p.qrCode):null,amount:i.amount,status:p.status,automaticConfirmation:true,notice:'Aguardando confirmação do Mercado Pago. Não pague a mesma cobrança duas vezes.'});
}));
// Status consultado pelo cliente para atualizar o modal sem atualizar toda a página.
app.get('/api/my/installments/:id/payment-status',auth,current,wrap(async(req,res)=>{
 if(req.auth.role!=='CLIENT')return res.status(403).json({error:'Somente clientes'});
 const i=await allowedPayment(req.params.id,req.auth.id);
 const p=await db.pixPayment.findFirst({where:{installmentId:i.id},orderBy:{createdAt:'desc'}});
 res.json({installmentStatus:i.status,paymentStatus:p?.status||null});
}));
// Verifica assinatura HMAC SHA256 e consulta o pagamento na API antes de dar baixa.
function validMpSignature(req,paymentId){
 const secret=txt(process.env.MP_WEBHOOK_SECRET),signature=String(req.get('x-signature')||''),requestId=String(req.get('x-request-id')||'');
 const ts=signature.match(/(?:^|,)\s*ts=([^,]+)/)?.[1],v1=signature.match(/(?:^|,)\s*v1=([a-f0-9]+)/i)?.[1];
 if(!secret||!ts||!v1||!requestId||!/^\d+$/.test(ts))return false;
 if(Math.abs(Date.now()-Number(ts))>10*60*1000)return false;
 const dataId=String(req.query['data.id']||paymentId).toLowerCase();
 const manifest=`id:${dataId};request-id:${requestId};ts:${ts};`;
 const digest=crypto.createHmac('sha256',secret).update(manifest).digest('hex');
 return v1.length===digest.length&&crypto.timingSafeEqual(Buffer.from(v1,'hex'),Buffer.from(digest,'hex'));
}
app.post('/api/webhooks/mercadopago',wrap(async(req,res)=>{
 const id=String(req.query['data.id']||req.body?.data?.id||'');
 const type=String(req.query.type||req.body?.type||'');
 if(type!=='payment'||!/^\d+$/.test(id))return res.sendStatus(200);
 if(!validMpSignature(req,id))return res.sendStatus(401);
 const payment=await mpCall('/v1/payments/'+encodeURIComponent(id));
 const p=await db.pixPayment.findUnique({where:{providerId:String(payment.id)}});
 if(!p||payment.payment_method_id!=='pix'||payment.external_reference!==p.installmentId||Math.round(Number(payment.transaction_amount)*100)!==p.amount)return res.sendStatus(200);
 await db.$transaction(async tx=>{
  await tx.pixPayment.update({where:{id:p.id},data:{status:payment.status||'unknown',paidAt:payment.status==='approved'?new Date(payment.date_approved||Date.now()):null}});
  if(payment.status==='approved')await tx.installment.update({where:{id:p.installmentId},data:{status:'PAID'}});
 });
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
app.listen(Number(process.env.PORT)||3001,()=>console.log('API iniciada'));
