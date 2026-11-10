import React,{useLayoutEffect,useRef} from 'react';
import {cpfDigits,phoneDigits,formatCpf,formatPhone,onlyDigits} from './form-format.js';
import {isValidCpf} from './cpf.js';

export default function MaskedInput({kind,value,onValueChange,validateCpf=false,...props}){
 const input=useRef(null),caret=useRef(null);
 const normalize=kind==='phone'?phoneDigits:cpfDigits;
 const format=kind==='phone'?formatPhone:formatCpf;
 const displayed=format(value);
 useLayoutEffect(()=>{
  const invalid=validateCpf&&!props.disabled&&!props.readOnly&&String(value??'').trim()&&!isValidCpf(value);
  input.current?.setCustomValidity(invalid?'CPF inválido. Confira os dígitos informados.':'');
 },[validateCpf,value,props.disabled,props.readOnly]);
 useLayoutEffect(()=>{
  if(caret.current===null||!input.current)return;
  let count=0,position=0;
  while(position<displayed.length&&count<caret.current){
   if(/\d/.test(displayed[position]))count++;
   position++;
  }
  input.current.setSelectionRange(position,position);caret.current=null;
 },[displayed,value]);
 function change(event){
  const text=event.target.value,position=event.target.selectionStart??text.length;
  const raw=normalize(text);
  const removedPrefix=kind==='phone'&&onlyDigits(text).length>11&&onlyDigits(text).startsWith('55')?2:0;
  caret.current=Math.max(0,Math.min(raw.length,onlyDigits(text.slice(0,position)).length-removedPrefix));
  onValueChange(raw);
 }
 function keyDown(event){
  const element=event.currentTarget,position=element.selectionStart;
  if(element.selectionEnd!==position||!['Backspace','Delete'].includes(event.key))return;
  const previous=event.key==='Backspace';
  const adjacent=element.value[position-(previous?1:0)];
  if(!adjacent||/\d/.test(adjacent))return;
  event.preventDefault();
  const count=onlyDigits(element.value.slice(0,position)).length;
  const index=count-(previous?1:0),raw=normalize(value);
  if(index<0){element.setSelectionRange(0,0);return}
  caret.current=Math.max(0,count-(previous?1:0));
  onValueChange(raw.slice(0,index)+raw.slice(index+1));
 }
 return <input {...props} ref={input} type="tel" inputMode="numeric" value={displayed} onChange={change} onKeyDown={keyDown}/>;
}
