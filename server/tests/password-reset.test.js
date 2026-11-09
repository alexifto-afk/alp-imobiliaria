import {test} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {createPasswordReset,createEmailSender,credentialVersion,validNewPassword} from '../src/password-reset.js';
import {resetDatabase} from './helpers/reset-database.js';

const secret='segredo-ficticio-exclusivo-testes';
const cpf='00000000000';
const newPassword='SenhaNova123!';
function setup(){
 let time=Date.parse('2026-11-09T12:00:00Z'),sequence=123456;
 const memory=resetDatabase(()=>time),mail=[],failures=[];
 const service=createPasswordReset({db:memory.db,secret,now:()=>time,randomCode:()=>String(sequence++),
  hashPassword:password=>bcrypt.hash(password,4),sendEmail:async(to,code)=>mail.push({to,code}),onDeliveryError:()=>failures.push(true)});
 return {memory,mail,failures,service,advance:ms=>{time+=ms}};
}
test('solicitação usa somente o e-mail cadastrado e não guarda código puro',async()=>{
 const {service,memory,mail}=setup();
 const result=await service.request({cpf,email:'invasor@example.com'});
 assert.equal(result.ok,true);assert.equal(mail[0].to,'cliente@example.com');
 assert.equal(memory.state.resets[0].codeHash.length,64);
 assert.equal(JSON.stringify(memory.state).includes('123456'),false);
 assert.equal(result.retryAfterSeconds,60);
});
test('CPF inexistente, conta inativa e conta sem e-mail têm a mesma resposta',async()=>{
 const {service,memory}=setup();
 const unknown=await service.request({cpf:'11111111111'});
 memory.state.user.active=false;
 assert.deepEqual(await service.request({cpf}),unknown);
 memory.state.user.active=true;memory.state.user.client.email='';
 assert.deepEqual(await service.request({cpf}),unknown);
});
test('CPF inválido e canais diferentes de e-mail são recusados',async()=>{
 const {service}=setup();
 await assert.rejects(service.request({cpf:'123'}),/CPF/);
 await assert.rejects(service.request({cpf,channel:'SMS'}),/CPF/);
});
test('solicitações simultâneas e cooldown não disparam e-mails duplicados',async()=>{
 const {service,mail}=setup();
 await Promise.all([service.request({cpf}),service.request({cpf})]);
 assert.equal(mail.length,1);
 await service.request({cpf});assert.equal(mail.length,1);
});
test('reenvio após 60 segundos invalida o código anterior',async()=>{
 const {service,mail,advance}=setup();
 await service.request({cpf});const first=mail[0].code;
 advance(61000);await service.request({cpf});
 await assert.rejects(service.verify({cpf,code:first}),/inválido/);
 assert.deepEqual(await service.verify({cpf,code:mail[1].code}),{ok:true});
});
test('código expira em dez minutos',async()=>{
 const {service,advance}=setup();
 await service.request({cpf});advance(600000);
 await assert.rejects(service.verify({cpf,code:'123456'}),/expirado/);
});
test('cinco erros bloqueiam o código, inclusive para a confirmação',async()=>{
 const {service,memory}=setup();await service.request({cpf});
 for(let n=0;n<5;n++)await assert.rejects(service.verify({cpf,code:'999999'}),/inválido/);
 assert.equal(memory.state.resets[0].attempts,5);
 await assert.rejects(service.confirm({cpf,code:'123456',newPassword}),/inválido/);
 assert.equal(memory.state.user.passwordHash,'hash-antigo');
});
test('verificar não consome o código; confirmar muda hash e impede reutilização',async()=>{
 const {service,memory}=setup();await service.request({cpf});
 await service.verify({cpf,code:'123456'});
 assert.equal(memory.state.resets[0].usedAt,null);
 await service.confirm({cpf,code:'123456',newPassword});
 assert.equal(await bcrypt.compare(newPassword,memory.state.user.passwordHash),true);
 assert.equal(memory.state.user.mustChangePassword,false);
 assert.ok(memory.state.resets[0].usedAt);
 await assert.rejects(service.confirm({cpf,code:'123456',newPassword:'OutraSenha123!'}),/inválido/);
});
test('duas confirmações concorrentes permitem somente um consumo',async()=>{
 const {service}=setup();await service.request({cpf});
 const results=await Promise.allSettled([service.confirm({cpf,code:'123456',newPassword}),service.confirm({cpf,code:'123456',newPassword})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('código é vinculado ao usuário e não pode redefinir outro CPF',async()=>{
 const {service,memory}=setup();await service.request({cpf});
 await assert.rejects(service.confirm({cpf:'11111111111',code:'123456',newPassword}),/inválido/);
 assert.equal(memory.state.user.passwordHash,'hash-antigo');
});
test('falha na entrega apaga código e mantém resposta genérica',async()=>{
 const {memory,failures}=setup();
 const service=createPasswordReset({db:memory.db,secret,hashPassword:()=>{},sendEmail:async()=>{throw Error('falha')},onDeliveryError:()=>failures.push(true)});
 assert.equal((await service.request({cpf})).ok,true);
 assert.equal(memory.state.resets.length,0);assert.equal(failures.length,1);
});
test('limites de senha respeitam o limite de bytes do bcrypt',async()=>{
 assert.equal(validNewPassword('curta'),false);
 assert.equal(validNewPassword('a'.repeat(72)),true);
 assert.equal(validNewPassword('a'.repeat(73)),false);
 assert.equal(validNewPassword('á'.repeat(37)),false);
 const {service,memory}=setup();await service.request({cpf});
 await assert.rejects(service.confirm({cpf,code:'123456',newPassword:'curta'}),/nova senha/);
 assert.equal(memory.state.resets[0].usedAt,null);
});
test('versão de credencial muda após redefinir a senha',async()=>{
 const {service,memory}=setup();const before=credentialVersion(memory.state.user.passwordHash,secret);
 await service.request({cpf});await service.confirm({cpf,code:'123456',newPassword});
 assert.notEqual(credentialVersion(memory.state.user.passwordHash,secret),before);
});
test('Resend recebe remetente, destinatário e código corretos',async()=>{
 let sent;
 const sender=createEmailSender({env:{RESEND_API_KEY:'chave-ficticia',RESET_EMAIL_FROM:'ALP <acesso@example.com>'},
  fetchImpl:async(url,options)=>{sent={url,...options};return {ok:true}}});
 await sender('cliente@example.com','123456');
 assert.equal(sent.url,'https://api.resend.com/emails');
 assert.equal(sent.headers.Authorization,'Bearer chave-ficticia');
 const body=JSON.parse(sent.body);
 assert.equal(body.from,'ALP <acesso@example.com>');
 assert.deepEqual(body.to,['cliente@example.com']);
 assert.match(body.text,/123456/);
});
test('Resend não trata resposta de erro como entrega bem-sucedida',async()=>{
 const sender=createEmailSender({env:{},fetchImpl:async()=>({ok:false})});
 await assert.rejects(sender('cliente@example.com','123456'),/entregar/);
});
