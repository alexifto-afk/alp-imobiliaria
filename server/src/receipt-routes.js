import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const safe=row=>{const {fileData,...metadata}=row;return metadata};
const lock=(tx,id)=>tx.$queryRaw`SELECT "id" FROM "Installment" WHERE "id" = ${id} FOR UPDATE`;
export function receiptFile(buffer){
 if(!buffer?.length||buffer.length>8*1024*1024)throw fail(400,'Envie um PDF ou imagem de até 8 MB.');
 if(buffer.subarray(0,5).toString()==='%PDF-')return {mime:'application/pdf',ext:'.pdf'};
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'.png'};
 if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return {mime:'image/jpeg',ext:'.jpg'};
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'.webp'};
 throw fail(400,'Formato não permitido. Envie PDF, JPEG, PNG ou WebP.');
}
export async function submitReceipt(db,{installmentId,user,file}){
 const format=receiptFile(file?.buffer);
 return db.$transaction(async tx=>{
  await lock(tx,installmentId);
  const installment=await tx.installment.findUnique({where:{id:installmentId},include:{contract:{include:{client:true}}}});
  if(!installment||(user.role!=='ADMIN'&&installment.contract.client.userId!==user.id))throw fail(403,'Acesso negado.');
  if(installment.status==='PAID')throw fail(409,'Parcela já quitada. Atualize a página para consultar o pagamento.');
  if(!installment.manualReceiptEnabled)throw fail(403,'O envio manual não está liberado para esta parcela. Contate a administração.');
  if(await tx.receipt.count({where:{installmentId,status:'PENDING'}}))throw fail(409,'Já existe um comprovante desta parcela aguardando análise.');
  const row=await tx.receipt.create({data:{installmentId,fileName:crypto.randomUUID()+format.ext,originalName:String(file.originalname||'comprovante'+format.ext).slice(0,200),mimeType:format.mime,fileData:file.buffer}});
  await tx.installment.updateMany({where:{id:installmentId,status:{not:'PAID'}},data:{status:'PENDING_REVIEW'}});
  return safe(row);
 });
}
export async function reviewReceipt(db,{id,status,note,userId}){
 if(!['APPROVED','REJECTED'].includes(status))throw fail(400,'Situação inválida.');
 note=String(note||'').trim();
 if(note.length>1000)throw fail(400,'O motivo deve ter até 1.000 caracteres.');
 if(status==='REJECTED'&&!note)throw fail(400,'Informe o motivo da rejeição para orientar o cliente.');
 return db.$transaction(async tx=>{
  const initial=await tx.receipt.findUnique({where:{id}});if(!initial)throw fail(404,'Comprovante não encontrado.');
  await lock(tx,initial.installmentId);
  const previous=await tx.receipt.findUnique({where:{id}});
  if(!previous)throw fail(404,'Comprovante não encontrado.');
  if(previous.status!=='PENDING')throw fail(409,'Comprovante já analisado. Atualize a página.');
  const row=await tx.receipt.update({where:{id},data:{status,note:note||null,reviewedAt:new Date(),reviewedBy:userId}});
  const pending=await tx.receipt.count({where:{installmentId:row.installmentId,status:'PENDING'}});
  await tx.installment.updateMany({where:{id:row.installmentId,status:{not:'PAID'}},data:{status:status==='APPROVED'?'PAID':pending?'PENDING_REVIEW':'REJECTED'}});
  return safe(row);
 });
}
export async function configureManualReceipt(db,{id,enabled}){
 if(typeof enabled!=='boolean')throw fail(400,'Informe se o comprovante manual está liberado.');
 return db.$transaction(async tx=>{
  await lock(tx,id);const installment=await tx.installment.findUnique({where:{id}});
  if(!installment)throw fail(404,'Parcela não encontrada.');
  if(installment.status==='PAID'&&enabled)throw fail(409,'Não é possível liberar envio para parcela quitada.');
  await tx.installment.updateMany({where:{id},data:{manualReceiptEnabled:enabled}});
  return {id,manualReceiptEnabled:enabled};
 });
}
export async function deleteReceipt(db,id){
 return db.$transaction(async tx=>{
  const initial=await tx.receipt.findUnique({where:{id}});if(!initial)throw fail(404,'Comprovante não encontrado.');
  await lock(tx,initial.installmentId);const row=await tx.receipt.findUnique({where:{id}});
  if(!row)throw fail(404,'Comprovante não encontrado.');
  if(row.status==='APPROVED')throw fail(409,'Comprovante aprovado não pode ser excluído; preserve o histórico financeiro.');
  await tx.receipt.delete({where:{id}});
  if(!await tx.receipt.count({where:{installmentId:row.installmentId,status:'PENDING'}}))await tx.installment.updateMany({where:{id:row.installmentId,status:'PENDING_REVIEW'},data:{status:'OPEN'}});
  return row.fileName;
 });
}
export function registerReceiptRoutes(app,{db,auth,current,admin,uploadDir}){
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1,fields:2}}).single('file');
 const errorResponse=(error,res)=>{
  if(error.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'O comprovante deve ter até 8 MB.'});
  if(error instanceof multer.MulterError)return res.status(400).json({error:'Envie apenas um arquivo no campo de comprovante.'});
  if(error.status)return res.status(error.status).json({error:error.message});
  if(['P2021','P2022'].includes(error.code))return res.status(503).json({error:'O envio de comprovantes precisa ser habilitado no banco pela administração.'});
  console.error('Falha ao processar comprovante');res.status(503).json({error:'Não foi possível processar o comprovante. Tente novamente.'});
 };
 const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(error=>errorResponse(error,res));
 app.post('/api/installments/:id/receipts',auth,current,(req,res,next)=>upload(req,res,error=>error?errorResponse(error,res):next()),wrap(async(req,res)=>{
  if(!req.file)throw fail(400,'Selecione um comprovante para enviar.');
  res.status(201).json(await submitReceipt(db,{installmentId:req.params.id,user:req.auth,file:req.file}));
 }));
 app.patch('/api/installments/:id/manual-receipt',auth,current,admin,wrap(async(req,res)=>{
  res.json(await configureManualReceipt(db,{id:req.params.id,enabled:req.body?.enabled}));
 }));
 app.patch('/api/receipts/:id',auth,current,admin,wrap(async(req,res)=>{
  res.json(await reviewReceipt(db,{id:req.params.id,status:req.body?.status,note:req.body?.note,userId:req.auth.id}));
 }));
 app.delete('/api/receipts/:id',auth,current,admin,wrap(async(req,res)=>{
  const name=await deleteReceipt(db,req.params.id),file=path.join(uploadDir,path.basename(name));
  try{await fs.promises.unlink(file)}catch(error){if(error.code!=='ENOENT')console.error('Não foi possível remover arquivo legado do comprovante')}
  res.json({ok:true});
 }));
 app.get('/api/receipts/:id/file',auth,current,wrap(async(req,res)=>{
  const row=await db.receipt.findUnique({where:{id:req.params.id},select:{id:true,fileData:true,fileName:true,mimeType:true,installment:{select:{contract:{select:{client:{select:{userId:true}}}}}}}});
  if(!row||(req.auth.role!=='ADMIN'&&row.installment.contract.client.userId!==req.auth.id))throw fail(403,'Acesso negado.');
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Disposition','inline; filename="'+path.basename(row.fileName).replace(/[^a-zA-Z0-9_.-]/g,'_')+'"');
  res.type(row.mimeType);
  if(row.fileData)return res.send(Buffer.from(row.fileData));
  const file=path.join(uploadDir,path.basename(row.fileName));
  if(!fs.existsSync(file))throw fail(404,'Comprovante antigo indisponível. Solicite o reenvio ao cliente.');
  res.sendFile(file);
 }));
}
