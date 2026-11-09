import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validMpSignature} from '../src/mp-signature.js';
const secret='segredo-ficticio-exclusivo-de-testes';
const now=Date.parse('2026-11-09T12:00:00Z');
function request(ts,changes={}) {
 const manifest=`id:12345;request-id:request-1;ts:${ts};`;
 const v1=crypto.createHmac('sha256',secret).update(manifest).digest('hex');
 const headers={'x-signature':`ts=${ts},v1=${v1}`,'x-request-id':'request-1',...changes};
 return {query:{'data.id':'12345'},get:key=>headers[key]};
}
test('aceita assinatura válida com timestamp em segundos',()=>{
 assert.equal(validMpSignature(request(String(now/1000)),'12345',secret,now),true);
});
test('aceita assinatura válida com timestamp em milissegundos',()=>{
 assert.equal(validMpSignature(request(String(now)),'12345',secret,now),true);
});
test('recusa assinatura expirada, futura, alterada ou malformada sem lançar exceção',()=>{
 for(const ts of [now-11*60000,now+11*60000]){
  assert.equal(validMpSignature(request(String(ts)),'12345',secret,now),false);
 }
 for(const value of ['','ts=123,v1=a','ts=NaN,v1='+'a'.repeat(64),'ts='+now+',v1='+'a'.repeat(63)]){
  assert.equal(validMpSignature(request(String(now),{'x-signature':value}),'12345',secret,now),false);
 }
 assert.equal(validMpSignature(request(String(now),{'x-request-id':'outro'}),'12345',secret,now),false);
 assert.equal(validMpSignature(request(String(now)),'12345','segredo-errado',now),false);
});
