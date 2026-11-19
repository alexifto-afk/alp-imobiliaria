import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import {normalizeCompany,getCompany,registerCompanyRoutes} from '../src/company-settings.js';
import {createEmailSender} from '../src/gmail-email.js';

test('nome é validado e imagem é decodificada e normalizada para JPEG estático',async()=>{
 assert.deepEqual(await normalizeCompany({name:'  Empresa   Teste  '}),{name:'Empresa Teste'});
 for(const name of ['', 'a', 'a'.repeat(81)])await assert.rejects(normalizeCompany({name}),{status:400});
 for(const logo of ['https://example.test/logo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YWJj', 'a'.repeat(2800001)])await assert.rejects(normalizeCompany({name:'Empresa',logo}),{status:400});
 const png=await sharp({create:{width:20,height:40,channels:4,background:'#ffffff00'}}).png().toBuffer();
 const normalized=await normalizeCompany({name:'Empresa',logo:'data:image/png;base64,'+png.toString('base64')});
 const meta=await sharp(Buffer.from(normalized.logo.split(',')[1],'base64')).metadata();
 assert.equal(meta.format,'jpeg');assert.equal(meta.width,330);assert.equal(meta.height,220);assert.equal(meta.hasAlpha,false);
 assert.deepEqual(await normalizeCompany({name:'Empresa',logo:null}),{name:'Empresa',logo:null});
});
test('leitura antes de criar a tabela mantém o padrão; erros inesperados não são ocultados',async()=>{
 const missing={companySetting:{findUnique:async()=>{throw {code:'P2021'}}}};
 assert.equal((await getCompany(missing)).configured,false);
 await assert.rejects(getCompany({companySetting:{findUnique:async()=>{throw Error('offline')}}}),/offline/);
});
async function setup(run){
 const state={row:null,writes:0};
 const db={companySetting:{findUnique:async()=>state.row,upsert:async({create,update})=>{state.writes++;state.row=state.row?{...state.row,...update}:create;return state.row}}};
 const app=express();app.use(express.json({limit:'3mb'}));
 const auth=(req,res,next)=>{if(!req.get('x-role'))return res.sendStatus(401);req.auth={role:req.get('x-role')};next()};
 registerCompanyRoutes(app,{db,auth,current:(req,res,next)=>next(),admin:(req,res,next)=>req.auth.role==='ADMIN'?next():res.sendStatus(403)});
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const send=(method,body,role)=>fetch('http://127.0.0.1:'+listener.address().port+'/api/company',{method,headers:{'content-type':'application/json',...(role?{'x-role':role}:{})},body:body?JSON.stringify(body):undefined});
 try{await run({send,state})}finally{await new Promise(resolve=>listener.close(resolve))}
}
test('HTTP: identidade é pública; somente administrador pode alterar; mudanças persistem',async()=>setup(async({send,state})=>{
 const first=await send('GET');assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');assert.equal((await first.json()).name,'A.L.P Imobiliária');
 assert.equal((await send('PUT',{name:'Outra'})).status,401);assert.equal((await send('PUT',{name:'Outra'},'CLIENT')).status,403);assert.equal(state.writes,0);
 assert.equal((await send('PUT',{name:'a'},'ADMIN')).status,400);assert.equal(state.writes,0);
 assert.equal((await send('PUT',{name:'Empresa Nova',logo:null},'ADMIN')).status,200);assert.equal((await (await send('GET')).json()).name,'Empresa Nova');
 state.row.logo='imagem-existente';await send('PUT',{name:'Empresa Renomeada'},'ADMIN');assert.equal(state.row.logo,'imagem-existente');
 await send('PUT',{name:'Empresa Renomeada',logo:null},'ADMIN');assert.equal(state.row.logo,null);
}));
test('nome configurado aparece no remetente e assunto do Gmail sem alterar escopo',async()=>{
 let raw;
 const send=createEmailSender({env:{GMAIL_USER:'test@example.com',GMAIL_CLIENT_ID:'id',GMAIL_CLIENT_SECRET:'secret',GMAIL_REFRESH_TOKEN:'refresh'},getCompanyName:async()=>'Empresa Nova',fetchImpl:async(url,options)=>{
  if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'access',expires_in:3600})};
  raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();return {ok:true,json:async()=>({id:'message'})};
 }});
 await send('client@example.com','123456');assert.ok(raw.includes(Buffer.from('Empresa Nova').toString('base64')));assert.ok(raw.includes(Buffer.from('Empresa Nova — recuperação de senha').toString('base64')));
});
