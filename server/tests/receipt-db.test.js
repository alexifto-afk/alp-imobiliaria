import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {submitReceipt,reviewReceipt,deleteReceipt,configureManualReceipt} from '../src/receipt-routes.js';
test('PostgreSQL: arquivo persistido, omissão de bytes, concorrência e Pix',async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||url===process.env.DATABASE_URL||!new URL(url).pathname.toLowerCase().includes('test'))throw Error('Use um banco separado em TEST_DATABASE_URL, com test no nome.');
 const db=new PrismaClient({datasources:{db:{url}},omit:{receipt:{fileData:true}}});let user,client,property,contract;
 const file={originalname:'proof.pdf',buffer:Buffer.from('%PDF-1.4\nlocal receipt test')};
 try{
  user=await db.user.create({data:{name:'Teste comprovantes',cpf:'997'+String(crypto.randomInt(100000000)).padStart(8,'0'),passwordHash:'TEST_ONLY'}});
  client=await db.client.create({data:{userId:user.id}});property=await db.property.create({data:{reference:'TEST-RECEIPT',address:'Local test'}});
  contract=await db.contract.create({data:{clientId:client.id,propertyId:property.id,downPayment:0,installmentCount:4,startDate:new Date(),installments:{create:Array.from({length:4},(_,index)=>({number:index+1,dueDate:new Date(),amount:10000}))}},include:{installments:{orderBy:{number:'asc'}}}});
  const [a,b,c,d]=contract.installments,owner={id:user.id,role:'CLIENT'},send=id=>submitReceipt(db,{installmentId:id,user:owner,file});
  assert.equal(a.manualReceiptEnabled,false);await assert.rejects(send(a.id),{status:403});
  for(const item of [a,b,c,d])await configureManualReceipt(db,{id:item.id,enabled:true});
  const uploads=await Promise.allSettled([send(a.id),send(a.id)]);assert.equal(uploads.filter(v=>v.status==='fulfilled').length,1);assert.equal(uploads.find(v=>v.status==='rejected').reason.status,409);
  const receipt=await db.receipt.findFirst({where:{installmentId:a.id}});assert.equal(receipt.fileData,undefined);
  const nested=await db.contract.findUnique({where:{id:contract.id},include:{installments:{include:{receipts:true}}}});assert.equal(nested.installments.flatMap(v=>v.receipts)[0].fileData,undefined);
  assert.deepEqual(Buffer.from((await db.receipt.findUnique({where:{id:receipt.id},select:{fileData:true}})).fileData),file.buffer);
  const reviews=await Promise.allSettled([reviewReceipt(db,{id:receipt.id,status:'APPROVED',userId:'test-admin'}),reviewReceipt(db,{id:receipt.id,status:'REJECTED',note:'Test rejection',userId:'test-admin'})]);assert.equal(reviews.filter(v=>v.status==='fulfilled').length,1);
  const reviewed=await db.receipt.findUnique({where:{id:receipt.id}});assert.equal(reviewed.reviewedBy,'test-admin');assert.equal((await db.installment.findUnique({where:{id:a.id}})).status,reviewed.status==='APPROVED'?'PAID':'REJECTED');
  if(reviewed.status==='APPROVED')await assert.rejects(deleteReceipt(db,receipt.id),{status:409});
  const pending=await send(b.id);await db.installment.update({where:{id:b.id},data:{status:'PAID'}});await reviewReceipt(db,{id:pending.id,status:'REJECTED',note:'Pix confirmed',userId:'test-admin'});assert.equal((await db.installment.findUnique({where:{id:b.id}})).status,'PAID');await deleteReceipt(db,pending.id);assert.equal((await db.installment.findUnique({where:{id:b.id}})).status,'PAID');
  let held,release;const locked=new Promise(resolve=>{held=resolve}),gate=new Promise(resolve=>{release=resolve});
  const pix=db.$transaction(async tx=>{await tx.installment.update({where:{id:c.id},data:{status:'PAID'}});held();await gate});
  await locked;const attempted=send(c.id).then(()=>null,error=>error);release();await pix;assert.equal((await attempted).status,409);assert.equal(await db.receipt.count({where:{installmentId:c.id}}),0);
  const broken={$transaction:fn=>db.$transaction(tx=>fn({...tx,installment:{...tx.installment,updateMany:async()=>{throw Error('test rollback')}}}))};
  await assert.rejects(submitReceipt(broken,{installmentId:d.id,user:owner,file}),/test rollback/);assert.equal(await db.receipt.count({where:{installmentId:d.id}}),0);assert.equal((await db.installment.findUnique({where:{id:d.id}})).status,'OPEN');
 }finally{
  if(contract){await db.receipt.deleteMany({where:{installment:{contractId:contract.id}}});await db.installment.deleteMany({where:{contractId:contract.id}});await db.contract.delete({where:{id:contract.id}})}
  if(client)await db.client.delete({where:{id:client.id}});if(property)await db.property.delete({where:{id:property.id}});if(user)await db.user.delete({where:{id:user.id}});await db.$disconnect();
 }
});
