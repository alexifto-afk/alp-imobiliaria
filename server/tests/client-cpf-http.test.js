import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerClientWriteRoutes} from '../src/client-write-routes.js';

async function server(run){
 const state={users:[{id:'user-1',cpf:'11144477735'},{id:'admin',cpf:'52998224725'}],writes:[],hashes:0};
 const db={
  user:{
   findUnique:async({where})=>state.users.find(user=>user.cpf===where.cpf)||null,
   create:async args=>{state.writes.push(args);state.users.push({id:'new',cpf:args.data.cpf});return {client:{id:'new-client'}}},
   update:async args=>{state.writes.push(args);Object.assign(state.users.find(user=>user.id===args.where.id),args.data)}
  },
  client:{
   findUnique:async({where})=>where.id==='client-1'?{id:'client-1',userId:'user-1'}:null,
   update:async args=>{state.writes.push(args)}
  },
  $transaction:fn=>fn(db)
 };
 const app=express();app.use(express.json());
 const next=(req,res,next)=>next();
 registerClientWriteRoutes(app,{db,hashPassword:async()=>{state.hashes++;return 'hash-ficticio'},clientFields:body=>({phone:body.phone||null}),auth:next,current:next,admin:next});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const send=(path,method,body)=>fetch('http://127.0.0.1:'+listener.address().port+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{await run({send,state,db})}finally{await new Promise(resolve=>listener.close(resolve))}
}
const valid={name:'Cliente Teste',cpf:'012.345.678-90',password:'SenhaTeste123!'};
test('HTTP: cadastro inválido é recusado antes de gerar hash ou escrever no banco',async()=>{
 await server(async({send,state})=>{
  const result=await send('/api/clients','POST',{...valid,cpf:'12345678901'});
  assert.equal(result.status,400);assert.match((await result.json()).error,/CPF inválido/);
  assert.equal(state.hashes,0);assert.equal(state.writes.length,0);
 });
});
test('HTTP: cadastro aceita CPF válido e armazena somente dígitos',async()=>{
 await server(async({send,state})=>{
  const result=await send('/api/clients','POST',{...valid,spouseCpf:'529.982.247-25'});
  assert.equal(result.status,201);assert.equal(state.writes[0].data.cpf,'01234567890');
  assert.equal(state.writes[0].data.client.create.spouseCpf,'52998224725');
 });
});
test('HTTP: CPF duplicado é bloqueado inclusive quando pertence a administrador',async()=>{
 await server(async({send,state})=>{
  const result=await send('/api/clients','POST',{...valid,cpf:'529.982.247-25'});
  assert.equal(result.status,409);assert.match((await result.json()).error,/CPF já cadastrado/);
  assert.equal(state.hashes,0);assert.equal(state.writes.length,0);
 });
});
test('HTTP: edição inválida ou com CPF de outra pessoa não escreve no banco',async()=>{
 await server(async({send,state})=>{
  assert.equal((await send('/api/clients/client-1','PUT',{...valid,cpf:'00000000000'})).status,400);
  assert.equal((await send('/api/clients/client-1','PUT',{...valid,cpf:'52998224725'})).status,409);
  assert.equal(state.writes.length,0);
 });
});
test('HTTP: edição permite manter o próprio CPF válido e corrige legado inválido',async()=>{
 await server(async({send,state})=>{
  assert.equal((await send('/api/clients/client-1','PUT',{...valid,cpf:'111.444.777-35'})).status,200);
  assert.equal(state.writes[0].data.cpf,'11144477735');
  state.users[0].cpf='12345678901';
  assert.equal((await send('/api/clients/client-1','PUT',valid)).status,200);
  assert.equal(state.users[0].cpf,'01234567890');
 });
});
test('HTTP: CPF do cônjuge também é validado e campo vazio é permitido',async()=>{
 await server(async({send,state})=>{
  assert.equal((await send('/api/clients','POST',{...valid,spouseCpf:'11111111111'})).status,400);
  assert.equal(state.writes.length,0);
  assert.equal((await send('/api/clients','POST',{...valid,spouseCpf:''})).status,201);
 });
});
test('HTTP: conflito concorrente da restrição única recebe mensagem de CPF duplicado',async()=>{
 await server(async({send,db})=>{
  db.user.create=async()=>{throw Object.assign(Error('restrição única'),{code:'P2002',meta:{target:['cpf']}})};
  const result=await send('/api/clients','POST',valid);
  assert.equal(result.status,409);assert.match((await result.json()).error,/CPF já cadastrado/);
 });
});
