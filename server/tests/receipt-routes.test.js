import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {submitReceipt,reviewReceipt,deleteReceipt,registerReceiptRoutes,receiptFile,configureManualReceipt} from '../src/receipt-routes.js';
const proof=()=>({originalname:'comprovante.pdf',buffer:Buffer.from('%PDF-1.4\ncomprovante ficticio de teste')});
function fixture(){
 const state={installment:{id:'i',status:'OPEN',manualReceiptEnabled:true,contract:{client:{userId:'client'}}},receipts:[],locks:0,failUpdate:false};let queue=Promise.resolve();
 const tx={
  $queryRaw:async()=>{state.locks++;return [{id:'i'}]},
  installment:{findUnique:async({where})=>where.id==='i'?structuredClone(state.installment):null,updateMany:async({where,data})=>{
   if(state.failUpdate)throw Error('database failure');
   const status=state.installment.status;
   if(where.status&&(typeof where.status==='string'?where.status!==status:where.status.not===status))return {count:0};
   Object.assign(state.installment,data);return {count:1};
  }},
  receipt:{
   findUnique:async({where,select})=>{const row=state.receipts.find(value=>value.id===where.id);return row?{...row,...(select?.installment?{installment:structuredClone(state.installment)}:{})}:null},
   count:async({where})=>state.receipts.filter(row=>row.installmentId===where.installmentId&&row.status===where.status).length,
   create:async({data})=>{const row={id:'r'+(state.receipts.length+1),status:'PENDING',createdAt:new Date(),...data};state.receipts.push(row);return {...row}},
   update:async({where,data})=>{const row=state.receipts.find(value=>value.id===where.id);Object.assign(row,data);return {...row}},
   delete:async({where})=>{const index=state.receipts.findIndex(value=>value.id===where.id);return state.receipts.splice(index,1)[0]}
  }
 };
 const db={...tx,$transaction:fn=>{
  const operation=queue.then(async()=>{const before=structuredClone({installment:state.installment,receipts:state.receipts});try{return await fn(tx)}catch(error){state.installment=before.installment;state.receipts=before.receipts;throw error}});queue=operation.catch(()=>{});return operation;
 }};
 const submit=(user={id:'client',role:'CLIENT'})=>submitReceipt(db,{installmentId:'i',user,file:proof()});
 return {db,state,submit};
}
test('envio guarda arquivo no banco, omite bytes da resposta e aguarda análise',async()=>{
 const f=fixture(),row=await f.submit();assert.equal(row.fileData,undefined);assert.equal(f.state.receipts[0].fileData.toString(),proof().buffer.toString());assert.equal(f.state.installment.status,'PENDING_REVIEW');assert.equal(f.state.locks,1);
 await assert.rejects(f.submit(),{status:409});assert.equal(f.state.receipts.length,1);
});
test('cliente não envia para outro cliente nem para parcela quitada; arquivo inválido é recusado',async()=>{
 const f=fixture();await assert.rejects(f.submit({id:'other',role:'CLIENT'}),{status:403});assert.equal(f.state.receipts.length,0);
 f.state.installment.status='PAID';await assert.rejects(f.submit(),{status:409});assert.equal(f.state.installment.status,'PAID');
 assert.throws(()=>receiptFile(Buffer.from('<html>teste</html>')),{status:400});assert.throws(()=>receiptFile(Buffer.alloc(8*1024*1024+1)),{status:400});
});
test('aprovação dá baixa uma vez e registra autor e data; não pode apagar comprovante aprovado',async()=>{
 const f=fixture(),row=await f.submit();const approved=await reviewReceipt(f.db,{id:row.id,status:'APPROVED',userId:'admin'});
 assert.equal(f.state.installment.status,'PAID');assert.equal(approved.reviewedBy,'admin');assert.ok(approved.reviewedAt instanceof Date);assert.equal(approved.fileData,undefined);
 await assert.rejects(reviewReceipt(f.db,{id:row.id,status:'APPROVED',userId:'admin'}),{status:409});await assert.rejects(deleteReceipt(f.db,row.id),{status:409});
});
test('rejeição exige motivo, permite reenvio e nunca desfaz Pix confirmado',async()=>{
 const f=fixture(),row=await f.submit();await assert.rejects(reviewReceipt(f.db,{id:row.id,status:'REJECTED',userId:'admin'}),{status:400});
 await reviewReceipt(f.db,{id:row.id,status:'REJECTED',note:'Valor não corresponde à parcela',userId:'admin'});assert.equal(f.state.installment.status,'REJECTED');
 const next=await f.submit();assert.equal(f.state.installment.status,'PENDING_REVIEW');f.state.installment.status='PAID';
 await reviewReceipt(f.db,{id:next.id,status:'REJECTED',note:'Comprovante ilegível',userId:'admin'});assert.equal(f.state.installment.status,'PAID');
});
test('operações simultâneas são serializadas e falha no banco reverte arquivo e status',async()=>{
 const f=fixture(),results=await Promise.allSettled([f.submit(),f.submit()]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(f.state.receipts.length,1);
 const decisions=await Promise.allSettled([reviewReceipt(f.db,{id:'r1',status:'APPROVED',userId:'a'}),reviewReceipt(f.db,{id:'r1',status:'REJECTED',note:'Revisão',userId:'b'})]);assert.equal(decisions.filter(value=>value.status==='fulfilled').length,1);assert.equal(f.state.installment.status,'PAID');
 const g=fixture();g.state.failUpdate=true;await assert.rejects(g.submit(),/database failure/);assert.equal(g.state.receipts.length,0);assert.equal(g.state.installment.status,'OPEN');
});
async function http(run){
 const f=fixture(),app=express();app.use(express.json());
 const auth=(req,res,next)=>{const id=req.get('x-user');if(!id)return res.sendStatus(401);req.auth={id,role:req.get('x-role')||'CLIENT'};next()};
 registerReceiptRoutes(app,{db:f.db,auth,current:(req,res,next)=>next(),admin:(req,res,next)=>req.auth.role==='ADMIN'?next():res.sendStatus(403),uploadDir:'/tmp/alp-legacy-receipts-tests'});
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const send=(path,method='GET',body,headers={'x-user':'client'})=>fetch('http://127.0.0.1:'+listener.address().port+path,{method,headers,body});
 const upload=(file=proof().buffer)=>{const data=new FormData();data.append('file',new Blob([file],{type:'application/pdf'}),'proof.pdf');return data};
 try{await run({...f,send,upload})}finally{await new Promise(resolve=>listener.close(resolve))}
}
test('HTTP multipart: sessão, propriedade, revisão administrativa e download privado',async()=>http(async({send,upload})=>{
 assert.equal((await send('/api/installments/i/receipts','POST',upload(),{})).status,401);
 assert.equal((await send('/api/installments/i/receipts','POST',upload(),{'x-user':'other'})).status,403);
 const submitted=await send('/api/installments/i/receipts','POST',upload());assert.equal(submitted.status,201);const row=await submitted.json();assert.equal(row.fileData,undefined);
 assert.equal((await send('/api/receipts/'+row.id+'/file','GET',null,{'x-user':'other'})).status,403);
 const file=await send('/api/receipts/'+row.id+'/file');assert.equal(file.status,200);assert.equal(file.headers.get('cache-control'),'private, no-store');assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.equal(await file.text(),proof().buffer.toString());
 const body=JSON.stringify({status:'APPROVED'});
 assert.equal((await send('/api/receipts/'+row.id,'PATCH',body,{'x-user':'client','content-type':'application/json'})).status,403);
 assert.equal((await send('/api/receipts/'+row.id,'PATCH',body,{'x-user':'admin','x-role':'ADMIN','content-type':'application/json'})).status,200);
}));
test('HTTP: arquivo inválido ou acima do limite não cria registros',async()=>http(async({send,upload,state})=>{
 assert.equal((await send('/api/installments/i/receipts','POST',upload(Buffer.from('invalid')))).status,400);
 assert.equal((await send('/api/installments/i/receipts','POST',upload(Buffer.alloc(8*1024*1024+1)))).status,413);assert.equal(state.receipts.length,0);
}));

test('modo manual é liberado por parcela; desabilitar não apaga comprovante pendente',async()=>{
 const f=fixture();f.state.installment.manualReceiptEnabled=false;
 await assert.rejects(f.submit(),{status:403});assert.equal(f.state.receipts.length,0);
 await configureManualReceipt(f.db,{id:'i',enabled:true});const receipt=await f.submit();
 await configureManualReceipt(f.db,{id:'i',enabled:false});assert.equal(f.state.receipts.length,1);
 await reviewReceipt(f.db,{id:receipt.id,status:'APPROVED',userId:'admin'});assert.equal(f.state.installment.status,'PAID');
 await assert.rejects(configureManualReceipt(f.db,{id:'i',enabled:true}),{status:409});
 await assert.rejects(configureManualReceipt(f.db,{id:'i',enabled:'true'}),{status:400});
});
test('HTTP: só administrador pode liberar a opção; cliente não habilita pelo corpo do upload',async()=>http(async({send,upload,state})=>{
 state.installment.manualReceiptEnabled=false;
 assert.equal((await send('/api/installments/i/manual-receipt','PATCH',JSON.stringify({enabled:true}),{'x-user':'client','content-type':'application/json'})).status,403);
 const attempted=upload();attempted.append('manualReceiptEnabled','true');assert.equal((await send('/api/installments/i/receipts','POST',attempted)).status,403);
 assert.equal((await send('/api/installments/i/manual-receipt','PATCH',JSON.stringify({enabled:true}),{'x-user':'admin','x-role':'ADMIN','content-type':'application/json'})).status,200);
 assert.equal((await send('/api/installments/i/receipts','POST',upload())).status,201);
}));
