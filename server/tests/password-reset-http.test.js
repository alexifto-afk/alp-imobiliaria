import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import {registerPasswordResetRoutes} from '../src/password-reset-routes.js';
import {resetDatabase} from './helpers/reset-database.js';

async function server(options,run){
 const app=express();app.use(express.json());
 const memory=resetDatabase(()=>Date.now()),mail=[];
 registerPasswordResetRoutes(app,{db:memory.db,secret:'segredo-ficticio-teste-http',hashPassword:p=>bcrypt.hash(p,4),
  env:{RESEND_API_KEY:'chave-ficticia',RESET_EMAIL_FROM:'ALP <acesso@example.com>'},
  fetchImpl:async(url,opts)=>{mail.push(JSON.parse(opts.body));return {ok:true}},...options});
 app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const post=async(path,body)=>fetch('http://127.0.0.1:'+listener.address().port+'/api/auth/password-reset/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{await run({post,memory,mail})}finally{await new Promise(resolve=>listener.close(resolve))}
}
test('HTTP: configuração ausente retorna 503 sem fingir envio',async()=>{
 await server({env:{}},async({post,mail})=>{
  const r=await post('request',{cpf:'00000000000',channel:'EMAIL'});
  assert.equal(r.status,503);assert.match((await r.json()).error,/não está disponível/);assert.equal(mail.length,0);
 });
});
test('HTTP: solicitar, verificar e redefinir usa as rotas reais',async()=>{
 await server({},async({post,mail,memory})=>{
  const cpf='00000000000';
  assert.equal((await post('request',{cpf,channel:'EMAIL'})).status,200);
  const code=mail[0].text.match(/\b\d{6}\b/)[0];
  assert.equal((await post('verify',{cpf,channel:'EMAIL',code})).status,200);
  assert.equal((await post('confirm',{cpf,channel:'EMAIL',code,newPassword:'MinhaNovaSenha123!'})).status,200);
  assert.equal(await bcrypt.compare('MinhaNovaSenha123!',memory.state.user.passwordHash),true);
  assert.equal((await post('confirm',{cpf,channel:'EMAIL',code,newPassword:'OutraSenha123!'})).status,400);
 });
});
test('HTTP: limite de solicitações retorna 429 com Retry-After',async()=>{
 await server({},async({post})=>{
  for(let n=0;n<12;n++)assert.equal((await post('request',{cpf:'11111111111'})).status,200);
  const r=await post('request',{cpf:'11111111111'});
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'900');
 });
});
