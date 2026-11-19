import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {withUnmovedContract} from '../src/contract-protection.js';

test('PostgreSQL: contrato aberto pode mudar; primeiro pagamento bloqueia alterações inclusive concorrentes',async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||url===process.env.DATABASE_URL||!new URL(url).pathname.toLowerCase().includes('test'))throw Error('Use um banco de testes separado em TEST_DATABASE_URL, com test no nome.');
 const db=new PrismaClient({datasources:{db:{url}}});let user,client,property,contract;
 try{
  user=await db.user.create({data:{name:'Teste bloqueio contrato',cpf:'996'+String(crypto.randomInt(100000000)).padStart(8,'0'),passwordHash:'TEST_ONLY'}});
  client=await db.client.create({data:{userId:user.id}});property=await db.property.create({data:{reference:'TEST-CONTRACT-LOCK',address:'Local test'}});
  contract=await db.contract.create({data:{clientId:client.id,propertyId:property.id,downPayment:20000,installmentCount:2,startDate:new Date(),installments:{create:[{number:1,dueDate:new Date(),amount:10000},{number:2,dueDate:new Date(),amount:10000}]}},include:{installments:true}});
  await withUnmovedContract(db,contract.id,tx=>tx.contract.update({where:{id:contract.id},data:{propertyPrice:500000}}));assert.equal((await db.contract.findUnique({where:{id:contract.id}})).propertyPrice,500000);
  const installment=contract.installments[0];
  let held,release;const locked=new Promise(resolve=>{held=resolve}),gate=new Promise(resolve=>{release=resolve});
  const payment=db.$transaction(async tx=>{await tx.installment.update({where:{id:installment.id},data:{status:'PAID'}});held();await gate});
  await locked;let called=false;const deletion=withUnmovedContract(db,contract.id,async tx=>{called=true;await tx.installment.deleteMany({where:{contractId:contract.id}});await tx.contract.delete({where:{id:contract.id}})}).then(()=>null,error=>error);
  // Dá à operação concorrente a oportunidade de chegar ao bloqueio de linha.
  await new Promise(resolve=>setTimeout(resolve,40));release();await payment;assert.equal((await deletion).status,409);assert.equal(called,false);
  await assert.rejects(withUnmovedContract(db,contract.id,()=>{called=true}),{status:409});assert.equal(called,false);assert.equal(await db.installment.count({where:{contractId:contract.id}}),2);assert.equal((await db.installment.findUnique({where:{id:installment.id}})).status,'PAID');assert.equal((await db.contract.findUnique({where:{id:contract.id}})).propertyPrice,500000);
  await assert.rejects(withUnmovedContract(db,'missing-contract',()=>{}),{status:404});
 }finally{
  if(contract){await db.installment.deleteMany({where:{contractId:contract.id}});await db.contract.deleteMany({where:{id:contract.id}})}
  if(client)await db.client.delete({where:{id:client.id}});if(property)await db.property.delete({where:{id:property.id}});if(user)await db.user.delete({where:{id:user.id}});await db.$disconnect();
 }
});
