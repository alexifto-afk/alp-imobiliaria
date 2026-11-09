import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailSender,emailConfigured} from '../src/gmail-email.js';

const env={GMAIL_USER:'alp@gmail.com',GMAIL_CLIENT_ID:'cliente-ficticio',GMAIL_CLIENT_SECRET:'segredo-ficticio',GMAIL_REFRESH_TOKEN:'refresh-ficticio'};
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const token=()=>response(200,{access_token:'access-ficticio',expires_in:3600});
const sent=()=>response(200,{id:'mensagem-ficticia'});
test('Gmail exige todas as credenciais OAuth e remetente válido',()=>{
 assert.equal(emailConfigured(env),true);
 for(const key of Object.keys(env))assert.equal(emailConfigured({...env,[key]:''}),false);
 assert.equal(emailConfigured({...env,GMAIL_USER:'email-inválido'}),false);
});
test('usa refresh token por HTTPS e envia mensagem UTF-8 em base64url',async()=>{
 const calls=[];
 const send=createEmailSender({env,fetchImpl:async(url,opts)=>{calls.push({url,...opts});return url.includes('oauth2')?token():sent()}});
 await send('cliente@example.com','012345');
 assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');
 const form=new URLSearchParams(calls[0].body);
 assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('client_id'),env.GMAIL_CLIENT_ID);
 assert.equal(form.get('client_secret'),env.GMAIL_CLIENT_SECRET);assert.equal(form.get('refresh_token'),env.GMAIL_REFRESH_TOKEN);
 assert.equal(calls[1].url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
 assert.equal(calls[1].headers.Authorization,'Bearer access-ficticio');
 const raw=JSON.parse(calls[1].body).raw;
 assert.match(raw,/^[A-Za-z0-9_-]+$/);
 const mime=Buffer.from(raw,'base64url').toString('utf8');
 assert.match(mime,/To: <cliente@example.com>/);assert.match(mime,/<alp@gmail.com>/);
 const text=Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString('utf8');
 assert.match(text,/012345/);assert.match(text,/código de recuperação/);
 assert.equal(JSON.stringify(calls[1]).includes(env.GMAIL_CLIENT_SECRET),false);
});
test('reutiliza token de acesso até próximo da expiração',async()=>{
 let now=1000000,refreshes=0;
 const send=createEmailSender({env,now:()=>now,fetchImpl:async url=>{if(url.includes('oauth2')){refreshes++;return token()}return sent()}});
 await send('cliente@example.com','123456');await send('outro@example.com','654321');
 assert.equal(refreshes,1);
 now+=3571000;await send('cliente@example.com','123456');assert.equal(refreshes,2);
});
test('envios simultâneos compartilham a renovação do token',async()=>{
 let refreshes=0,sends=0;
 const send=createEmailSender({env,fetchImpl:async url=>{if(url.includes('oauth2')){refreshes++;return token()}sends++;return sent()}});
 await Promise.all([send('cliente@example.com','123456'),send('outro@example.com','654321')]);
 assert.equal(refreshes,1);assert.equal(sends,2);
});
test('401 do Gmail renova token e tenta envio somente mais uma vez',async()=>{
 let refreshes=0,sends=0;
 const send=createEmailSender({env,fetchImpl:async url=>{if(url.includes('oauth2')){refreshes++;return token()}sends++;return sends===1?response(401,{}):sent()}});
 await send('cliente@example.com','123456');assert.equal(refreshes,2);assert.equal(sends,2);
});
test('credencial revogada impede envio e produz erro sem expor segredo',async()=>{
 let calls=0;
 const send=createEmailSender({env,fetchImpl:async()=>{calls++;return response(400,{error:'invalid_grant',description:env.GMAIL_REFRESH_TOKEN})}});
 await assert.rejects(send('cliente@example.com','123456'),e=>e.code==='GMAIL_AUTH_FAILED'&&!e.message.includes(env.GMAIL_REFRESH_TOKEN));
 assert.equal(calls,1);
});
test('cota excedida não é tratada como envio bem-sucedido',async()=>{
 const send=createEmailSender({env,fetchImpl:async url=>url.includes('oauth2')?token():response(429,{})});
 await assert.rejects(send('cliente@example.com','123456'),e=>e.code==='GMAIL_QUOTA');
});
test('timeout de envio não dispara repetição que possa duplicar mensagens',async()=>{
 let sends=0;
 const send=createEmailSender({env,fetchImpl:async url=>{if(url.includes('oauth2'))return token();sends++;throw Error('timeout')}});
 await assert.rejects(send('cliente@example.com','123456'),e=>e.code==='GMAIL_SEND_UNAVAILABLE');
 assert.equal(sends,1);
});
test('configuração ausente e cabeçalho inválido são rejeitados antes da rede',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return sent()};
 await assert.rejects(createEmailSender({env:{},fetchImpl})('cliente@example.com','123456'),e=>e.code==='GMAIL_NOT_CONFIGURED');
 await assert.rejects(createEmailSender({env,fetchImpl})('cliente@example.com\r\nBcc: outro@example.com','123456'),e=>e.code==='GMAIL_INVALID_MESSAGE');
 assert.equal(calls,0);
});
test('resposta sem id de mensagem não é considerada aceita pelo Gmail',async()=>{
 const send=createEmailSender({env,fetchImpl:async url=>url.includes('oauth2')?token():response(200,{})});
 await assert.rejects(send('cliente@example.com','123456'),e=>e.code==='GMAIL_SEND_FAILED');
});
