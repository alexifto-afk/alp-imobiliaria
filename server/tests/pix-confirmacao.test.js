import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmarPagamentoPix,reconciliarParcela,reconciliarPendentes} from '../src/pix-confirmation.js';

const cobranca = {id:'pix-1',providerId:'12345',installmentId:'parcela-1',amount:1000,status:'pending'};
const pagamento = {id:12345,status:'approved',payment_method_id:'pix',currency_id:'BRL',external_reference:'parcela-1',transaction_amount:10,date_approved:'2026-11-07T12:00:00Z'};
function banco(cobrancas=[{...cobranca}]) {
 const parcela={id:'parcela-1',amount:1000,status:'OPEN'};
 const chamadas=[];
 const db={
  pixPayment:{
   findMany:async query=>{chamadas.push(query);return cobrancas},
   findUnique:async ({where})=>cobrancas.find(p=>p.id===where.id),
   update:async ({where,data})=>Object.assign(cobrancas.find(p=>p.id===where.id),data),
   updateMany:async ({where,data})=>{const p=cobrancas.find(p=>p.id===where.id);if(p.status!==where.status.not){Object.assign(p,data);return {count:1}}return {count:0}}
  },
  installment:{
   findUnique:async()=>parcela,
   update:async({data})=>Object.assign(parcela,data)
  },
  $transaction:async fn=>fn(db)
 };
 return {db,parcela,cobrancas,chamadas};
}

test('aprovação autêntica quita a parcela e registra data',async()=>{
 const {db,parcela,cobrancas}=banco();
 await confirmarPagamentoPix(db,pagamento,cobrancas[0]);
 assert.equal(parcela.status,'PAID');
 assert.equal(cobrancas[0].status,'approved');
 assert.equal(cobrancas[0].paidAt.toISOString(),pagamento.date_approved.replace('Z','.000Z'));
});
test('pagamento pendente não quita a parcela',async()=>{
 const {db,parcela,cobrancas}=banco();
 await confirmarPagamentoPix(db,{...pagamento,status:'pending'},cobrancas[0]);
 assert.equal(parcela.status,'OPEN');
 assert.equal(cobrancas[0].status,'pending');
});
for(const [campo,valor] of Object.entries({id:999,payment_method_id:'credit_card',currency_id:'USD',external_reference:'outra-parcela',transaction_amount:9.99})){
 test('recusa divergência em '+campo,async()=>{
  const {db,parcela,cobrancas}=banco();
  await assert.rejects(confirmarPagamentoPix(db,{...pagamento,[campo]:valor},cobrancas[0]),/não corresponde/);
  assert.equal(parcela.status,'OPEN');assert.equal(cobrancas[0].status,'pending');
 });
}
test('recusa alteração do valor da parcela',async()=>{
 const {db,parcela,cobrancas}=banco();parcela.amount=1200;
 await assert.rejects(confirmarPagamentoPix(db,pagamento,cobrancas[0]),/não corresponde/);
 assert.equal(parcela.status,'OPEN');
});
test('notificação repetida e consulta pendente atrasada não desfazem aprovação',async()=>{
 const {db,parcela,cobrancas}=banco();
 await confirmarPagamentoPix(db,pagamento,cobrancas[0]);
 const data=cobrancas[0].paidAt;
 await confirmarPagamentoPix(db,pagamento,cobrancas[0]);
 await confirmarPagamentoPix(db,{...pagamento,status:'pending'},cobrancas[0]);
 assert.equal(parcela.status,'PAID');assert.equal(cobrancas[0].status,'approved');
 assert.deepEqual(cobrancas[0].paidAt,data);
});
test('consulta de status recupera aprovação mesmo sem webhook',async()=>{
 const {db,parcela}=banco();const rotas=[];
 const result=await reconciliarParcela(db,async route=>{rotas.push(route);return pagamento},parcela.id);
 assert.equal(result.status,'PAID');assert.deepEqual(rotas,['/v1/payments/12345']);
});
test('cobrança recente pendente não esconde aprovação da cobrança anterior',async()=>{
 const {db,parcela}=banco([{...cobranca,id:'pix-2',providerId:'999'}, {...cobranca}]);
 await reconciliarParcela(db,async route=>route.endsWith('/999')?{...pagamento,id:999,status:'pending'}:pagamento,parcela.id);
 assert.equal(parcela.status,'PAID');
});
test('falha na API mantém parcela aberta e impede confirmação',async()=>{
 const {db,parcela,cobrancas}=banco();
 await assert.rejects(reconciliarParcela(db,async()=>{throw Error('timeout')},parcela.id),/timeout/);
 assert.equal(parcela.status,'OPEN');assert.equal(cobrancas[0].status,'pending');
});
test('rotina periódica recupera aprovação com cliente desconectado',async()=>{
 const {db,parcela,chamadas}=banco();
 await reconciliarPendentes(db,async()=>pagamento);
 assert.equal(parcela.status,'PAID');
 assert.equal(chamadas[0].take,25);
 assert.deepEqual(chamadas[0].orderBy,{updatedAt:'asc'});
});
test('rotina continua após falha individual e não quita pagamento divergente',async()=>{
 const {db,parcela}=banco([{...cobranca,id:'pix-2',providerId:'999'}, {...cobranca}]);
 const falhas=[];
 await reconciliarPendentes(db,async route=>{if(route.endsWith('/999'))throw Error('timeout');return pagamento},id=>falhas.push(id));
 assert.equal(parcela.status,'PAID');assert.deepEqual(falhas,['pix-2']);
});
