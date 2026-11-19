import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dueTodayCount,applicationKey} from '../src/push-client.js';
test('banner considera apenas parcelas abertas vencendo no calendário de Brasília',()=>{
 const items=['OPEN','PAID','PENDING_REVIEW','REJECTED'].map(status=>({dueDate:'2026-11-18T00:00:00Z',status}));items.push({dueDate:'2026-11-17T00:00:00Z',status:'OPEN'});
 assert.equal(dueTodayCount([{installments:items}],new Date('2026-11-18T15:00Z')),2);
 assert.equal(dueTodayCount([{installments:items}],new Date('2026-11-18T02:00Z')),1);
 assert.deepEqual([...applicationKey('AQID-_8')],[1,2,3,251,255]);
});
test('service worker não aceita dados financeiros nem redirecionamento externo no push',async()=>{
 const handlers={},shown=[],opened=[];
 const self={location:{origin:'https://alp.example'},addEventListener:(event,handler)=>{handlers[event]=handler},registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL,Intl,Date});
 let pending;const waitUntil=promise=>{pending=promise};
 handlers.push({data:{json:()=>({title:'CPF privado',body:'valor privado',url:'https://evil.example',day:'2000-01-01'})},waitUntil});await pending;
 assert.equal(shown[0][0],'A.L.P Imobiliária');assert.doesNotMatch(JSON.stringify(shown),/privado|evil/);assert.match(shown[0][1].body,/consultar/);
 handlers.notificationclick({notification:{close(){}},waitUntil});await pending;assert.equal(opened[0],'https://alp.example/?view=installments');
 handlers.push({data:{json:()=>({companyName:'Empresa Nova'})},waitUntil});await pending;assert.equal(shown.at(-1)[0],'Empresa Nova');
 assert.equal(handlers.fetch,undefined);
});
