import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isValidCpf} from '../src/cpf.js';
import {isValidCpf as browserCpf} from '../../client/src/cpf.js';
import {clientIdentity} from '../src/client-write-routes.js';

test('tela e API aceitam CPFs com dígitos verificadores corretos, máscara e zero inicial',()=>{
 for(const cpf of ['52998224725','529.982.247-25','11144477735','01234567890',' 529.982.247-25 ']){
  assert.equal(isValidCpf(cpf),true,cpf);assert.equal(browserCpf(cpf),true,cpf);
 }
});
test('tela e API recusam dígitos corrompidos, tamanho incorreto e caracteres estranhos',()=>{
 for(const cpf of ['52998224724','52998224715','12345678901','5299822472','052998224725','cpf52998224725','529.982.247/25','',null,undefined,'５２９９８２２４７２５']){
  assert.equal(isValidCpf(cpf),false,String(cpf));assert.equal(browserCpf(cpf),false,String(cpf));
 }
});
test('todas as sequências de dígitos iguais são inválidas',()=>{
 for(let digit=0;digit<=9;digit++){assert.equal(isValidCpf(String(digit).repeat(11)),false);assert.equal(browserCpf(String(digit).repeat(11)),false)}
});
test('normalização preserva zero inicial e cônjuge opcional',()=>{
 assert.deepEqual(clientIdentity({name:' Cliente Teste ',cpf:'012.345.678-90'}),{name:'Cliente Teste',cpf:'01234567890',spouseCpf:null});
 assert.equal(clientIdentity({name:'Teste',cpf:'52998224725',spouseCpf:'111.444.777-35'}).spouseCpf,'11144477735');
});
test('API exige nome e recusa CPF inválido do cliente ou cônjuge',()=>{
 assert.throws(()=>clientIdentity({name:' ',cpf:'52998224725'}),/nome/);
 assert.throws(()=>clientIdentity({name:'Teste',cpf:'12345678901'}),/CPF inválido/);
 assert.throws(()=>clientIdentity({name:'Teste',cpf:'52998224725',spouseCpf:'00000000000'}),/cônjuge inválido/);
});
