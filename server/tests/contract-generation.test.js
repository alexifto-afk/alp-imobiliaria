import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {entryInstallments,registerContractGenerationRoutes} from '../src/contract-generation.js';

test('entrada de R$20.000 em dez parcelas gera R$2.000, sem usar o financiado de R$80.000',()=>{
 const result=entryInstallments(10000000,8000000,10,'NONE',0);assert.equal(result.downPayment,2000000);assert.deepEqual(result.amounts,Array(10).fill(200000));
});
test('centavos são distribuídos sem diferença na soma; juros usam a entrada como base',()=>{
 const {amounts}=entryInstallments(10001,0,3,'NONE',0);assert.deepEqual(amounts,[3334,3334,3333]);assert.equal(amounts.reduce((a,b)=>a+b,0),10001);
 assert.deepEqual(entryInstallments(10000000,8000000,10,'SIMPLE',1).amounts,Array(10).fill(220000));
 const price=entryInstallments(10000000,8000000,10,'PRICE',1).amounts;assert.equal(price.reduce((a,b)=>a+b,0),2111642);
 assert.deepEqual(entryInstallments(10000000,8000000,10,'PRICE',0).amounts,Array(10).fill(200000));
 assert.throws(()=>entryInstallments(100,100,1,'NONE',0),{status:400});assert.throws(()=>entryInstallments(100,99,2,'NONE',0),{status:400});
});
async function setup(run){
 const state={writes:[],deleted:0,deletedContracts:0,locks:0,receipts:0,pix:0,contract:{id:'contract',installments:[{status:'OPEN'}]}};
 const db={$queryRaw:async()=>{state.locks++;return []},client:{findUnique:async()=>({id:'client',user:{active:true}})},property:{findUnique:async()=>({id:'property',active:true})},contract:{findUnique:async()=>state.contract,delete:async()=>{state.deletedContracts++;return {id:'contract'}},create:async args=>{state.writes.push(args);return {id:'new',...args.data}},update:async args=>{state.writes.push(args);return args.data}},receipt:{count:async()=>state.receipts},pixPayment:{count:async()=>state.pix},installment:{deleteMany:async()=>{state.deleted++;return {count:1}}}};db.$transaction=fn=>fn(db);
 const app=express();app.use(express.json());const auth=(req,res,next)=>{if(!req.get('x-role'))return res.sendStatus(401);req.auth={role:req.get('x-role')};next()};
 registerContractGenerationRoutes(app,{db,auth,current:(req,res,next)=>next(),admin:(req,res,next)=>req.auth.role==='ADMIN'?next():res.sendStatus(403),contractInclude:{}});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const send=(method,body,role='ADMIN')=>fetch('http://127.0.0.1:'+listener.address().port+'/api/contracts'+(method==='POST'?'':'/contract'),{method,headers:{'content-type':'application/json',...(role?{'x-role':role}:{})},body:JSON.stringify(body)});
 try{await run({state,db,send})}finally{await new Promise(resolve=>listener.close(resolve))}
}
const body={clientId:'client',propertyId:'property',propertyPrice:10000000,financedAmount:8000000,installmentCount:10,interestType:'NONE',monthlyRate:0,startDate:'2026-01-31'};
test('HTTP: criação e edição permitida gravam parcelas sobre a entrada e mantêm datas e ordem',async()=>setup(async({send,state})=>{
 assert.equal((await send('POST',body)).status,201);assert.equal((await send('PATCH',body)).status,200);assert.equal(state.deleted,1);
 for(const {data} of state.writes){assert.equal(data.downPayment,2000000);assert.equal(data.financedAmount,8000000);assert.deepEqual(data.installments.create.map(item=>item.amount),Array(10).fill(200000));assert.deepEqual(data.installments.create.map(item=>item.number),[1,2,3,4,5,6,7,8,9,10]);assert.equal(data.installments.create[1].dueDate.toISOString(),'2026-02-28T12:00:00.000Z');assert.equal(data.installments.create[2].dueDate.toISOString(),'2026-03-31T12:00:00.000Z')}
}));
test('HTTP: entrada zero/negativa e parcelas sem centavos são recusadas antes de gravar',async()=>setup(async({send,state})=>{
 for(const method of ['POST','PATCH'])for(const invalid of [{...body,financedAmount:body.propertyPrice},{...body,financedAmount:body.propertyPrice+1},{...body,propertyPrice:100,financedAmount:99},{...body,installmentCount:0}])assert.equal((await send(method,invalid)).status,400);
 assert.equal(state.writes.length,0);assert.equal(state.deleted,0);
}));
test('HTTP: contas sem permissão e contratos com movimentação não são alterados',async()=>setup(async({send,state})=>{
 assert.equal((await send('POST',body,null)).status,401);assert.equal((await send('PATCH',body,'CLIENT')).status,403);
 for(const status of ['PAID','PENDING_REVIEW','REJECTED']){state.contract.installments=[{status}];assert.equal((await send('PATCH',body)).status,409)}
 state.contract.installments=[{status:'OPEN'}];state.receipts=1;assert.equal((await send('PATCH',body)).status,409);state.receipts=0;state.pix=1;assert.equal((await send('PATCH',body)).status,409);
 assert.equal(state.writes.length,0);assert.equal(state.deleted,0);
}));

test('HTTP: qualquer parcela paga bloqueia edição e exclusão, inclusive com parcelas abertas',async()=>setup(async({send,state})=>{
 state.contract.installments=[{number:1,status:'OPEN'},{number:2,status:'PAID'}];
 for(const method of ['PATCH','DELETE']){const result=await send(method,body);assert.equal(result.status,409);assert.match((await result.json()).error,/Após o primeiro pagamento/)}
 assert.equal(state.writes.length,0);assert.equal(state.deleted,0);assert.equal(state.deletedContracts,0);assert.equal(state.locks,4);
}));
test('HTTP: exclusão mantém bloqueios de histórico e autorização; contrato sem movimento pode ser excluído',async()=>setup(async({send,state})=>{
 assert.equal((await send('DELETE',body,null)).status,401);assert.equal((await send('DELETE',body,'CLIENT')).status,403);
 state.receipts=1;assert.equal((await send('DELETE',body)).status,409);state.receipts=0;state.pix=1;assert.equal((await send('DELETE',body)).status,409);
 state.pix=0;assert.equal((await send('DELETE',body)).status,200);assert.equal(state.deleted,1);assert.equal(state.deletedContracts,1);
}));
