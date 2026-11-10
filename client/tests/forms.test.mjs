import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatCpf,formatPhone,phoneDigits,clientPayload} from '../src/form-format.js';
import {loadCities} from '../src/cities.js';

test('CPF aceita digitação parcial e colagem com pontuação',()=>{
 assert.equal(formatCpf('1234'),'123.4');
 assert.equal(formatCpf('12345678901'),'123.456.789-01');
 assert.equal(formatCpf('123.456.789-01'),'123.456.789-01');
 assert.equal(formatCpf(null),'');
});
test('telefone diferencia fixo, celular e prefixo internacional',()=>{
 assert.equal(formatPhone('1133334444'),'(11) 3333-4444');
 assert.equal(formatPhone('11999998888'),'(11) 99999-8888');
 assert.equal(phoneDigits('+55 (11) 99999-8888'),'11999998888');
 assert.equal(formatPhone('55999998888'),'(55) 99999-8888');
});
test('payload guarda documentos e telefone sem máscara e normaliza sexo legado',()=>{
 const payload=clientPayload({name:'Teste',cpf:'123.456.789-01',phone:'+55 (11) 3333-4444',spouseCpf:'987.654.321-00',sex:'Feminino'});
 assert.deepEqual(payload,{name:'Teste',cpf:'12345678901',phone:'1133334444',spouseCpf:'98765432100',sex:'F'});
});
test('municípios são filtrados pela UF e ordenados pelo nome',async()=>{
 const result=await loadCities('SP');
 assert.equal(result.length,645);
 assert.equal(result.find(city=>city.name==='Campinas').id,'3509502');
 assert.equal(result.some(city=>city.name==='Rio de Janeiro'),false);
 assert.deepEqual(result,[...result].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')));
});
test('lista local contém todas as UFs e inclui município criado recentemente',async()=>{
 const data=(await import('../src/data/municipalities.mjs')).default;
 assert.equal(Object.keys(data).length,27);
 const all=Object.values(data).flat();assert.equal(all.length,5571);
 assert.equal(new Set(all.map(([id])=>id)).size,all.length);
 const mt=await loadCities('MT');assert.equal(mt.find(city=>city.name==='Boa Esperança do Norte').id,'5101837');
});
test('falha ao carregar permite nova tentativa',async()=>{
 await assert.rejects(loadCities('MG',{loadData:async()=>{throw Error('falha de rede')}}),/carregar as cidades/);
 const result=await loadCities('MG');
 assert.equal(result.find(city=>city.name==='Belo Horizonte').id,'3106200');
});
test('troca de UF cancela consulta anterior',async()=>{
 const controller=new AbortController();
 await assert.rejects(loadCities('BA',{signal:controller.signal,loadData:async()=>{controller.abort();return {default:{BA:[[2927408,'Salvador']]}}}}));
});
test('lista carregada é reutilizada ao voltar para a mesma UF',async()=>{
 let calls=0;
 const loadData=async()=>{calls++;return {default:{PR:[[4106902,'Curitiba']]}}};
 await loadCities('PR',{loadData});await loadCities('PR',{loadData});
 assert.equal(calls,1);
});
